import { describe, expect, it } from 'vitest';

import { adrGuidanceRecognizer } from './adr-guidance.js';

const ACCEPTED_ADR = `# ADR-0011: No hosted backend in v1

Status: Accepted

## Decision

All analysis runs locally. \`apps/mcp-server\` and apps/cli never call a hosted service;
packages/ai-inference is the only place provider SDKs may live.
`;

describe('adrGuidanceRecognizer', () => {
  it('applies to ADR-shaped markdown paths only', () => {
    expect(adrGuidanceRecognizer.appliesTo('docs/adr/0011-no-hosted-backend.md')).toBe(true);
    expect(adrGuidanceRecognizer.appliesTo('docs/decisions/0002-storage.md')).toBe(true);
    expect(adrGuidanceRecognizer.appliesTo('README.md')).toBe(false);
    expect(adrGuidanceRecognizer.appliesTo('docs/adr/0011-no-hosted-backend.md.bak')).toBe(false);
  });

  it('turns an accepted ADR into one advisory guidance constraint scoped to the paths it names', () => {
    const constraints = adrGuidanceRecognizer.recognize({
      path: 'docs/adr/0011-no-hosted-backend.md',
      content: ACCEPTED_ADR,
    });
    expect(constraints).toHaveLength(1);
    const guidance = constraints[0];
    expect(guidance?.kind).toBe('architecture-guidance');
    expect(guidance?.severity).toBe('advisory');
    expect(guidance?.extraction).toBe('recognized');
    expect(guidance?.name).toContain('No hosted backend in v1');
    expect(guidance?.scope.pathGlobs).toContain('apps/mcp-server/**');
    expect(guidance?.scope.pathGlobs).toContain('packages/ai-inference/**');
    expect(guidance?.rule.relation).toBe('GOVERNS');
    expect(guidance?.rule.statement).toContain('No hosted backend in v1');
  });

  it('recognizes nothing from a proposed or superseded decision', () => {
    for (const status of ['Proposed', 'Superseded by ADR-0012', 'Rejected', 'Deprecated']) {
      const constraints = adrGuidanceRecognizer.recognize({
        path: 'docs/adr/0001-x.md',
        content: `# ADR-0001: X\n\nStatus: ${status}\n\nTouches packages/domain here.`,
      });
      expect(constraints).toEqual([]);
    }
  });

  it('recognizes nothing when the decision names no repository path — there is nothing to scope', () => {
    const constraints = adrGuidanceRecognizer.recognize({
      path: 'docs/adr/0003-typescript.md',
      content: '# ADR-0003: TypeScript as the primary language\n\nStatus: Accepted\n\nProse only.',
    });
    expect(constraints).toEqual([]);
  });
});
