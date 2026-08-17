import { createPreflightFinding } from '@impactgraph/domain';

import type { GraphNode, KnowledgeGraph, PreflightFinding } from '@impactgraph/domain';

/**
 * Compare a plan's SQL against the column types the repository states (ADR-0020 §4).
 *
 * The motivating near-miss: a plan proposed `listing.id = ANY(:ids)` with string-bound ids
 * against a column declared `Column(UUID, primary_key=True)`. The declaration was in the
 * repository, analogous correctly-handled SQL was in the repository, and nothing put the three
 * facts side by side. This analyzer does exactly that — and only that: when a compared column
 * resolves to an indexed member whose declared type is type-sensitive, it emits a WARNING
 * quoting the declaration. "Your parameters might be strings" is a risk worth a look, never a
 * proven violation (the ADR-0018 asymmetry), so this finding can never block.
 */

/** A correctly-handled literal elsewhere in the repository, supplied by the caller (ADR-0020 §1). */
export interface AnalogousLiteralMatch {
  /** The comparison operator the literal contains, in this module's vocabulary: `= ANY(` etc. */
  readonly pattern: string;
  readonly filePath: string;
  readonly line?: number;
}

export interface TypeComparisonCheckInput {
  readonly specificationText: string;
  readonly graph: KnowledgeGraph;
  readonly requirementIds: readonly string[];
  readonly analogousLiterals?: readonly AnalogousLiteralMatch[];
  readonly nextId: (seed: string) => string;
}

/** `table.column` or bare `column` — the left-hand side of a comparison. */
const IDENTIFIER = String.raw`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)`;

/** The comparison shapes read, each with the operator vocabulary the caller can search for. */
const OPERATORS: readonly { readonly pattern: string; readonly source: string }[] = [
  { pattern: '= ANY(', source: String.raw`${IDENTIFIER}\s*=\s*ANY\s*\(` },
  { pattern: 'IN (:', source: String.raw`${IDENTIFIER}\s+IN\s*\(\s*:` },
  { pattern: '= :', source: String.raw`${IDENTIFIER}\s*=\s*:` },
];

/** Only SQL-shaped text is read — a comparison in plain prose is a mention, not a query. */
const SQL_LINE = /\b(select|update|delete|insert|where|join)\b/i;
const FENCED_BLOCK = /```[^\n]*\n([\s\S]*?)```/g;

/** Mirrors check-assumptions: a sentence that CREATES the column asserts nothing about it. */
const CREATION_CONTEXT =
  /\b(add|adds|adding|new|create|creates|creating|introduce|introduces|extend|extends)\b/i;
const ASSERTION_CONTEXT =
  /\b(uses?|using|references?|reads?|checks?|matches?|equals?|is set to|returns?|when|if|existing|already)\b/i;

interface ComparisonSite {
  /** The identifier exactly as the specification wrote it. */
  readonly written: string;
  readonly operator: string;
}

/** Lines worth reading as SQL: every line of a SQL-bearing fenced block, plus SQL-shaped prose lines. */
const candidateLines = (text: string): readonly string[] => {
  const lines: string[] = [];
  const prose = text.replace(FENCED_BLOCK, (block: string, content: string) => {
    if (SQL_LINE.test(content)) {
      lines.push(...content.split('\n'));
    }
    return '';
  });
  lines.push(...prose.split('\n').filter((line) => SQL_LINE.test(line)));
  return lines;
};

const comparisonSites = (text: string): readonly ComparisonSite[] => {
  const sites: ComparisonSite[] = [];
  for (const line of candidateLines(text)) {
    if (CREATION_CONTEXT.test(line) && !ASSERTION_CONTEXT.test(line)) {
      continue; // the line describes a NEW column — a planning fact, not an assertion
    }
    for (const operator of OPERATORS) {
      for (const match of line.matchAll(new RegExp(operator.source, 'gi'))) {
        sites.push({ written: match[1] ?? '', operator: operator.pattern });
      }
    }
  }
  return sites;
};

/** The distinct operators a specification's SQL used — what the caller searches literals for. */
export const sqlComparisonPatterns = (specificationText: string): readonly string[] => {
  const used = new Set(comparisonSites(specificationText).map((site) => site.operator));
  return OPERATORS.map((operator) => operator.pattern).filter((pattern) => used.has(pattern));
};

/** Node types that may carry a member's declared type (Java fields stay `symbol` this round). */
const MEMBER_NODE_TYPES = new Set(['field', 'column', 'symbol']);

interface MemberCandidate {
  readonly node: GraphNode;
  readonly owner: string;
  readonly member: string;
}

const memberCandidates = (graph: KnowledgeGraph): readonly MemberCandidate[] => {
  const candidates: MemberCandidate[] = [];
  for (const node of graph.nodes.values()) {
    if (node.declaredType === undefined || !MEMBER_NODE_TYPES.has(node.type)) {
      continue;
    }
    // TS smuggles nullability into the name as a trailing `?`; strip it for matching only.
    const name = node.name.endsWith('?') ? node.name.slice(0, -1) : node.name;
    const dot = name.lastIndexOf('.');
    if (dot > 0 && dot < name.length - 1) {
      candidates.push({ node, owner: name.slice(0, dot), member: name.slice(dot + 1) });
    }
  }
  return candidates.sort((a, b) => String(a.node.id).localeCompare(String(b.node.id)));
};

