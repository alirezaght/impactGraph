# ADR-0020 — Reference queries, literal search, and typed member facts

Date: 2026-08-14
Status: Accepted
Relates to: ADR-0006 (hybrid persistence), ADR-0008 (parser strategy), ADR-0015 (bounded output),
ADR-0017 (constraint and runtime layers).

## Context

A field evaluation showed a developer answering three questions with grep while an ImpactGraph
index of the same repository sat next to them: who implements this repository interface, who
calls this function, and where else does this raw-SQL pattern occur. The same evaluation's most
expensive near-miss was structural: a plan proposed SQL comparing a UUID-typed column against
string-bound parameters, and every fact needed to question it — the column's declared type, the
proposed SQL, the correctly-handled analogous SQL elsewhere — was either already extracted and
discarded, or one optional field away from being extractable.

Three specific storage decisions caused this:

1. The graph keeps resolved structural edges only. Member calls (`store.remove_item(...)`)
   cannot be resolved without a type checker, so adapters record them as `CallFact`s — which are
   persisted per-file in the fragment cache and then dropped from every queryable surface.
2. String literals passed to calls and decorators (including SQL) are captured and persisted the
   same way, and equally unreachable.
3. `GraphNode` has no type field. Adapters that already parse a declared type (TypeScript field
   flow, Java field declarations) throw it away; the Python adapter did not model fields at all.

## Decision

**1. The fragment cache is a queryable fact store, not only a parse cache.** Two MCP tools expose
it: `find_references` (structural edges around a symbol, PLUS name-matched call sites from call
facts, each explicitly labelled as a name match, never presented as a resolved edge) and
`search_literals` (substring/regex over persisted call/decorator string arguments, with a scope
statement saying exactly what corpus was searched — literals, not file contents). Both answers
carry their coverage limits, because a reference listing that silently omits member calls
reproduces the original failure.

**2. No full-text index.** "Where else does this string occur in any file" remains grep's job;
the tools answer the narrower question the index can answer honestly. Revisit only if literal
search misses real usage repeatedly in the field.

**3. Members gain a declared type.** `GraphNode.declaredType` (optional, additive) records the
type text the adapter already parsed — `Mapped[uuid.UUID]`, `UUID`, `string | null` — never an
inferred one. Producers: TypeScript field flow, Java field declarations, Python class-attribute
annotations (new field nodes for annotated class attributes, the SQLAlchemy/Pydantic shape).
It is a fact with a source location, not a type system: no normalization beyond trimming, no
cross-language equivalence claims.

**4. Preflight may compare a plan's SQL against typed members.** A deterministic reader extracts
column comparisons from specification text (fenced SQL and SQL-shaped lines only); when a
compared column resolves to an indexed member whose declared type is in a type-sensitive family
(uuid/date/numeric/boolean), preflight emits a WARNING finding quoting the declaration and any
analogous literals found elsewhere — never a blocking verdict, because "your parameters might be
strings" is a risk worth a look, not a proven violation (the same asymmetry ADR-0018 codifies).

## Alternatives considered

**Resolve member calls into CALLS edges with heuristics.** Rejected: a name-only resolution
presented as a structural edge is a guess wearing a fact's clothes (ADR-0002). The tools label
name matches as name matches instead.

**A full-text SQLite FTS index of file contents.** Rejected for now: it duplicates ripgrep,
grows the index materially, and the questions from the field were all answerable from facts
already persisted.

**A real type model (normalized types, cross-language mapping).** Rejected: ImpactGraph is not a
type checker. Declared-type text with provenance is enough to put two facts side by side, which
is the product's job.

## Consequences

- `find_references` / `search_literals` are new tool contracts (schema-versioned, Zod-validated).
- `declaredType` is additive on nodes; the index is a disposable cache, so a re-index populates
  it — no migration.
- Python fixtures gain field nodes; graph goldens move additively.
- The UUID/SQL class of miss becomes detectable exactly when the repository states the column
  type somewhere an adapter reads.

## Revisit triggers

- Literal search reported as missing real SQL in the field → revisit the no-FTS decision.
- The type-sensitive family list growing per-repository idioms → move it into declared
  configuration rather than code.
