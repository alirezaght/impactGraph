import { z } from 'zod';

// Structural reference queries (PRD §21). Born from a real session where "who else implements
// ListingRepository?", "who calls remove_item?" and "where else is `= ANY(:ids)` used?" were all
// answered with grep because no tool exposed the index's own edges and cached call facts.
//
// Two honesty rules are part of the CONTRACT, not just the implementation:
//   * name-matched call sites are labeled per record (`basis: 'name-match'`) — a deterministic
//     fact that a call with this name occurs there; the receiver's type is NOT resolved;
//   * every result carries a coverage/scope statement saying exactly what was searched and what
//     the known limits are, because there is no full-text content index to fall back on.

export const REFERENCE_KINDS = [
  'callers',
  'callees',
  'implementations',
  'extensions',
  'importers',
  'imports',
  'injections',
] as const;

const referenceKindSchema = z.enum(REFERENCE_KINDS);

/** The node a relation points at (or the resolved query target itself). */
const referencedNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    path: z.string().min(1).optional(),
  })
  .strict();

const referenceCounterpartSchema = referencedNodeSchema
  .extend({
    /** Provenance of the EDGE that established the relation (§3) — deterministic here. */
    provenance: z.string().min(1),
  })
  .strict();

const referenceGroupSchema = z
  .object({
    kind: referenceKindSchema,
    /** The graph edge type this group maps to (CALLS, IMPLEMENTS, EXTENDS, IMPORTS, INJECTS). */
    edgeType: z.string().min(1),
    /** Direction relative to the resolved node: callers/implementations/... are incoming. */
    direction: z.enum(['incoming', 'outgoing']),
    counterparts: z.array(referenceCounterpartSchema),
    /** Count before the limit was applied — a truncated list never poses as the whole answer. */
    totalCount: z.number().int().min(0),
  })
  .strict();

const nameMatchedCallSiteSchema = z
  .object({
    /** Per-record honesty label: the callee NAME matches; the receiver type is not resolved. */
    basis: z.literal('name-match'),
    filePath: z.string().min(1),
    calleeName: z.string().min(1),
    /** Receiver identifier for member calls (`store.loadGraph(...)` → 'store'), when recorded. */
    receiver: z.string().min(1).optional(),
    /** 1-based line of the call, when the cached evidence carries a range. */
    line: z.number().int().min(1).optional(),
    /** First string-literal argument, truncated — the join key most call facts are recorded for. */
    sampleArgument: z.string().min(1).optional(),
    sampleArgumentTruncated: z.boolean().optional(),
  })
  .strict();

/** What was searched, at which snapshot, and the known limits — required on EVERY result. */
const referenceCoverageSchema = z
  .object({
    snapshotId: z.string().min(1),
    /** Exactly what was searched, e.g. structural edges + cached call/decorator facts. */
    searched: z.array(z.string().min(1)).min(1),
    knownLimits: z.array(z.string().min(1)).min(1),
    filesSearched: z.number().int().min(0),
    /** Indexed files whose fragment facts were absent or unreadable — not searched. */
    filesWithoutCachedFacts: z.number().int().min(0),
  })
  .strict();

export const REFERENCE_TOOL_CONTRACTS = {
  find_references: {
    description:
      'Answer "who calls / implements / extends / imports / injects this symbol?" from the deterministic index. Resolves a symbol name or nodeId to a graph node (several exact matches return disambiguation candidates instead of a guess), returns its structural relations grouped by kind, AND name-matched call sites from the cached per-file call facts (member calls like `store.remove_item(...)` matched by callee name only — the receiver type is not resolved). Every result carries a coverage statement with the known limits. Complements explain_node (one node, all edges) with filtered, name-addressable reverse lookup.',
    input: z
      .object({
        /** A symbol/component name or an exact nodeId. */
        query: z.string().min(1),
        /** Restrict to these relation kinds; all kinds when omitted. */
        kinds: z.array(referenceKindSchema).min(1).optional(),
        /** Per-group and call-site cap (default 50). */
        limit: z.number().int().min(1).max(500).optional(),
      })
      .strict(),
    output: z
      .object({
        query: z.string().min(1),
        /** 'ambiguous' = several exact matches → see candidates; never a silent guess. */
        resolution: z.enum(['resolved', 'ambiguous', 'not-found']),
        resolved: referencedNodeSchema.optional(),
        /** Present when resolution is 'ambiguous' — re-query with one candidate's nodeId. */
        candidates: z.array(referencedNodeSchema).optional(),
        references: z.array(referenceGroupSchema),
        /** Deterministic name matches from cached call facts — labeled, never type-resolved. */
        nameMatchedCallSites: z.array(nameMatchedCallSiteSchema),
        nameMatchedCallSiteTotal: z.number().int().min(0),
        coverage: referenceCoverageSchema,
      })
      .strict(),
  },
  search_literals: {
    description:
      'Search string literals passed as call or decorator arguments in the indexed fragment facts (e.g. SQL fragments like "= ANY(:ids)" passed to query APIs, topic names, translation keys, @Query annotation strings). Substring match by default; regex: true compiles the pattern. This is NOT a full-text search of file contents — only literals recorded as call/decorator arguments at the indexed revision are searched, and the result says so explicitly.',
    input: z
      .object({
        pattern: z.string().min(1),
        /** Treat pattern as a JavaScript regular expression; invalid patterns are a typed error. */
        regex: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .strict(),
    output: z
      .object({
        matches: z.array(
          z
            .object({
              filePath: z.string().min(1),
              /** Where the literal was observed: a call argument or a decorator argument. */
              ownerKind: z.enum(['call', 'decorator']),
              /** The callee name (calls) or decorator name (decorators) owning the literal. */
              ownerName: z.string().min(1),
              receiver: z.string().min(1).optional(),
              /** The matched literal, truncated to ~200 chars when longer. */
              literal: z.string().min(1),
              truncated: z.boolean(),
              line: z.number().int().min(1).optional(),
            })
            .strict(),
        ),
        /** Matches found before the limit — truncation is visible, never silent. */
        totalCount: z.number().int().min(0),
        matchMode: z.enum(['substring', 'regex']),
        snapshotId: z.string().min(1),
        /** The explicit scope statement: what was searched and what was NOT. */
        scope: z.string().min(1),
        filesSearched: z.number().int().min(0),
        filesWithoutCachedFacts: z.number().int().min(0),
      })
      .strict(),
  },
} as const;
