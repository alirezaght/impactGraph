// The ts-basic ground-truth samples (PRD §44 Phase 0, Story 17.1). Split out of evaluation.ts,
// which owns the ground-truth TYPES: the judgments grow every time a propagation rule needs a
// counterexample, and keeping them beside the type definitions pushed that file past the effective-LOC
// limit. Ground truth is a human judgment about what a correct analysis must contain — it is never
// regenerated from engine output, which would make the §41 metrics measure nothing.

import type { SampleEvaluation } from './evaluation.js';

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
          nodeId: 'symbol:src/services/deal-service.ts#buildDealService',
          verdict: 'unsupported',
          rationale:
            'a zero-argument factory that constructs the service; filtering inside search() changes neither its signature nor its body',
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
      // Ground truth states the obligations the specification implies, not one plausible
      // implementation path. `buildDealService` and `DealService` are both deliberately absent:
      // the count method may well be surfaced through the service, but nothing in "DealRepository
      // must expose a count method" obliges a caller or a factory to change. Keeping DealService
      // here would have given the precision gate a convenient lower bound at the cost of encoding
      // a label known to be wrong.
      allowedImpacts: ['DealRepository', 'deal-repository.ts'],
      // Every possible-tier candidate here is unsupported. Adding a method to a class changes
      // neither its consumers nor its `export *` barrels, and nothing in this requirement reaches
      // the unrelated BaseService/Searchable pair the traversal walked to.
      possibleTier: [
        {
          nodeId: 'symbol:src/lib/deal-repository.ts#createRepository',
          verdict: 'unsupported',
          rationale:
            'a factory returning the repository; adding a method to the class it constructs changes neither its signature nor its body',
        },
        {
          nodeId: 'symbol:src/services/deal-service.ts#DealService',
          verdict: 'unsupported',
          rationale: 'a caller of the repository — an added method obliges no existing caller',
        },
        {
          nodeId: 'symbol:src/services/deal-service.ts#buildDealService',
          verdict: 'unsupported',
          rationale: 'constructs a service around the repository; unaffected by an added method',
        },
        {
          nodeId: 'file:src/services/deal-service.ts',
          verdict: 'unsupported',
          rationale:
            'a consumer of the repository, but adding a count method obliges no caller to change',
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
    // The POSITIVE counterexample to the additive case above. `createRepository` is called by
    // alias-user.ts and by getDeals via a renamed import; giving it a required argument is a
    // BREAKING signature change, so every caller genuinely must change. Without this sample,
    // "adding a method must not promote callers" could be satisfied by making callers invisible
    // whenever a signature actually changes.
    //
    // The engine cannot yet tell the two apart: it models no change kind, so a reverse call edge
    // looks identical either way, and the conservative rule holds the callers at `possible`. That
    // shortfall is pinned rather than hidden — closing it is what change-contract semantics buys.
    name: 'breaking factory signature',
    specFileName: 'sample-breaking-factory.md',
    specText:
      '# Connection strings\n`createRepository` must take a connection string argument, so every call site passes one.\n',
    groundTruth: {
      directImpacts: ['createRepository'],
      minSurprises: 0,
      allowedImpacts: ['createRepository', 'deal-repository.ts', 'DealRepository', 'getDeals'],
      // `getDeals` is now correctly promoted: change-contract semantics read "take a connection
      // string argument" as a potentially-breaking signature change, so a reverse CALLS hop obliges
      // the call site. What remains pinned is file-level: the FILES holding those call sites sit two
      // hops out, and file-level import evidence cannot show that the changed symbol is referenced
      // there — see docs/engineering/capability-limitations.md. Symbol-level imports would close it.
      shouldBeLikelyButIsNot: ['alias-user.ts', 'deals.ts'],
      // Note how differently this tail labels from the additive samples: for a BREAKING change the
      // call sites belong in the result, and three of seven possible candidates are allowed rather
      // than one of nine. The labels discriminate by change kind even though the engine cannot.
      possibleTier: [
        {
          nodeId: 'file:src/api/deals.ts',
          verdict: 'allowed',
          rationale: 'holds that call site',
        },
        {
          nodeId: 'file:src/alias-user.ts',
          verdict: 'allowed',
          rationale: 'calls createRepository() directly and must pass the new argument',
        },
        {
          nodeId: 'file:src/lib/index.ts',
          verdict: 'unsupported',
          rationale: '`export *` barrel; a changed signature adds and removes no export',
        },
        {
          nodeId: 'symbol:src/services/deal-service.ts#buildDealService',
          verdict: 'unsupported',
          rationale: 'constructs DealRepository directly with new, never through createRepository',
        },
        {
          nodeId: 'symbol:src/services/deal-service.ts#DealService',
          verdict: 'unsupported',
          rationale: 'receives a repository instance; it never calls the factory',
        },
        {
          nodeId: 'package:ts-basic',
          verdict: 'unsupported',
          rationale: 'CONTAINS propagation to the package node',
        },
      ],
    },
  },
  {
    // INJECTS propagation, positive case. DealService receives a DealRepository through its
    // constructor, so a changed CREATION contract lands on whoever constructs the service. Paired
    // with `repository counting`, where an additive method on the same class must NOT promote it.
    name: 'repository construction contract',
    specFileName: 'sample-repository-construction.md',
    specText:
      '# Connection pooling\nThe `DealRepository` constructor must take a connection pool, so every composition root supplies one.\n',
    groundTruth: {
      directImpacts: ['DealRepository'],
      minSurprises: 1,
      allowedImpacts: [
        'DealRepository',
        'deal-repository.ts',
        'DealService',
        'createRepository',
        'buildDealService',
      ],
      possibleTier: [
        {
          nodeId: 'file:src/alias-user.ts',
          verdict: 'allowed',
          rationale:
            'calls createRepository() with no arguments; "every composition root supplies one" names this call site',
        },
        {
          nodeId: 'file:src/api/deals.ts',
          verdict: 'allowed',
          rationale: 'holds a call site to the factory that constructs the repository',
        },
        {
          nodeId: 'symbol:src/api/deals.ts#getDeals',
          verdict: 'allowed',
          rationale: 'calls the factory through a renamed import and must supply the pool',
        },
        {
          nodeId: 'file:src/services/deal-service.ts',
          verdict: 'plausible',
          rationale: 'the file containing the promoted composition root',
          reviewNeeded: true,
        },
        {
          nodeId: 'symbol:src/services/deal-service.test.ts#testBuildDealService',
          verdict: 'plausible',
          rationale:
            'a test builder that constructs the service, so a creation contract may reach it',
          reviewNeeded: true,
        },
        {
          nodeId: 'file:src/lib/index.ts',
          verdict: 'unsupported',
          rationale: '`export *` barrel; a constructor signature adds and removes no export',
        },
        {
          nodeId: 'package:ts-basic',
          verdict: 'unsupported',
          rationale: 'CONTAINS propagation to the package node',
        },
        {
          nodeId: 'symbol:src/lib/base-service.ts#BaseService',
          verdict: 'unsupported',
          rationale:
            'DealRepository does not extend it; unrelated to how the repository is created',
        },
        {
          nodeId: 'symbol:src/lib/base-service.ts#Searchable',
          verdict: 'unsupported',
          rationale: 'a search contract, unrelated to construction',
        },
      ],
    },
  },
  {
    // The configuration half of the INJECTS table, and it must be worded to reach it. A first
    // attempt said "supplied at construction", which trips the construction pattern instead and
    // left change-configuration unconstrained — the exact hole this sample exists to close. The
    // expected outcome also DIFFERS from the construction sample: configuration promotes the
    // injecting consumer, because whoever constructs supplies the configuration, but not the
    // factories that merely call the constructor.
    // A second wording problem worth recording: "must read its connection settings from the
    // DATABASE_URL environment key" reads as change-configuration but describes the repository
    // reading configuration ITSELF, which obliges no consumer — so promoting the injecting consumer
    // would have been a false positive, and the sample would have recorded behaviour instead of
    // constraining the rule. The rule's premise is configuration SUPPLIED to the dependency.
    name: 'repository configuration key',
    specFileName: 'sample-repository-config.md',
    specText:
      '# Database credentials\nThe `DealRepository` must be given its credentials by whatever wires it, rather than reading the environment itself.\n',
    groundTruth: {
      directImpacts: ['DealRepository'],
      minSurprises: 1,
      // Deliberately SHORTER than the construction sample's set. Configuration promotes only the
      // injecting consumer, because whoever wires the dependency supplies its credentials; the
      // factories that merely call the constructor are reached by CALLS, where configuration does
      // not promote. That difference is the whole point of INJECTS having its own table.
      allowedImpacts: ['DealRepository', 'deal-repository.ts', 'DealService'],
      possibleTier: [
        {
          nodeId: 'symbol:src/lib/deal-repository.ts#createRepository',
          verdict: 'plausible',
          rationale:
            'constructs the repository, so it is a candidate for passing credentials through — but only if credentials enter at the factory rather than above it',
          reviewNeeded: true,
        },
        {
          nodeId: 'symbol:src/services/deal-service.ts#buildDealService',
          verdict: 'plausible',
          rationale: 'constructs a repository for the service; same conditional as the factory',
          reviewNeeded: true,
        },
        {
          nodeId: 'file:src/services/deal-service.ts',
          verdict: 'plausible',
          rationale: 'the file containing the promoted injecting consumer',
          reviewNeeded: true,
        },
        {
          nodeId: 'file:src/alias-user.ts',
          verdict: 'plausible',
          rationale: 'a call site that would supply credentials if they enter at this level',
          reviewNeeded: true,
        },
        {
          nodeId: 'file:src/api/deals.ts',
          verdict: 'plausible',
          rationale: 'same — a call site whose obligation depends on where credentials enter',
          reviewNeeded: true,
        },
        {
          nodeId: 'symbol:src/api/deals.ts#getDeals',
          verdict: 'plausible',
          rationale: 'same, at symbol granularity',
          reviewNeeded: true,
        },
        {
          nodeId: 'symbol:src/services/deal-service.test.ts#testBuildDealService',
          verdict: 'plausible',
          rationale: 'a test builder that would have to supply credentials',
          reviewNeeded: true,
        },
        {
          nodeId: 'file:src/lib/index.ts',
          verdict: 'unsupported',
          rationale: '`export *` barrel; supplying credentials changes no export',
        },
        {
          nodeId: 'package:ts-basic',
          verdict: 'unsupported',
          rationale: 'CONTAINS propagation to the package node',
        },
        {
          nodeId: 'symbol:src/lib/base-service.ts#BaseService',
          verdict: 'unsupported',
          rationale: 'unrelated to how the repository receives credentials',
        },
        {
          nodeId: 'symbol:src/lib/base-service.ts#Searchable',
          verdict: 'unsupported',
          rationale: 'a search contract, unrelated to credentials',
        },
      ],
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