/** `listing`/`Listing`/`listings` all name the same owner — case- and one-trailing-s-insensitive. */
const ownerMatches = (table: string, owner: string): boolean => {
  const strip = (value: string): string => {
    const lower = value.toLowerCase();
    return lower.endsWith('s') ? lower.slice(0, -1) : lower;
  };
  return table.toLowerCase() === owner.toLowerCase() || strip(table) === strip(owner);
};

const resolve = (
  candidates: readonly MemberCandidate[],
  written: string,
): MemberCandidate | undefined => {
  const dot = written.lastIndexOf('.');
  if (dot > 0) {
    const table = written.slice(0, dot);
    const column = written.slice(dot + 1).toLowerCase();
    return candidates.find(
      (candidate) =>
        candidate.member.toLowerCase() === column && ownerMatches(table, candidate.owner),
    );
  }
  // A bare column resolves only when exactly ONE indexed field carries the name — anything else
  // would be a guess about which table the plan means.
  const named = candidates.filter(
    (candidate) => candidate.member.toLowerCase() === written.toLowerCase(),
  );
  return named.length === 1 ? named[0] : undefined;
};

/** ADR-0020 §4's type-sensitive families, matched on whole word tokens of the declared type. */
const FAMILIES: readonly { readonly family: string; readonly tokens: readonly string[] }[] = [
  { family: 'uuid', tokens: ['uuid'] },
  { family: 'date/time', tokens: ['date', 'datetime', 'timestamp'] },
  { family: 'numeric', tokens: ['int', 'integer', 'bigint', 'numeric', 'decimal', 'float'] },
  { family: 'boolean', tokens: ['bool', 'boolean'] },
];

const familyOf = (declaredType: string): string | undefined => {
  const tokens = new Set(declaredType.toLowerCase().match(/[a-z]+/g) ?? []);
  return FAMILIES.find((entry) => entry.tokens.some((token) => tokens.has(token)))?.family;
};

const analogousClause = (input: TypeComparisonCheckInput, operator: string): string => {
  const matches = (input.analogousLiterals ?? []).filter((entry) => entry.pattern === operator);
  if (matches.length === 0) {
    return '';
  }
  const locations = matches
    .slice(0, 3)
    .map((entry) =>
      entry.line === undefined ? entry.filePath : `${entry.filePath}:${String(entry.line)}`,
    )
    .join(', ');
  return ` Similar SQL is handled at ${locations} — compare the binding.`;
};

const comparisonFinding = (
  input: TypeComparisonCheckInput,
  site: ComparisonSite,
  candidate: MemberCandidate,
  family: string,
): PreflightFinding | undefined => {
  const { node } = candidate;
  const declaredType = node.declaredType ?? '';
  const where = node.path ?? 'the indexed declaration';
  const result = createPreflightFinding({
    id: input.nextId(`type-comparison:${site.written}:${String(node.id)}`),
    kind: 'type-sensitive-comparison',
    severity: 'warning',
    verification: 'unverified-assumption',
    requirementIds: [...input.requirementIds],
    statement: `The plan's SQL compares ${site.written} against bound parameters (${site.operator.trim()}…), but ${node.name} is declared '${declaredType}' at ${where} — a ${family}-sensitive type that string-bound parameters may not match.`,
    recommendation:
      `Verify the parameters bound for ${site.written} are typed to match '${declaredType}' — bind or cast ${family} values, not strings.` +
      analogousClause(input, site.operator),
    subject: {
      assumedSymbol: site.written,
      nodeIds: [String(node.id)],
      ...(node.path === undefined ? {} : { filePaths: [node.path] }),
    },
    evidenceIds: [...node.knowledge.evidenceIds],
    confidence: 0.7,
    provenance: 'static-analysis',
    analyzer: 'check-type-comparisons',
  });
  return result.ok ? result.value : undefined;
};

export const checkTypeComparisons = (
  input: TypeComparisonCheckInput,
): readonly PreflightFinding[] => {
  const sites = comparisonSites(input.specificationText);
  if (sites.length === 0) {
    return [];
  }
  const candidates = memberCandidates(input.graph);
  const findings: PreflightFinding[] = [];
  const seen = new Set<string>();
  for (const site of sites) {
    const candidate = resolve(candidates, site.written);
    if (candidate === undefined || seen.has(String(candidate.node.id))) {
      continue; // unresolved column, un-extracted type, or already reported — silence
    }
    const family = familyOf(candidate.node.declaredType ?? '');
    if (family === undefined) {
      continue; // string-ish declared type — nothing type-sensitive to warn about
    }
    seen.add(String(candidate.node.id));
    const finding = comparisonFinding(input, site, candidate, family);
    if (finding !== undefined) {
      findings.push(finding);
    }
  }
  return findings;
};
