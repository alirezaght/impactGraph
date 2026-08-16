import { describe, expect, it } from 'vitest';

import { extractConstraints } from '../extract-constraints/extract-constraints.js';

import { checkGuidance } from './check-guidance.js';

const ADR = `# ADR-0011: No hosted backend in v1

Status: Accepted

Analysis runs locally; apps/mcp-server never calls a hosted service.
`;

const constraints = () =>
  extractConstraints({
    files: [{ path: 'docs/adr/0011-no-hosted-backend.md', content: ADR }],
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-16T00:00:00.000Z',
    nextId: (seed) => `constraint-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
    nextEvidenceId: (seed) => `ev-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
  }).constraints;

const nextId = (seed: string): string => `finding-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`;

describe('checkGuidance', () => {
  it('surfaces an accepted decision when the plan touches the area it governs', () => {
    const findings = checkGuidance({
      requirements: [
        {
          id: 'R1',
          concepts: [
            { ref: 'mcp server', nodeId: 'file:x', path: 'apps/mcp-server/src/registry.ts' },
          ],
        },
      ],
      constraints: constraints(),
      nextId,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('constraint-warning');
    expect(findings[0]?.severity).toBe('informational');
    expect(findings[0]?.statement).toContain('No hosted backend in v1');
    expect(findings[0]?.statement).toContain('docs/adr/0011-no-hosted-backend.md');
    expect(findings[0]?.requirementIds).toEqual(['R1']);
  });

  it('stays silent when the plan never enters the governed area', () => {
    const findings = checkGuidance({
      requirements: [
        { id: 'R1', concepts: [{ ref: 'webview', nodeId: 'n', path: 'apps/vscode/webview/x.ts' }] },
      ],
      constraints: constraints(),
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('emits at most one finding per decision, however many requirements touch it', () => {
    const findings = checkGuidance({
      requirements: [
        { id: 'R1', concepts: [{ ref: 'a', nodeId: 'n1', path: 'apps/mcp-server/src/a.ts' }] },
        { id: 'R2', concepts: [{ ref: 'b', nodeId: 'n2', path: 'apps/mcp-server/src/b.ts' }] },
      ],
      constraints: constraints(),
      nextId,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.requirementIds).toEqual(['R1', 'R2']);
  });
});
