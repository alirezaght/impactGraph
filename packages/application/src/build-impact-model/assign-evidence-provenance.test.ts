import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import {
  assignEvidenceProvenance,
  isUserSupplied,
  suppliedIdentifiers,
} from './assign-evidence-provenance.js';

import type {
  GraphNode,
  ImpactAnalysis,
  KnowledgeGraph,
  RequirementImpact,
} from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-12T00:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, name: string, path: string): GraphNode => {
  const result = createGraphNode({
    id,
    category: 'repository',
    type: 'file',
    name,
    path,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const graph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node('file:send_service', 'send_service.py', 'services/newsletter/send_service.py'),
      node('file:issue_routes', 'issue_routes.py', 'services/newsletter/issue_routes.py'),
      node('file:digest_builder', 'digest_builder.py', 'services/newsletter/digest_builder.py'),
      node('file:aggregator', 'aggregator.py', 'services/aggregator/aggregator.py'),
    ],
    [],
  );
  if (!result.ok) {
    throw new Error('graph');
  }
  return result.value;
};

const impact = (nodeId: string, basis: RequirementImpact['evidenceTypes']): RequirementImpact => ({
  requirementId: 'R1',
  nodeId,
  likelihood: 'required',
  impactType: 'domain-model',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'direct-observation', contribution: 0.9 }],
  explanation: 'matched',
  expectedChanges: [],
  evidenceIds: ['ev-1'],
  dependencyPath: [],
  provenance: 'static-analysis',
  ...(basis === undefined ? {} : { evidenceTypes: basis }),
});

const analysis = (impacts: readonly RequirementImpact[]): ImpactAnalysis => ({
  id: 'analysis-1',
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-12T00:00:00.000Z',
  status: 'draft',
  requirementImpacts: impacts,
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
});

/** The specification from the trial: it names four files outright. */
const SPEC_TEXT =
  'Modify send_service.py to render the digest, update issue_routes.py, and adjust subscription_repository.py and NewsletterListWorkspace.astro.';

describe('suppliedIdentifiers', () => {
  it('reads filenames and identifier-shaped tokens the specification states', () => {
    const supplied = suppliedIdentifiers(SPEC_TEXT);
    expect(supplied.has('send_service.py')).toBe(true);
    expect(supplied.has('issue_routes.py')).toBe(true);
    expect(supplied.has('newsletterlistworkspace.astro')).toBe(true);
  });

  it('does not treat ordinary prose as a supplied identifier', () => {
    const supplied = suppliedIdentifiers('The service should render the digest for subscribers.');
    expect(supplied.has('service')).toBe(false);
    expect(supplied.has('digest')).toBe(false);
  });

  // ADR-0022: most TypeScript symbols are lowerCamelCase. Missing them let ImpactGraph report a
  // function the specification named outright as something it had independently discovered.
  it('reads lowerCamelCase symbols the specification states', () => {
    const supplied = suppliedIdentifiers('`buildReviewOutput` must cap the findings it emits.');
    expect(supplied.has('buildreviewoutput')).toBe(true);
  });

  it('still refuses single lowercase prose words', () => {
    const supplied = suppliedIdentifiers('The renderer should cap the findings it emits.');
    expect(supplied.has('renderer')).toBe(false);
    expect(supplied.has('findings')).toBe(false);
  });
});

