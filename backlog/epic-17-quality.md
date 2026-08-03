# Epic 17 — Testing Infrastructure & Quality Metrics

**Goal:** The fixture repositories, golden-test harness, integration/security suites and metric instrumentation that every other epic's AC depend on.
**Spec:** §41, §42, §44 Phase 0, §46
**Phase:** cross-cutting (starts Phase 0) · **Depends on:** Epic 01

---

## Story 17.1 — Phase-0 validation assets

**Acceptance criteria**

- [x] Three sample specifications written (§44 Phase 0). _(`packages/test-kit/src/evaluation.ts`: deal filtering (§46 case), repository counting, deal-expiry data model)_
- [x] A reference TypeScript repository exists with manually produced ground-truth impact maps for each sample spec (§44 Phase 0). _(ts-basic is the reference repo; ground truth is hand-written in test-kit and NEVER regenerated from engine output)_
- [x] The reference repo contains at least one dependency not explicitly named in any spec — the Milestone 1 "surprise" case (§46). _(BaseService/DealRepository for spec 1; asserted via minSurprises)_
- [ ] Workflow validated with at least a couple of developers; UX wireframes finalized (§44 Phase 0). _(**BLOCKED ON HUMANS — the only remaining work that tooling cannot do.** Wireframes: DONE (`docs/design/wireframes.md`). Validation: the instrument is ready — `docs/design/developer-walkthrough-protocol.md` has the 60-minute script, participant criteria (developers must bring repositories they already know, or they cannot catch a wrong answer), and a verbatim recording template. It stays open until real developers have run it; filling the Results section with anything but what a participant actually said would make the record worthless.)_

**Tasks**

- [x] Author sample specs (e.g. the deal-visibility example from §46).
- [x] Build reference repo + hand-written ground-truth impact YAML. _(TypeScript module instead of YAML — typed, reviewed the same way)_
- [ ] Run and document developer walkthrough feedback. _(**BLOCKED ON HUMANS.** Template and synthesis section prepared in `docs/design/developer-walkthrough-protocol.md`; closes when a session has been run and its Results section is filled from real answers.)_
- [x] Produce wireframes for spec panel, impact tree, evidence panel, review view. _(`docs/design/wireframes.md` — five frames (spec panel, impact tree, impact graph, evidence panel, review view) drawn from the surfaces that actually ship, so they serve as a review aid rather than a plan for something unbuilt. Each frame carries the constraints a redesign must not break: knowledge categories readable without colour, confidence never a bare number, absent data rendered as absent. A closing section lists what is deliberately NOT drawn (dagre dependency-flow view, current-vs-proposed edges) with reasons.)_

## Story 17.2 — Fixture repositories

**Acceptance criteria**

- [x] Fixtures exist per §42.2: TS Express app, NestJS app, FastAPI app, Java app, Astro app, Terraform GCP project, Cloud Run service, Pub/Sub publisher+consumer, monorepo, migration workflow. _(all ten present and INDEXED with committed graph goldens: express-app, nestjs-app, fastapi-app, java-spring, astro-site, terraform-gcp (incl. `google_cloud_run_service`), cross-stack (Pub/Sub publisher+consumer across Java/TS/Python against Terraform topics), monorepo (workspace packages + cross-package imports), ts-basic (prisma migration workflow); plus html-site, internal-pubsub and malicious beyond the §42.2 list. The monorepo fixture immediately earned its place — it exposed that workspace-package imports resolved to nothing, i.e. every cross-package edge in every monorepo was silently missing.)_
- [x] Fixtures are small, deterministic, and versioned in-repo. _(runtime-only hazards (symlinks, oversized) are created by tests, not committed)_

**Tasks**

- [x] Build fixtures incrementally, aligned with adapter delivery order (Epics 02, 03, 16). _(each fixture landed with its adapter and joined `test:analyzers` with a golden at that moment; the monorepo fixture landed last, with workspace-package resolution.)_
- [x] Add malicious-content fixture for security tests (shared with Epic 13). _(`packages/test-kit/fixtures/malicious` + §42.5 suite)_

## Story 17.3 — Golden-test harness

**Acceptance criteria**

- [x] For each fixture: expected graph nodes/edges, expected impact results for sample specs, expected review results for sample diffs are stored and diffed in CI (§42.3). _(all three golden kinds committed under packages/test-kit/goldens and diffed by the analyzers suite: graph goldens for ts-basic/express-app/nestjs-app/internal-pubsub, impact goldens for the three §41 sample specs (impacts with likelihood/type/confidence/signals + warning codes), and a working-tree review golden (matched/unexpected findings + coverage); the Epic 16 file fixtures get theirs as their adapters land)_
- [x] Golden updates are explicit (review-required snapshot update flow). _(mismatch fails test:analyzers with a regenerate-deliberately hint; UPDATE_GOLDENS=1 rewrites the committed .txt files, so every update is a reviewable diff)_

