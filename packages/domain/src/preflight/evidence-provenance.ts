/**
 * WHERE an impact's evidence came from, as distinct from WHAT KIND of evidence it is.
 *
 * `evidence-basis.ts` already answers "what sort of proof is this" (a call site, a name
 * resemblance). It cannot answer the question that made the trials misleading: *did we find this,
 * or did the specification hand it to us?*
 *
 * When a specification says "modify send_service.py" and the engine reports `send_service.py` as a
 * required impact, the basis is honestly `direct-structural` — the file really is required. But
 * nothing was discovered. Counting that as evidence lets a plan's assessment rise purely because
 * the engine echoed its input, which is the single largest source of overstated confidence.
 */
export const EVIDENCE_PROVENANCES = [
  /** The specification named this file, symbol, or identifier. Confirmation, not discovery. */
  'USER_SUPPLIED',
  /** Found in the repository without the specification naming it. */
  'INDEPENDENTLY_DISCOVERED',
  /** Derived by following declared structure — containment, implementation, declaration. */
  'STRUCTURALLY_INFERRED',
  /** Derived from a repository constraint or guard. */
  'CONSTRAINT_DERIVED',
  /** Derived from the runtime/deployment topology rather than from source. */
  'RUNTIME_DERIVED',
  /** Reached over two or more hops from something else. */
  'TRANSITIVE',
  /** Text overlapped. Nothing was established. */
  'WEAK_LEXICAL',
] as const;

export type EvidenceProvenance = (typeof EVIDENCE_PROVENANCES)[number];

export const isEvidenceProvenance = (value: unknown): value is EvidenceProvenance =>
  typeof value === 'string' && (EVIDENCE_PROVENANCES as readonly string[]).includes(value);

/**
 * How much a provenance contributes to *independent* evidence, 0..1.
 *
 * USER_SUPPLIED is deliberately near-zero rather than zero: an echo is worth something (it confirms
 * the named component exists at this revision, which is itself a check that can fail) but it must
 * never carry a plan.
 */
const INDEPENDENCE_WEIGHT: Readonly<Record<EvidenceProvenance, number>> = {
  USER_SUPPLIED: 0.1,
  INDEPENDENTLY_DISCOVERED: 1,
  CONSTRAINT_DERIVED: 1,
  RUNTIME_DERIVED: 0.9,
  STRUCTURALLY_INFERRED: 0.7,
  TRANSITIVE: 0.4,
  WEAK_LEXICAL: 0.1,
};

export const independenceWeight = (provenance: EvidenceProvenance): number =>
  INDEPENDENCE_WEIGHT[provenance];

/**
 * Provenances that count toward "the engine learned something the reader did not already state".
 * Everything else is confirmation or noise.
 */
export const INDEPENDENT_PROVENANCES: readonly EvidenceProvenance[] = [
  'INDEPENDENTLY_DISCOVERED',
  'CONSTRAINT_DERIVED',
  'RUNTIME_DERIVED',
  'STRUCTURALLY_INFERRED',
];

export const isIndependent = (provenance: EvidenceProvenance): boolean =>
  INDEPENDENT_PROVENANCES.includes(provenance);

/**
 * Absence is read as the weakest interpretation, matching how a missing evidence basis is read.
 * An analysis stored before this field existed must not be treated as independently evidenced.
 */
export const provenanceOf = (value: EvidenceProvenance | undefined): EvidenceProvenance =>
  value ?? 'WEAK_LEXICAL';

export interface EvidenceIndependence {
  /** Impacts whose provenance counts as independent. */
  readonly independentCount: number;
  /** Impacts that only confirm something the specification already named. */
  readonly confirmationCount: number;
  /** Summed independence weight — the figure assessment uses, never a raw count. */
  readonly weightedIndependence: number;
  readonly totalCount: number;
  /**
   * The completeness claim, stated honestly: how much of this analysis was discovered versus
   * handed over. One sentence, deterministic, composed here so every surface says the same thing.
   */
  readonly statement: string;
}

const independenceStatement = (
  independent: number,
  confirmation: number,
  total: number,
): string => {
  if (total === 0) {
    return 'No impacts were assessed for evidence independence.';
  }
  const weak = total - independent - confirmation;
  const clauses = [
    `${String(independent)} of ${String(total)} impacts were independently discovered`,
  ];
  if (confirmation > 0) {
    clauses.push(`${String(confirmation)} confirm components the specification itself named`);
  }
  if (weak > 0) {
    clauses.push(`${String(weak)} rest on weak lexical or transitive matches`);
  }
  return `${clauses.join('; ')}.`;
};

/** Summarise a set of impact provenances. Pure; the caller supplies the list. */
export const summariseIndependence = (
  provenances: readonly (EvidenceProvenance | undefined)[],
): EvidenceIndependence => {
  const resolved = provenances.map(provenanceOf);
  const independentCount = resolved.filter(isIndependent).length;
  const confirmationCount = resolved.filter((provenance) => provenance === 'USER_SUPPLIED').length;
  return {
    independentCount,
    confirmationCount,
    weightedIndependence:
      Math.round(
        resolved.reduce((sum, provenance) => sum + independenceWeight(provenance), 0) * 100,
      ) / 100,
    totalCount: resolved.length,
    statement: independenceStatement(independentCount, confirmationCount, resolved.length),
  };
};

/**
 * The label a report shows. Keeping this in the domain stops each surface from inventing its own
 * wording for the distinction the whole mechanism exists to make.
 *
 * Three labels, not two: calling a weak lexical or transitive match a "discovery" would let the
 * label contradict the independence count that excludes it. What the engine merely suspects is a
 * `lead`.
 */
export type ProvenanceLabel = 'confirmation' | 'discovery' | 'lead';

export const provenanceLabel = (provenance: EvidenceProvenance): ProvenanceLabel => {
  if (provenance === 'USER_SUPPLIED') {
    return 'confirmation';
  }
  return isIndependent(provenance) ? 'discovery' : 'lead';
};
