import { describe, expect, it } from 'vitest';

import { renderAnalyze } from './analyze-render.js';

import type { CommandContext } from '../context.js';
import type { CliAnalyzeOutput } from '@impactgraph/contracts';

// §18.4 in the text surface: proposed relationships get their own labelled section and are never
// listed among the impacts, so a reader skimming the report cannot mistake one for the other.

const document = (proposedStructure?: CliAnalyzeOutput['proposedStructure']): CliAnalyzeOutput => ({
  schemaVersion: 1,
  command: 'analyze',
  specification: { id: 'spec-1', version: 1, title: 'Deal visibility', extractionMode: 'provider' },
  analysis: { id: 'analysis-1', snapshotId: 'snap-1', status: 'draft', impactCount: 1 },
  requirements: [
    {
      id: 'req-1',
      statement: 'Expired deals must disappear.',
      impacts: [
        {
          nodeId: 'svc:expiry',
          name: 'DealExpiryService',
          likelihood: 'required',
          impactType: 'business-rule',
          directness: 'direct',
          confidence: 0.9,
          dependencyPath: ['svc:expiry'],
          evidenceFiles: ['src/expiry.ts'],
        },
      ],
      openQuestions: [],
    },
  ],
  warnings: [],
  architecturalOptions: [
    {
      id: 'opt-1',
      title: 'Publish expiry events',
      description: 'AI-assisted interpretation.',
      affectedNodeIds: ['svc:expiry', 'topic:deal-expired'],
    },
  ],
  ...(proposedStructure === undefined ? {} : { proposedStructure }),
});

const structure: CliAnalyzeOutput['proposedStructure'] = {
  nodes: [],
  relationships: [
    {
      id: 'proposed-rel-1',
      sourceId: 'svc:expiry',
      targetId: 'topic:deal-expired',
      sourceKind: 'existing',
      targetKind: 'existing',
      type: 'PUBLISHES',
      status: 'proposed',
      originOptionId: 'opt-1',
      rationale: 'the option would add a publish',
      provenance: 'llm-inferred',
      evidenceIds: ['ev-1'],
      confidence: 0.4,
      confidenceSignals: [{ type: 'framework-convention', contribution: 0.45 }],
    },
  ],
};

const render = (output: CliAnalyzeOutput, format: CommandContext['format']): string[] => {
  const lines: string[] = [];
  renderAnalyze({ rootDir: '/tmp', format, args: [], write: (line) => lines.push(line) }, output);
  return lines;
};

describe('analyze text output — proposed structure (§18.4)', () => {
  it('renders proposed relationships in a section that says they do not exist yet', () => {
    const lines = render(document(structure), 'text');
    const heading = lines.find((line) => line.startsWith('Proposed structure'));
    expect(heading).toContain('does not exist in the repository today');
    const entry = lines.find((line) => line.includes('PROPOSED'));
    expect(entry).toContain('svc:expiry —PUBLISHES→ topic:deal-expired');
    // the option that implies it, and the fact that it is AI-inferred, are both on the line
    expect(entry).toContain('Publish expiry events');
    expect(entry).toContain('llm-inferred');
  });

  it('never lists a proposal among the requirement impacts', () => {
    const lines = render(document(structure), 'text');
    const impactLine = lines.findIndex((line) => line.includes('DealExpiryService'));
    const proposedLine = lines.findIndex((line) => line.startsWith('Proposed structure'));
    expect(impactLine).toBeGreaterThanOrEqual(0);
    expect(proposedLine).toBeGreaterThan(impactLine);
    expect(lines[impactLine]).not.toContain('PROPOSED');
  });

  it('omits the section entirely when nothing was proposed', () => {
    const lines = render(document(), 'text');
    expect(lines.some((line) => line.startsWith('Proposed structure'))).toBe(false);
  });

  it('validates the document against the contract before printing JSON', () => {
    const lines = render(document(structure), 'json');
    const parsed = JSON.parse(lines.join('\n')) as CliAnalyzeOutput;
    expect(parsed.proposedStructure?.relationships[0]?.status).toBe('proposed');
  });
});