**Tasks**

- [x] Implement golden-file runner (graph/impact/review serializers with stable ordering). _(all three in test-kit: `serializeGraphGolden`, `serializeAnalysisGolden`, `serializeReviewGolden` — lexicographically sorted lines, volatile fields (snapshot/evidence/run IDs, timestamps) excluded, impacts keyed by component name so a node-id refactor does not churn goldens; `UPDATE_GOLDENS=1` regenerates deliberately and every failure message says so)_
- [x] Wire into CI with readable diffs. _(the analyzers suite already runs in CI, so the committed-golden comparison IS the CI diff — a failure prints the exact mismatching lines)_
- [x] Seed goldens for the TS/JS fixtures. _(packages/test-kit/goldens/{ts-basic,express-app,nestjs-app,internal-pubsub}.graph.txt)_

## Story 17.4 — VS Code integration test suite

**Acceptance criteria**

- [x] Automated coverage for: activation, commands, tree views, editor navigation, configuration editing, secret storage, webview communication, cancellation, error states (§42.4). _(all nine areas implemented in `apps/vscode-extension/src/test/suite/` — see that directory's README. Local run on macOS: trusted lane **48 passed / 0 failed / 0 skipped**, untrusted lane **4 passed / 0 failed**. Both former skips are now real tests. (1) SecretStorage set/get/delete round-trip: `activate()` returns a minimal API object, but the handle on `context.secrets` exists **only** when `context.extensionMode === ExtensionMode.Test` — `extension.exports` is readable by every installed extension, so an unconditional handle would undo the per-extension namespacing that is the whole point of SecretStorage (§35). The gate is unit-tested without Electron (`src/extension-api.test.ts`), and the lane additionally asserts the exported surface is frozen and carries nothing beyond the two declared keys. (2) Webview communication: a real round trip through the live panel — the React app's `webview/ready` arriving over the real transport, `post()` reporting actual delivery to the loaded webview, a contract-invalid host message refused before it leaves the host, `unsupported-protocol-version`/`unknown-type`/`malformed` refused on the inbound path, and `webview/select-node` in → `host/evidence` delivered back out. Earlier failures (activation writing `.impactgraph/` via the status bar; the bundles being unable to resolve `better-sqlite3`) were fixed in epic-07, not hidden.)_

**Tasks**

- [x] Set up @vscode/test-electron (or equivalent) harness in CI. _(`src/test/build.mjs` bundles the runner and both suite entries to CJS with esbuild — same path as the extension, no `tsc` emit; `dist/test/package.json` pins commonjs. `src/test/runner.ts` performs two launches (trusted + untrusted) with throwaway user-data/extensions/workspace dirs and a 20-minute watchdog. Scripts: `test:integration:vscode` in the extension + root passthrough — the root script was a silent no-op before (`pnpm --filter vscode-extension` matches nothing; the package is named `impactgraph`), so the `test-vscode-integration` CI job was passing vacuously. Fixed to a path filter. Suite runner is a ~90-line registry in `harness.ts` — no Mocha, no new dependency. The untrusted lane cannot use `runTests()` (@vscode/test-electron@3.1.0 hard-codes `--disable-workspace-trust`), so it spawns the downloaded executable directly via `launch.ts`. CI: `test-vscode-integration` now caches `.vscode-test` and actually runs — before this change the job was green without executing anything.)_
- [x] Implement the nine §42.4 test areas as suites (filled in alongside Epics 07–09, 11). _(activation · commands · tree views · editor navigation · configuration editing · secret storage · webview communication · cancellation · error states, plus a second untrusted-workspace lane for §35. Assertions are on command ids, files on disk and engine state — never notification text.)_

## Story 17.5 — Quality-metric instrumentation

**Acceptance criteria**

- [x] Measurable against ground truth: direct impact recall (target > 90%), overall precision via accepted-suggestion rate (> 70%), unsupported-claim rate (< 5%) (§41.1–41.3). _(recall + unsupported-claim measured and gated; accepted-suggestion rate needs real user decisions and is deliberately absent, not faked)_
- [x] Surprise-detection count is derivable from analyses (dependencies surfaced that specs didn't name) (§41.5). _(computed per sample; ground-truth minimums asserted)_
- [x] A repeatable evaluation run reports all metrics for a given build. _(`pnpm eval:impact`; also gates in the analyzers suite)_

**Tasks**

- [x] Implement evaluation runner: fixtures + ground truth → metric report. _(`workspace-engine/src/evaluation.test.ts`)_
- [x] Persist accept/reject decisions in a metrics-friendly shape (with Epic 06). _(append-only `UserImpactDecision` records exist since Epic 06 — the future precision metric reads them)_
- [x] Add metric regression check to CI (informational, then gating once stable). _(gating from day one via the analyzers suite — the deterministic engine makes the metrics stable)_
