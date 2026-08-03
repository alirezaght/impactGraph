// Phase-0 validation assets (PRD §44 Phase 0, Story 17.1): three sample specifications with
// HAND-WRITTEN ground truth against the ts-basic reference fixture. Ground truth is a human
// judgment about what a correct impact analysis must contain — it is never regenerated from
// engine output (that would make the §41 metrics meaningless).

export interface ImpactGroundTruth {
  /** Component names a correct analysis MUST surface as required/likely (direct set, §41.1). */
  readonly directImpacts: readonly string[];
  /**
   * Minimum number of relevant components the analysis must surface that the specification
   * text does NOT name — the §41.5 / §46 "surprise" cases.
   */
  readonly minSurprises: number;
  /**
   * CLOSED set of every name that may legitimately appear at required/likely, `directImpacts`
   * included. This is what makes offline precision computable: without a closed set, a name the
   * ground truth does not mention is indistinguishable from an unlabeled true positive, so the
   * only honest measure is recall. Anything at that tier outside this set is a false positive.
   *
   * Omit it when the sample is not exhaustively labeled — precision is then reported but not
   * gated, rather than silently computed against an incomplete list.
   */
  readonly allowedImpacts?: readonly string[];
  /**
   * Names that must NOT appear at ANY tier. Regression pins for false positives that were
   * observed and fixed: cheap to write, and they fail loudly if the matching rules regress.
   */
  readonly forbiddenImpacts?: readonly string[];
  /**
   * Judgment on each POSSIBLE-tier candidate, keyed by node id because the tier contains several
   * components sharing a name (three `index.ts` files, for one). Labelled against the requirement
   * AS WRITTEN — not against everything a developer might touch while implementing it, which
   * would make almost every graph neighbour "plausible" and the inclusive figure meaningless.
   */
  readonly possibleTier?: readonly PossibleTierLabel[];
  /**
   * A direct-precision shortfall that is understood and not yet fixed, pinned to its exact current
   * value in BOTH directions. Lowering the shared gate to accommodate one sample would blunt it for
   * every other sample; asserting equality keeps the gate at full strength while making this
   * failure visible, and forces a deliberate review when it improves as well as when it degrades.
   */
  readonly knownDirectPrecision?: {
    readonly value: number;
    readonly reason: string;
  };
  /**
   * Components a correct analysis OUGHT to surface at required/likely and currently does not,
   * asserted as absent. Pinned in both directions like `unreachedNames` on the cross-stack samples:
   * a documented gap that quietly starts passing is a change nobody reviewed.
   */
  readonly shouldBeLikelyButIsNot?: readonly string[];
}

/**
 * allowed     — genuinely expected architectural impact; omitting it makes the result incomplete.
 * plausible   — defensible secondary impact, but not required and not safe to present as likely.
 * unsupported — no requirement-backed reason to include it.
 */
export type PossibleTierVerdict = 'allowed' | 'plausible' | 'unsupported';

export interface PossibleTierLabel {
  readonly nodeId: string;
  readonly verdict: PossibleTierVerdict;
  /** Why, in terms of the requirement. One author's judgment, recorded so it can be argued with. */
  readonly rationale: string;
  /** Borderline: the verdict is contestable and should not be treated as settled ground truth. */
  readonly reviewNeeded?: boolean;
}

export interface SampleEvaluation {
  readonly name: string;
  readonly specFileName: string;
  readonly specText: string;
  readonly groundTruth: ImpactGroundTruth;
}

/**
 * Story 16.7 / PRD §C16 — the same assets against the `cross-stack` fixture, where the point is
 * not accuracy but REACH: a specification written about one stack must surface the components of
 * the others that share the system with it.
 *
 * Kept separate from `SAMPLE_EVALUATIONS` on purpose. Those three carry the §41 accuracy metrics
 * against the TypeScript reference repository, and folding a multi-stack repository into that set
 * would silently change what those metrics measure.
 *
 * `crossStackNames` is the part that matters: component names from a stack the specification text
 * never mentions. If an analysis stops at the language boundary, this list is what goes missing.
 */
export interface CrossStackEvaluation extends SampleEvaluation {
  /** Names that prove the analysis crossed a stack boundary, grouped by the stack they live in. */
  readonly crossStackNames: Readonly<Record<string, readonly string[]>>;
  /**
   * Names a reader would reasonably expect and the engine does NOT surface today, asserted as
   * absent. A documented gap that quietly starts passing is a change nobody reviewed, so this is
   * pinned in both directions — when the gap is closed the assertion fails and the note gets
   * deleted deliberately.
   */
  readonly unreachedNames?: readonly string[];
}

export const CROSS_STACK_EVALUATIONS: readonly CrossStackEvaluation[] = [
  {
    name: 'deals api surface',
    specFileName: 'sample-deals-api.md',
    specText:
      '# Deals API\nThe `list_deals` endpoint must return an expiry date on every deal.\n' +
      'The `deals-web` front end must show it.\n',
    groundTruth: {
      // Python: the FastAPI endpoint the specification is written about.
      directImpacts: ['list_deals'],
      minSurprises: 1,
    },
    crossStackNames: {
      // Terraform: `deals-web` is BOTH an npm package and the declared name of a Cloud Run
      // service. Nothing in the source names the service and nothing in the .tf names the
      // package — the analysis reaches it only through the name correspondence 16.6 established,
      // which is a code-to-infrastructure crossing no single-language analysis can make.
      terraform: ['deals-web'],
      // Python: the endpoint itself and the module that declares it.
      python: ['list_deals', 'main.py'],
      // HTTP surface: the route the Python handler EXPOSES, and — one hop further — the
      // TypeScript caller that USES that same route. Reaching `loadDeals` from a spec that names
      // only `list_deals` is the whole cross-stack claim in one assertion: two languages, joined
      // through a route neither file mentions by the other's name.
      http: ['GET /api/deals', 'loadDeals'],
    },
    // GAP CLOSED 2026-08-02: `EXPOSES` was missing from `IMPACT_EDGE_TYPES`, so `list_deals`
    // reached its handler but never `route:GET /api/deals` — and therefore never the front-end
    // caller that reaches the same route by `USES`. The edge is now walked, and both names are
    // asserted as REACHED in `crossStackNames` instead of pinned as absent. This note stays as
    // the record of why the traversal roster gained an entry (epic-16, Story 16.7).
  },
  {
    name: 'deal events topic',
    specFileName: 'sample-deal-events.md',
    specText:
      '# Deal events\nEvery deal change must be published to the `deal-events` topic so the ' +
      'worker can react to it.\n',
    groundTruth: {
      directImpacts: ['deal-events'],
      minSurprises: 2,
    },
    crossStackNames: {
      // One topic, three publishers, in three languages — the §C13 claim, stated as an assertion.
      python: ['publish_deal'],
      typescript: ['publishDealCreated'],
      java: ['DealEventBridge.republishDeal'],
      // The Terraform resource, reached from the code-side topic through its DEPLOYED_AS edge.
      terraform: ['deal_events'],
    },
  },
];