describe('assignEvidenceProvenance — the spec-echo scenario', () => {
  it('marks a file the specification named as USER_SUPPLIED, not a discovery', () => {
    const result = assignEvidenceProvenance({
      analysis: analysis([impact('file:send_service', ['direct-structural'])]),
      graph: graph(),
      specificationText: SPEC_TEXT,
    });
    const assigned = result.analysis.requirementImpacts[0];
    expect(assigned?.evidenceProvenance).toBe('USER_SUPPLIED');
    // The tier is untouched: the file really is required, and hiding it would be wrong.
    expect(assigned?.likelihood).toBe('required');
  });

  it('marks a file the specification never named as an independent discovery', () => {
    const result = assignEvidenceProvenance({
      analysis: analysis([impact('file:digest_builder', ['direct-structural'])]),
      graph: graph(),
      specificationText: SPEC_TEXT,
    });
    expect(result.analysis.requirementImpacts[0]?.evidenceProvenance).toBe(
      'INDEPENDENTLY_DISCOVERED',
    );
  });

  it('does not let four echoes count as independent evidence', () => {
    const echoes = assignEvidenceProvenance({
      analysis: analysis([
        impact('file:send_service', ['direct-structural']),
        impact('file:issue_routes', ['direct-structural']),
      ]),
      graph: graph(),
      specificationText: SPEC_TEXT,
    });
    const discoveries = assignEvidenceProvenance({
      analysis: analysis([
        impact('file:digest_builder', ['direct-structural']),
        impact('file:aggregator', ['direct-structural']),
      ]),
      graph: graph(),
      specificationText: SPEC_TEXT,
    });
    expect(echoes.independence.independentCount).toBe(0);
    expect(echoes.independence.confirmationCount).toBe(2);
    expect(discoveries.independence.independentCount).toBe(2);
    expect(echoes.independence.weightedIndependence).toBeLessThan(
      discoveries.independence.weightedIndependence / 5,
    );
  });

  it('keeps a spec-named file a confirmation even when a constraint finding cites it', () => {
    // The finding is the discovery; the file the user typed is not. Letting a constraint citation
    // relabel an echo as independent would raise the independence count because the user wrote a
    // filename — the exact inflation ADR-0017 §4.3 exists to prevent.
    const result = assignEvidenceProvenance({
      analysis: analysis([impact('file:send_service', ['direct-structural'])]),
      graph: graph(),
      specificationText: SPEC_TEXT,
      constraintDerivedNodeIds: new Set(['file:send_service']),
    });
    expect(result.analysis.requirementImpacts[0]?.evidenceProvenance).toBe('USER_SUPPLIED');
  });

  it('marks a constraint-derived impact the spec never named as CONSTRAINT_DERIVED', () => {
    const result = assignEvidenceProvenance({
      analysis: analysis([impact('file:aggregator', ['direct-structural'])]),
      graph: graph(),
      specificationText: SPEC_TEXT,
      constraintDerivedNodeIds: new Set(['file:aggregator']),
    });
    expect(result.analysis.requirementImpacts[0]?.evidenceProvenance).toBe('CONSTRAINT_DERIVED');
  });

  it('reads a multi-hop match as transitive rather than as discovery', () => {
    const result = assignEvidenceProvenance({
      analysis: analysis([
        { ...impact('file:aggregator', ['transitive-structural']), likelihood: 'likely' },
      ]),
      graph: graph(),
      specificationText: SPEC_TEXT,
    });
    expect(result.analysis.requirementImpacts[0]?.evidenceProvenance).toBe('TRANSITIVE');
  });
});

describe('isUserSupplied', () => {
  it('matches on the basename when the specification writes a path', () => {
    const supplied = suppliedIdentifiers('Update services/newsletter/send_service.py.');
    expect(isUserSupplied(graph(), 'file:send_service', supplied)).toBe(true);
    expect(isUserSupplied(graph(), 'file:aggregator', supplied)).toBe(false);
  });
});

// ADR-0025 — the role axis rides on the same pass, because it reads the provenance decided here.
describe('assignEvidenceProvenance — planning roles', () => {
  const analysisOf = (impacts: readonly RequirementImpact[]): ImpactAnalysis => ({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-12T00:00:00.000Z',
    status: 'draft',
    requirementImpacts: [...impacts],
    architecturalOptions: [],
    warnings: [],
    userDecisions: [],
  });

  it('stores the role, the deciding rule, and a reason on every impact', () => {
    const assigned = assignEvidenceProvenance({
      analysis: analysisOf([impact('file:aggregator', ['direct-structural'])]),
      graph: graph(),
      specificationText: 'The aggregator must publish a digest.',
    });
    const [first] = assigned.analysis.requirementImpacts;
    expect(first?.planningRole).toBe('planning-impact');
    expect(first?.planningRoleRule).toBe('structural-obligation');
    expect(first?.planningRoleReason?.length ?? 0).toBeGreaterThan(20);
  });

  /**
   * The reason the role is assigned HERE and not in `classifyCandidate`: a component a constraint
   * selected is only known to be constraint-derived after the preflight pass, and that pass re-runs
   * this whole assignment. Deriving the role earlier would file every guard-selected surface as
   * ordinary reachability.
   */
  it('re-roles a constraint-derived surface that would otherwise be mere reachability', () => {
    const reachable = impact('file:aggregator', ['transitive-structural']);
    const base = assignEvidenceProvenance({
      analysis: analysisOf([{ ...reachable, likelihood: 'possible' }]),
      graph: graph(),
      specificationText: 'Something unrelated.',
    });
    expect(base.analysis.requirementImpacts[0]?.planningRole).toBe('dependency-context');

    const derived = assignEvidenceProvenance({
      analysis: analysisOf([{ ...reachable, likelihood: 'possible' }]),
      graph: graph(),
      specificationText: 'Something unrelated.',
      constraintDerivedNodeIds: new Set(['file:aggregator']),
    });
    expect(derived.analysis.requirementImpacts[0]?.planningRole).toBe('planning-impact');
    expect(derived.analysis.requirementImpacts[0]?.planningRoleRule).toBe('adversarially-derived');
  });

  it('summarises the split so every surface repeats one sentence', () => {
    const assigned = assignEvidenceProvenance({
      analysis: analysisOf([
        impact('file:aggregator', ['direct-structural']),
        { ...impact('file:digest_builder', ['transitive-structural']), likelihood: 'possible' },
      ]),
      graph: graph(),
      specificationText: 'Something unrelated.',
    });
    expect(assigned.planningSignal.planningImpactCount).toBe(1);
    expect(assigned.planningSignal.dependencyContextCount).toBe(1);
    expect(assigned.planningSignal.planningShare).toBe(0.5);
  });
});
