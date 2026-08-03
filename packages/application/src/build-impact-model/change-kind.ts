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
  | 'add-api'
  | 'change-api'
  | 'remove-api'
  | 'change-behavior'
  | 'change-data-shape'
  /** The contract for CREATING something changed: constructor, factory input, registration. */
  | 'change-construction'
  /** What must be supplied to instantiate or operate something changed. */
  | 'change-configuration'
  | 'unknown';

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
  /**
   * Construction and configuration are tested before the generic signature pattern, because both are
   * more specific readings of the same sentence. Deliberately NARROW: the wording must name a
   * changed CREATION contract — a constructor, a factory's inputs, a registration, or instantiation
   * itself. "Constructor-adjacent" is not enough; a requirement about a method on a class that
   * happens to be injected somewhere is not a construction change.
   */
  {
    pattern:
      /\b(constructor|instantiat\w+|construction|composition root|factory (input|argument|parameter)s?|provider registration|register(ed|s)? (the )?(provider|dependency|service))\b/i,
    kind: 'change-construction',
    compatibility: 'potentially-breaking',
  },
  {
    // Plurals are spelled out because `\bcredential\b` does not match "credentials" — a wording
    // sensitivity that silently returned `unknown` and left a sample constraining nothing.
    pattern:
      /\b(environment (variable|key)s?|config(uration)? (key|value|setting)s?|provider tokens?|credentials?|connection settings)\b/i,
    kind: 'change-configuration',
    compatibility: 'potentially-breaking',
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
  'change-construction': 'likely',
  'change-configuration': 'possible',
  unknown: 'possible',
};

/**
 * INJECTS proves CONSTRUCTION-TIME coupling, not arbitrary behavioural coupling. The consumer holds a
 * reference it was handed; it does not read the dependency's internals.
 *
 * So a change to how the dependency is created or configured reaches the consumer that constructs
 * it, and a change to what the dependency DOES does not. That is a narrower and more defensible rule
 * than routing or generic binding could support, which is why it is the first relationship to get
 * one.
 */
const INJECTS_OBLIGATION: Readonly<Record<ChangeKind, Obligation>> = {
  // The composition root supplies the arguments, so a changed creation contract lands on it.
  'change-construction': 'likely',
  // Whatever must be supplied to instantiate the dependency is supplied by whoever instantiates it.
  'change-configuration': 'likely',
  'remove-api': 'likely',
  'change-api': 'likely',
  // Not in the agreed table. Kept at the reference default rather than demoted, since a consumer
  // handed a differently-shaped dependency plausibly changes and silently weakening an existing
  // reading would be a tier move with no stated justification.
  'change-data-shape': 'likely',
  // A new method on an injected dependency obliges nothing of whoever constructed it.
  'add-api': 'possible',
  // Construction-time coupling says nothing about what the dependency does at run time.
  'change-behavior': 'possible',
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
  'change-construction': 'possible',
  'change-configuration': 'possible',
  unknown: 'possible',
};

const OBLIGATION_BY_RELATIONSHIP: Readonly<
  Record<string, Readonly<Record<ChangeKind, Obligation>>>
> = {
  CALLS: CALL_OBLIGATION,
  INJECTS: INJECTS_OBLIGATION,
};

export const obligationFor = (change: PredictedChange, edgeType: string): Obligation => {
  // §12.2.1: an unclassified relationship never promotes, whatever the change kind. Not knowing
  // what a relationship means cannot become evidence that the neighbour must change.
  if (edgeType === 'USES_UNKNOWN') {
    return 'possible';
  }
  // Relationships without their own table read as references — the weaker default. The routing
  // types, USES_MIDDLEWARE and REFERENCES_RESOURCE stay there deliberately: routing propagation
  // needs structured route contracts, which the graph does not yet carry.
  return (OBLIGATION_BY_RELATIONSHIP[edgeType] ?? REFERENCE_OBLIGATION)[change.kind];
};
