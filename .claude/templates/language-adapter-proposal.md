# Language/Framework Adapter Proposal: <language or framework>

_For new adapters in packages/language-adapters or packages/framework-adapters (PRD §30–31).
Reviewed by the language-adapter agent with the language-adapter-development skill. Parser strategy
is governed by ADR-0008 (Proposed — deviations feed its revisit trigger)._

- **PRD grounding:** §6.1/§6.2 (scope), §30 or §31 (interface), §C<n> if multi-stack addendum applies
- **Epic:** backlog/epic-<NN>-<name>.md (e.g. epic-16-multi-stack.md)
- **Author / date:** <name> / <YYYY-MM-DD>

## Language / framework

<name + versions targeted, e.g. "Python 3.11+ / FastAPI 0.x">

## Detection signals (deterministic, PRD §15.2)

- <e.g. "pyproject.toml with [tool.poetry] or requirements.txt present">
- <e.g. "fastapi in dependencies + FastAPI() instantiation"> — each signal maps to provenance
  `configuration` or `static-analysis`

## Interface methods implemented

- LanguageAdapter (PRD §30): `detectProject` <yes/no>, `indexFiles` <yes/no>, `analyzeDiff` <yes/no/deferred to milestone <n>>
- FrameworkAdapter (PRD §31): `detect` <...>, `enrich` <...>
- supportedExtensions: <[".py", ...]>

## Parser choice (ADR-0008)

- Choice: TypeScript compiler API | tree-sitter (WASM) grammar <name> | text/filesystem fallback
- Why: <...>
- If this deviates from ADR-0008: <file follow-up ADR / update revisit trigger>

## Node and edge types emitted (PRD §12.1–12.2)

- Nodes: <e.g. Module, Class, Function, API endpoint, Pub/Sub topic>
- Edges: <e.g. IMPORTS, CALLS, EXPOSES, PUBLISHES, SUBSCRIBES_TO, DEPLOYED_AS>
- Every node/edge carries provenance + evidence (file, range) — never `llm-inferred` from an adapter

## Framework conventions recognized

_Deterministic conventions turned into graph facts with provenance `framework-convention`._

- <e.g. "APIRouter route decorators → API endpoint nodes + EXPOSES edges">
- <...>

## Fallback behavior for unparseable files (PRD §34)

- Parse error: <record parser warning with file + reason; emit File node with filesystem-level
  evidence only; continue>
- Partial parse: <emit what parsed; mark fragment degraded>
- Never: abort the indexing run, execute repository code, or guess symbols

## Fixture repository plan (packages/test-kit)

- Fixture <name>: minimal idiomatic project exercising every convention above
- Degenerate fixture: syntax errors, oversized file, symlink loop, prompt-injection text in
  comments (PRD §42.5)
- Real-world-shape fixture (optional, later milestone): <...>

## Golden tests (vitest `analyzers` project, PRD §42.3)

- Golden per fixture: full node/edge/evidence listing
- Diff-analysis golden (when `analyzeDiff` lands): predicted GraphChangeSet for a scripted edit

## Known limitations

- <e.g. "dynamic imports resolved only when literal strings">
- <...> — each limitation surfaces to the user as "unsupported/partial", never silently (PRD §34)

## Unsupported-degradation statement

_One paragraph: what a user with this language sees when the adapter cannot handle their code —
which features still work (filesystem/text-level evidence), which report as unsupported._

_TBD_
