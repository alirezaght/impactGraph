# Epic 03 — Framework Discovery (NestJS, Express, generic)

**Goal:** Framework adapters that enrich the raw code graph with architectural meaning: modules, controllers, routes, DI relationships, middleware, migrations, jobs, environment references.
**Spec:** §15.2, §31, §40.1, Epic B (§45)
**Phase:** 1–2 · **Depends on:** Epic 02

---

## Story 3.1 — Framework adapter interface & detection pipeline

**Acceptance criteria**

- [x] `FrameworkAdapter` interface matches §31 (`detect`, `enrich`) and lives in `packages/framework-adapters`.
- [x] Adapters run after language indexing and only add graph fragments; they never mutate language-level facts. _(first-wins merge; framework edges referencing nonexistent nodes are dropped with warnings)_
- [x] Detection results carry evidence (which manifest/dependency/decorator triggered them) and `framework-convention` provenance. _(decorator evidence ids on the detection + every emitted fact)_
- [x] Enabled/disabled per workspace via configuration. _(`disabledFrameworks` in `.impactgraph/config.yml`)_

**Tasks**

- [x] Define interface, registration, and ordering rules.
- [x] Implement detection from package manifests + import patterns. _(decorator-marker detection; manifest-dependency detection can strengthen it later)_
- [x] Contract tests for adapters. _(pipeline + golden tests; a reusable cross-adapter suite lands with the second framework adapter)_

## Story 3.2 — NestJS adapter

**Acceptance criteria**

- [x] Detects modules, controllers, providers, services, guards, interceptors, pipes, event handlers, scheduled jobs (§15.2). _(modules/controllers/providers/jobs/event handlers done; guards/interceptors/pipes decorators are captured as facts, enrichment rules pending)_
- [x] DI relationships become USES/DEPENDS_ON edges; routes become API-endpoint nodes with EXPOSES edges. _(DI from constructor-injection language facts; module imports → DEPENDS_ON; providers/controllers → OWNS)_
- [x] Routes are detected on the NestJS fixture repo (§40.1). _(GET /deals, GET /deals/:id, POST /deals with controller prefixes)_

**Tasks**

- [x] Parse decorators (`@Module`, `@Controller`, `@Injectable`, `@Get`…, `@Cron`, `@OnEvent`). _(extracted once by the TS language adapter as DecoratorFacts — framework adapters never re-parse)_
- [x] Resolve module imports/exports/providers into graph edges.
- [x] Extract route paths incl. controller prefixes.
- [x] Golden tests on NestJS fixture (§42.2). _(`test-kit/fixtures/nestjs-app`)_

## Story 3.3 — Express adapter

**Acceptance criteria**

- [x] Detects router definitions, middleware chains, route handlers, app entry points, imported service dependencies (§15.2). _(router/app creation, handler symbols, middleware USES edges; middleware ordering + entry-point nodes deferred)_
- [x] Router mounting (`app.use('/x', router)`) resolves to full route paths where statically derivable. _(cross-file: mounted router symbol resolved via import resolution → prefix applied to its registrations)_

**Tasks**

- [x] Detect express usage; extract `app.<verb>` / `router.<verb>` registrations. _(via generic module-level CallFacts from the TS adapter — no re-parsing)_
- [x] Model middleware ordering as edges. _(consecutive `app.use(fn)` middleware linked with TRIGGERS edges in registration order, framework-convention provenance — no vocabulary change; tested on express-app)_
- [x] Golden tests on Express fixture. _(`test-kit/fixtures/express-app`)_

## Story 3.4 — Generic detectors: tests, migrations, env, jobs, Docker/CI

**Acceptance criteria**

- [x] Database migrations are detected as Migration nodes with MIGRATES edges to schemas/tables where derivable (§6.2). _(migrations/ convention; MIGRATES to Prisma tables in the same tree)_
- [x] Environment-variable references are detected and become nodes/edges (§15.1). _(`process.env.X` and `process.env['X']` → environment-variable nodes + CONFIGURES edges, static-analysis)_
- [x] Scheduled jobs, message producers/consumers (generic patterns), Dockerfiles and CI config are detected where practical (§6.2). _(Dockerfiles + GitHub/GitLab CI as coarse nodes; jobs/events via NestJS adapter; generic pub/sub patterns deferred)_

**Tasks**

- [x] Migration-tool detection (Prisma migrate, TypeORM, Knex conventions). _(shared `migrations/` path convention covers all three)_
- [x] `process.env.X` / config-file reference extraction.
- [x] Dockerfile + CI workflow file detection (nodes only, coarse-grained).
- [x] Fixture-based tests for each detector.
