// Conditional propagation: the same graph relationship means different things depending on the
// shape of the predicted change. Adding a method to a class obliges no existing caller; changing a
// required parameter obliges every call site. Without this distinction any global rule about call
// edges is wrong in one direction or the other — permissive enough to promote callers of an additive
// change, or strict enough to hide callers of a breaking one.
//
// Inferred from EXPLICIT specification wording, never from semantic analysis of the described
// change. Unrecognised wording stays `unknown` and dependents stay at `possible`, which
// under-promotes rather than over-promotes. Nothing here is persisted: the change kind is derived
// from the requirement statement at analysis time and recorded in the impact's explanation, so it
// is auditable without a schema version.

export type ChangeKind =
  'add-api' | 'change-api' | 'remove-api' | 'change-behavior' | 'change-data-shape' | 'unknown';

export type Compatibility = 'additive' | 'potentially-breaking' | 'breaking' | 'unknown';

export interface PredictedChange {
  readonly kind: ChangeKind;
  readonly compatibility: Compatibility;
  /** The wording that produced this reading, quoted in explanations so a promotion is auditable. */
  readonly cue: string;
}

interface Pattern {
  readonly pattern: RegExp;
  readonly kind: ChangeKind;
  readonly compatibility: Compatibility;
}

/**
 * Ordered: the first match wins, so removal and signature changes are tested before the additive
 * verbs. "must remove the deprecated `count` method" reads as a removal, not an addition, even
 * though a naive scan finds both.
 */
const PATTERNS: readonly Pattern[] = [
  {
    pattern: /\b(remove|delete|drop|rename|replace)[sd]?\b/i,
    kind: 'remove-api',
    compatibility: 'breaking',
  },
  {
    pattern:
      /\b(signature|required (argument|parameter)|take (a|an|another)[\w\s-]{0,20}(argument|parameter)|accept (a|an)[\w\s-]{0,20}(argument|parameter))\b/i,
    kind: 'change-api',
    compatibility: 'potentially-breaking',
  },
  {
    pattern: /\b(payload|schema|response shape|data shape|serial[iz]s?ed?)\b/i,
    kind: 'change-data-shape',
    compatibility: 'potentially-breaking',
  },
  {
    pattern: /\b(add|introduce|expose|provide|offer)[sd]?\b/i,
    kind: 'add-api',
    compatibility: 'additive',
  },
  {
    pattern: /\b(filter|validate|calculate|compute|sort|order|reject|hide|include|exclude)[sd]?\b/i,
    kind: 'change-behavior',
    compatibility: 'unknown',
  },
];

/** Reads the change a requirement predicts from its own wording. Pure and case-insensitive. */
export const inferChange = (statement: string): PredictedChange => {
  for (const { pattern, kind, compatibility } of PATTERNS) {
    const match = pattern.exec(statement);
    if (match !== null) {
      return { kind, compatibility, cue: match[0].toLowerCase() };
    }
  }
  return { kind: 'unknown', compatibility: 'unknown', cue: 'no explicit change verb' };
};

/** What a reverse hop across a weak dependency edge obliges, given the predicted change. */
export type Obligation = 'likely' | 'possible';

const CALL_OBLIGATION: Readonly<Record<ChangeKind, Obligation>> = {
  // Adding an API obliges nobody: existing call sites keep compiling and keep meaning what they did.
  'add-api': 'possible',
  // A changed signature obliges every call site to pass the new shape.
  'change-api': 'likely',
  'remove-api': 'likely',
  // Behaviour changes may or may not reach a caller; the caller's code does not have to change.
  'change-behavior': 'possible',
  // Consumers read the shape, so a changed shape reaches them.
  'change-data-shape': 'likely',
  unknown: 'possible',
};

/**
 * Reverse imports and uses stay weaker than reverse calls at the same change kind. An import proves
 * the module was pulled in, not that the changed symbol is referenced — see the file-level evidence
 * limitation in docs/engineering/capability-limitations.md — so only outright removal, which breaks
 * the import itself, promotes them.
 */
const REFERENCE_OBLIGATION: Readonly<Record<ChangeKind, Obligation>> = {
  'add-api': 'possible',
  'change-api': 'possible',
  'remove-api': 'likely',
  'change-behavior': 'possible',
  'change-data-shape': 'likely',
  unknown: 'possible',
};

export const obligationFor = (change: PredictedChange, edgeType: string): Obligation =>
  edgeType === 'CALLS' ? CALL_OBLIGATION[change.kind] : REFERENCE_OBLIGATION[change.kind];
