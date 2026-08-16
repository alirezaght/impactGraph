import { evidenceTypesOf, primaryEvidenceType, summariseIndependence } from '@impactgraph/domain';

import type {
  EvidenceIndependence,
  EvidenceProvenance,
  ImpactAnalysis,
  ImpactEvidenceType,
  KnowledgeGraph,
  NodeId,
  RequirementImpact,
} from '@impactgraph/domain';

/**
 * Decide, for every impact, whether the engine discovered it or the specification handed it over.
 *
 * The trial that prompted this: a specification listed `send_service.py`, `issue_routes.py`,
 * `subscription_repository.py` and `NewsletterListWorkspace.astro`, and the analysis returned those
 * four files as required-tier impacts. Every label was defensible and the result was worth nothing —
 * it matched filenames supplied by the user back to the user, at the highest confidence available.
 *
 * The fix is not to hide them. A file the specification named genuinely is required, and dropping
 * it would make the output wrong as well as useless. The fix is to say which is which, so a reader
 * — and the assessment — can tell an echo from a discovery.
 */

/** Basis → the provenance it implies when the specification did NOT name the component. */
const PROVENANCE_BY_BASIS: Readonly<Record<ImpactEvidenceType, EvidenceProvenance>> = {
  'direct-structural': 'INDEPENDENTLY_DISCOVERED',
  'async-event': 'STRUCTURALLY_INFERRED',
  'external-contract': 'STRUCTURALLY_INFERRED',
  'field-data-flow': 'STRUCTURALLY_INFERRED',
  'configuration-asset': 'STRUCTURALLY_INFERRED',
  'transitive-structural': 'TRANSITIVE',
  'name-similarity': 'WEAK_LEXICAL',
  'semantic-match': 'WEAK_LEXICAL',
  'lexical-only': 'WEAK_LEXICAL',
};

/**
 * Identifiers the specification states outright.
 *
 * Only forms a writer would have had to KNOW are counted: a path, a filename with its extension, or
 * a symbol in a shape that reads as an identifier (`send_service`, `NewsletterListWorkspace`,
 * `ItemType.ANGEBOT`). Ordinary prose words are excluded deliberately — treating "newsletter" as a
 * supplied identifier would mark half the repository as an echo and destroy the distinction.
 */
const IDENTIFIER =
  /\b[\w./-]*[\w-]+\.(?:[a-z]{1,5})\b|\b\w*[a-z0-9]_[\w_]+\b|\b[A-Z][a-zA-Z0-9]{3,}\b/g;

export const suppliedIdentifiers = (specificationText: string): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const match of specificationText.matchAll(IDENTIFIER)) {
    const token = match[0];
    if (token.length >= 4) {
      found.add(token.toLowerCase());
      const base = token.split('/').pop();
      if (base !== undefined && base.length >= 4) {
        found.add(base.toLowerCase());
      }
    }
  }
  return found;
};

const namesFor = (graph: KnowledgeGraph, nodeId: string): readonly string[] => {
  const node = graph.nodes.get(nodeId as NodeId);
  if (node === undefined) {
    return [];
  }
  const path = node.path;
  const base = path?.split('/').pop();
  return [node.name, path, base].filter((value): value is string => value !== undefined);
};

/** True when the specification text names this component outright. */
export const isUserSupplied = (
  graph: KnowledgeGraph,
  nodeId: string,
  supplied: ReadonlySet<string>,
): boolean =>
  namesFor(graph, nodeId).some((name) => {
    const lower = name.toLowerCase();
    return supplied.has(lower) || supplied.has(lower.split('/').pop() ?? lower);
  });

export interface AssignProvenanceInput {
  readonly analysis: ImpactAnalysis;
  readonly graph: KnowledgeGraph;
  /** The specification exactly as submitted — the only source of "what the user supplied". */
  readonly specificationText: string;
  /** Impacts whose selection came from a constraint or a runtime path, by node id. */
  readonly constraintDerivedNodeIds?: ReadonlySet<string>;
  readonly runtimeDerivedNodeIds?: ReadonlySet<string>;
}

const provenanceFor = (
  impact: RequirementImpact,
  input: AssignProvenanceInput,
  supplied: ReadonlySet<string>,
): EvidenceProvenance => {
  // A component the specification named is confirmation regardless of anything else — including a
  // constraint finding citing it. The finding is the discovery; the file the user typed is not,
  // and relabelling it as derived would let an echo inflate the independence count.
  if (isUserSupplied(input.graph, impact.nodeId, supplied)) {
    return 'USER_SUPPLIED';
  }
  if (input.constraintDerivedNodeIds?.has(impact.nodeId) === true) {
    return 'CONSTRAINT_DERIVED';
  }
  if (input.runtimeDerivedNodeIds?.has(impact.nodeId) === true) {
    return 'RUNTIME_DERIVED';
  }
  return PROVENANCE_BY_BASIS[primaryEvidenceType(evidenceTypesOf(impact))];
};

export interface ProvenanceAssignment {
  readonly analysis: ImpactAnalysis;
  readonly independence: EvidenceIndependence;
}

export const assignEvidenceProvenance = (input: AssignProvenanceInput): ProvenanceAssignment => {
  const supplied = suppliedIdentifiers(input.specificationText);
  const impacts = input.analysis.requirementImpacts.map((impact) => ({
    ...impact,
    evidenceProvenance: provenanceFor(impact, input, supplied),
  }));
  return {
    analysis: { ...input.analysis, requirementImpacts: impacts },
    independence: summariseIndependence(impacts.map((impact) => impact.evidenceProvenance)),
  };
};
