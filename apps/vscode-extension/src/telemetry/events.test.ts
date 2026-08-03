import { describe, expect, it } from 'vitest';

import {
  adapterUsed,
  commandExecuted,
  errorCategory,
  featureAdopted,
  indexDuration,
} from './events.js';

describe('telemetry allowlist (§36) — denylisted data is structurally impossible', () => {
  it('command events accept only impactgraph.* command ids, never arguments', () => {
    expect(commandExecuted('impactgraph.reindexWorkspace')?.properties['commandId']).toBe(
      'impactgraph.reindexWorkspace',
    );
    expect(commandExecuted('vscode.open /Users/me/secret-repo/file.ts')).toBeUndefined();
    expect(commandExecuted('/Users/me/repo')).toBeUndefined();
  });

  it('durations become buckets — the raw measurement never leaves', () => {
    expect(indexDuration(1_200).properties['bucket']).toBe('<3s');
    expect(indexDuration(45_000).properties['bucket']).toBe('30s-2m');
    expect(indexDuration(600_000).properties['bucket']).toBe('>2m');
    expect(Object.values(indexDuration(1_200).properties)).not.toContain(1_200);
  });

  it('error categories are a closed enum — messages and stacks cannot ride along', () => {
    expect(errorCategory('indexingFailure')?.properties['category']).toBe('indexingFailure');
    expect(errorCategory('ENOENT: /Users/me/repo/.env not found')).toBeUndefined();
  });

  it('adapter and feature names are closed sets — repository names cannot be smuggled', () => {
    expect(adapterUsed('typescript')).toBeDefined();
    expect(adapterUsed('my-secret-repo')).toBeUndefined();
    expect(featureAdopted('review')).toBeDefined();
    expect(featureAdopted('DealVisibilityPolicy')).toBeUndefined();
  });

  it('every constructible event carries only enum/bucket/count values', () => {
    const events = [
      commandExecuted('impactgraph.analyzeSpecification'),
      indexDuration(10),
      errorCategory('providerFailure'),
      adapterUsed('express'),
      featureAdopted('export'),
    ];
    for (const event of events) {
      expect(event).toBeDefined();
      for (const value of Object.values(event?.properties ?? {})) {
        expect(String(value)).not.toMatch(/[/\\]/); // no paths of any kind
      }
    }
  });
});
