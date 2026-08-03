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

export const SAMPLE_EVALUATIONS: readonly SampleEvaluation[] = [
  {
    name: 'deal filtering (§46 milestone case)',
    specFileName: 'sample-deal-filtering.md',
    specText: '# Deal filtering\nDealService must filter expired deals from search results.\n',
    groundTruth: {
      directImpacts: ['DealService'],
      // BaseService (inheritance) and DealRepository (data access) are not named in the text.
      minSurprises: 2,
      // Filtering expired deals plausibly touches the base class it extends, the repository the
      // query runs through, the Searchable contract behind "search results", and the factory
      // whose signature would follow.
      allowedImpacts: [
        'DealService',
        'deal-service.ts',
        'BaseService',
        'DealRepository',
        'Searchable',
        'buildDealService',
      ],
      possibleTier: [
        {
          nodeId: 'file:src/services/deal-service.test.ts',
          verdict: 'allowed',
          rationale:
            'the requirement changes observable behaviour of search(), and this file asserts it — a filtering change that leaves the test untouched is incomplete',
        },
        {
          nodeId: 'file:src/lib/base-service.ts',
          verdict: 'plausible',
          rationale:
            'declares the Searchable contract behind "search results"; a filter option would change it, unconditional filtering would not',
          reviewNeeded: true,
        },
        {
          nodeId: 'file:src/lib/deal-repository.ts',
          verdict: 'plausible',
          rationale:
            'expiry data has to come from somewhere; filtering in memory needs no repository change, filtering in the query does',
          reviewNeeded: true,
        },
        {
          nodeId: 'symbol:src/services/deal-service.test.ts#testBuildDealService',
          verdict: 'plausible',
          rationale:
            'harness for the tests that must change, but the requirement does not alter the constructor it wraps',
          reviewNeeded: true,
        },
        {
          nodeId: 'file:src/index.ts',
          verdict: 'unsupported',
          rationale:
            'pure `export *` barrel; filtering inside a method adds and removes no export, so the barrel cannot change',
        },
        {
          nodeId: 'file:src/lib/index.ts',
          verdict: 'unsupported',
          rationale: 'pure `export *` barrel over the repository — same reasoning',
        },
        {
          nodeId: 'symbol:src/lib/deal-repository.ts#createRepository',
          verdict: 'unsupported',
          rationale:
            'a zero-argument factory; filtering expired deals changes neither its signature nor its body',
        },
        {
          nodeId: 'package:ts-basic',
          verdict: 'unsupported',
          rationale:
            'the package node carries no actionable change for behaviour inside one method — pure CONTAINS propagation',
        },
      ],
    },
  },
  {
    name: 'repository counting',
    specFileName: 'sample-repository-count.md',
    specText:
      '# Deal counting\nDealRepository must expose a count method returning the number of stored deals.\n',
    groundTruth: {
      directImpacts: ['DealRepository'],
      // DealService and the deals API consume the repository without being named.
      minSurprises: 1,
      // `buildDealService` is deliberately absent: adding a method to the repository does not
      // change the factory that constructs a service around it. The engine promotes it to likely
      // on a direct-function-call signal, and that is the false positive this sample measures.
      allowedImpacts: ['DealRepository', 'deal-repository.ts', 'createRepository', 'DealService'],
      // Every possible-tier candidate here is unsupported. Adding a method to a class changes
      // neither its consumers nor its `export *` barrels, and nothing in this requirement reaches
      // the unrelated BaseService/Searchable pair the traversal walked to.
      possibleTier: [
        {
          nodeId: 'file:src/services/deal-service.ts',
          verdict: 'unsupported',
          rationale:
            'a consumer of the repository, but adding a count method obliges no caller to change',
          // Tension worth recording: `DealService` sits in allowedImpacts above at the likely tier,
          // which on this stricter reading was too generous. The flag marks the inconsistency
          // rather than quietly resolving it in either direction.
          reviewNeeded: true,
        },
        {
          nodeId: 'file:src/alias-user.ts',
          verdict: 'unsupported',
          rationale:
            'calls createRepository() and stores the result; a new method is invisible to it',
        },
        {
          nodeId: 'file:src/api/deals.ts',
          verdict: 'unsupported',
          rationale:
            'calls findAll(); the requirement asks only that count exist, not that the API expose it',
        },
        {
          nodeId: 'symbol:src/api/deals.ts#getDeals',
          verdict: 'unsupported',
          rationale: 'same — reads findAll() and is unaffected by an added method',
        },
        {
          nodeId: 'file:src/lib/index.ts',
          verdict: 'unsupported',
          rationale: '`export *` barrel; a class method is not a new export',
        },
        {
          nodeId: 'symbol:src/services/deal-service.test.ts#testBuildDealService',
          verdict: 'unsupported',
          rationale: 'a builder for a different class',
        },
        {
          nodeId: 'symbol:src/lib/base-service.ts#BaseService',
          verdict: 'unsupported',
          rationale: 'DealRepository does not extend it; reached only by walking through the graph',
        },
        {
          nodeId: 'symbol:src/lib/base-service.ts#Searchable',
          verdict: 'unsupported',
          rationale: 'a search contract, unrelated to counting stored deals',
        },
        {
          nodeId: 'package:ts-basic',
          verdict: 'unsupported',
          rationale: 'pure CONTAINS propagation to the package node',
        },
      ],
    },
  },
  {
    name: 'deal expiry data model',
    specFileName: 'sample-deal-expiry.md',
    specText: '# Deal expiry\nThe `Deal` model must track an expiration timestamp.\n',
    groundTruth: {
      directImpacts: ['Deal'],
      minSurprises: 0,
      allowedImpacts: ['Deal', 'schema.prisma'],
      possibleTier: [
        {
          nodeId: 'package:ts-basic',
          verdict: 'unsupported',
          rationale:
            'adding a column to a model does not change the package — CONTAINS propagation',
        },
      ],
      // "Deal" prefixes half the identifiers here. These pins do NOT guard the name-coverage
      // threshold — an exact match on `Deal` short-circuits similarity before coverage is
      // consulted — but they do catch a regression in exact-match precedence or traversal bounds.
      // The coverage threshold is guarded by the `Base` sample below, which has no exact match.
      forbiddenImpacts: ['DealService', 'DealRepository', 'buildDealService'],
    },
  },
  {
    // The name-coverage calibration guard. `Base` matches no component exactly, and the correct
    // answer is an unknown-concept warning rather than the similarly-named BaseService: a
    // specification naming something absent must not be quietly resolved to a near-name.
    // "Base" covers 4 of the 11 characters in "BaseService" (0.36), so loosening the coverage
    // threshold below that makes both names appear and fails this sample.
    name: 'absent component near-name',
    specFileName: 'sample-absent-base.md',
    specText:
      '# Shared logging\nThe `Base` helper must expose a shared logger for every service.\n',
    groundTruth: {
      directImpacts: [],
      minSurprises: 0,
      allowedImpacts: [],
      forbiddenImpacts: ['BaseService', 'base-service.ts'],
    },
  },
  {
    // Regression case for declared-dependency resolution. A specification naming a library used
    // to match nothing at all, and the analysis then said the change had no impact. Also pins the
    // single-package case: every dependency here is declared by 100% of packages, so a bare
    // ubiquity share made all of them un-anchorable.
    name: 'prisma client packaging',
    specFileName: 'sample-prisma-packaging.md',
    specText:
      '# Client packaging\nThe deployed bundle must contain the `prisma` client so the repository can open its database.\n',
    groundTruth: {
      directImpacts: ['prisma'],
      minSurprises: 1,
      allowedImpacts: ['prisma', 'ts-basic'],
    },
  },
];

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
