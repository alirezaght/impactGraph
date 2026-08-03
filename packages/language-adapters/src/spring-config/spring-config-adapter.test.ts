import { describe, expect, it } from 'vitest';

import { createSpringConfigAdapter, SPRING_PROPERTY_RECEIVER } from './spring-config-adapter.js';
import { springConfigResource, springModuleOfSource } from './spring-resources.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// The `spring-config` language adapter: what a Spring property source STATES, and everything it
// refuses to decode. A value read wrongly here becomes a topic name later, so every shape outside
// the plain nested-scalar subset must contribute nothing rather than something plausible.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-spring-config',
  analysisRunId: 'run-spring-config',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const index = (relativePath: string, content: string): Promise<GraphFragment> =>
  createSpringConfigAdapter().indexFiles([{ relativePath, content }], CONTEXT);

const properties = (fragment: GraphFragment): string[] =>
  fragment.callFacts
    .filter((fact) => fact.receiverName === SPRING_PROPERTY_RECEIVER)
    .map((fact) => `${fact.calleeName}=${fact.stringArguments[0] ?? ''}`)
    .sort();

const YAML = 'src/main/resources/application.yml';

describe('spring-config: the Spring resource convention', () => {
  it('recognises the module, the profile and the format', () => {
    expect(springConfigResource(YAML)).toEqual({ moduleRoot: '', format: 'yaml' });
    expect(springConfigResource('service/src/main/resources/application-prod.properties')).toEqual({
      moduleRoot: 'service',
      format: 'properties',
      profile: 'prod',
    });
    expect(springModuleOfSource('service/src/main/java/com/x/A.java')).toBe('service');
  });

  it('recognises nothing outside that exact convention', () => {
    for (const path of [
      'src/test/resources/application.yml',
      'src/main/resources/nested/application.yml',
      'src/main/resources/logback.xml',
      'src/main/resources/other.yml',
      '.github/workflows/ci.yml',
    ]) {
      expect(springConfigResource(path), path).toBeUndefined();
    }
  });

  it('produces exactly the fallback file fact for a YAML file that is not Spring config', async () => {
    const fragment = await index('.github/workflows/ci.yml', 'jobs:\n  build:\n    runs-on: x\n');
    expect(fragment.nodes.map((node) => String(node.id))).toEqual([
      'file:.github/workflows/ci.yml',
    ]);
    expect(properties(fragment)).toEqual([]);
    expect(fragment.warnings[0]?.message).toContain('not a Spring configuration resource');
  });
});

describe('spring-config: YAML the reader decodes', () => {
  it('flattens nested mappings to dotted keys and reads quoted and inline-commented scalars', async () => {
    const fragment = await index(
      YAML,
      `spring:
  application:
    name: java-spring

deals:
  events-topic: deal-audit-events
  worker-sub: "deal-events-worker"   # inline comment is not part of the value
  legacy: 'quoted-value'

logging:
  level:
    com.example.deals: INFO
`,
    );
    expect(properties(fragment)).toEqual([
      'deals.events-topic=deal-audit-events',
      'deals.legacy=quoted-value',
      'deals.worker-sub=deal-events-worker',
      'logging.level.com.example.deals=INFO',
      'spring.application.name=java-spring',
    ]);
  });

  it('reads every document of a multi-document file, disagreement and all', async () => {
    const fragment = await index(
      YAML,
      `deals:
  topic: from-default
---
spring:
  config:
    activate:
      on-profile: prod
deals:
  topic: from-prod
`,
    );
    // Both statements survive. Choosing between them is the resolver's refusal, not the reader's.
    expect(properties(fragment)).toEqual([
      'deals.topic=from-default',
      'deals.topic=from-prod',
      'spring.config.activate.on-profile=prod',
    ]);
  });

  it('refuses sequences, block scalars, flow collections, anchors and tabbed indentation', async () => {
    const fragment = await index(
      YAML,
      `deals:
  topics:
    - deal-events
    - deal-audit
  block: |
    deal-events
  flow: { topic: deal-events }
  anchored: &ref deal-events
  alias: *ref
  tagged: !!str deal-events
\tbad-indent: deal-events
`,
    );
    expect(properties(fragment)).toEqual([]);
    expect(fragment.warnings.some((warning) => warning.message.includes('does not decode'))).toBe(
      true,
    );
  });

  it('withholds credential-bearing keys entirely', async () => {
    const fragment = await index(
      YAML,
      `spring:
  datasource:
    password: hunter2
    url: jdbc-deals
  security:
    client-secret: abc
    clientSecret: def
    api.key: ghi
deals:
  topic: deal-events
`,
    );
    expect(properties(fragment)).toEqual([
      'deals.topic=deal-events',
      'spring.datasource.url=jdbc-deals',
    ]);
  });
});

describe('spring-config: hostile content is data, never behaviour (PRD §42.5)', () => {
  it('reads a key literally named constructor without hitting a prototype', async () => {
    const fragment = await index(
      YAML,
      `constructor: deal-events
__proto__: polluted
toString: deal-events
deals:
  constructor: deal-events
`,
    );
    expect(properties(fragment)).toEqual([
      '__proto__=polluted',
      'constructor=deal-events',
      'deals.constructor=deal-events',
      'toString=deal-events',
    ]);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('records a ${} bomb verbatim without expanding it, and stays bounded', async () => {
    const bomb = '${a'.repeat(400) + '}'.repeat(400);
    const fragment = await index(
      YAML,
      `deals:
  topic: \${\${\${nested}}}
  bomb: ${bomb}
  path: ../../../../etc/passwd
`,
    );
    // Every value is carried as the text it is; nothing is expanded, and the traversal-looking
    // one is an inert string that the resolver later refuses for not being a bare name.
    expect(properties(fragment)).toEqual([
      'deals.path=../../../../etc/passwd',
      'deals.topic=${${${nested}}}',
    ]);
  });

  it('caps a pathological file instead of reading all of it', async () => {
    const many = Array.from({ length: 6000 }, (_unused, index) => `k${String(index)}: v`).join(
      '\n',
    );
    const fragment = await index(YAML, many);
    expect(properties(fragment).length).toBe(5000);
    expect(fragment.warnings.some((warning) => warning.message.includes('does not decode'))).toBe(
      true,
    );
  });
});

describe('spring-config: .properties', () => {
  it('reads = and : forms and skips comments', async () => {
    const fragment = await index(
      'src/main/resources/application.properties',
      `# a comment
! another comment
deals.events-topic=deal-audit-events
deals.worker-sub: deal-events-worker
spring.datasource.password=hunter2
`,
    );
    expect(properties(fragment)).toEqual([
      'deals.events-topic=deal-audit-events',
      'deals.worker-sub=deal-events-worker',
    ]);
  });

  it('refuses a continued logical line and an escaped key or value', async () => {
    const fragment = await index(
      'src/main/resources/application.properties',
      `deals.topic=deal-\\
events
deals.escaped\\:key=x
deals.url=jdbc\\:postgresql
deals.plain=deal-events
`,
    );
    expect(properties(fragment)).toEqual(['deals.plain=deal-events']);
  });
});
