/**
 * The human-readable half of an MCP tool result (ADR-0022).
 *
 * Every tool result previously carried the whole payload TWICE: once pretty-printed into
 * `content[0].text` and once as `structuredContent`. For a large review that doubled a document
 * nobody reads as prose, and the answer — "zero violations" — was reachable only by mining JSON.
 *
 * `structuredContent` remains the complete, validated payload. This renders the decision only,
 * from fields the payload already carries; it invents nothing and never becomes the record.
 */

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const countLine = (counts: Record<string, unknown> | undefined): string | undefined => {
  if (counts === undefined) {
    return undefined;
  }
  const parts = Object.entries(counts)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `${key} ${String(value)}`);
  return parts.length === 0 ? undefined : parts.join(' · ');
};

/** The bounded "why" lines under a failing verdict. */
const decidingLines = (deciding: unknown): string[] => {
  if (!Array.isArray(deciding)) {
    return [];
  }
  return deciding
    .slice(0, 3)
    .map((entry) => {
      const record = asRecord(entry);
      const explanation = asString(record?.['explanation']);
      return explanation === undefined
        ? undefined
        : `- [${asString(record?.['category']) ?? 'finding'}] ${explanation}`;
    })
    .filter((line): line is string => line !== undefined);
};

/** The review verdict block, when this payload is a review report. */
const reviewLines = (payload: Record<string, unknown>): string[] | undefined => {
  const verdict = asRecord(payload['verdict']);
  const headline = asString(verdict?.['headline']);
  if (verdict === undefined || headline === undefined) {
    return undefined;
  }
  const lines = [headline];
  const counts = countLine(asRecord(verdict['counts']));
  if (counts !== undefined) {
    lines.push(counts);
  }
  lines.push(...decidingLines(verdict['decidingFindings']));
  return lines;
};

/** The plan assessment block, when this payload is an impact analysis summary. */
const analysisLines = (payload: Record<string, unknown>): string[] | undefined => {
  const assessment = asRecord(payload['planAssessment']);
  if (assessment === undefined) {
    return undefined;
  }
  const feasibility = asString(assessment['feasibility']) ?? 'ASSESSED';
  const lines = [`Plan assessment: ${feasibility}`];
  const headline = asString(payload['headline']) ?? asString(assessment['decision']);
  if (headline !== undefined) {
    lines.push(headline);
  }
  const counts = countLine(asRecord(assessment['counts']));
  if (counts !== undefined) {
    lines.push(counts);
  }
  return lines;
};

/**
 * A short decision-first rendering for payloads that carry a verdict, and compact JSON otherwise.
 * Compact rather than pretty-printed: this text is a machine-to-machine channel, and the
 * indentation was pure token cost.
 */
export const toolResultText = (payload: unknown): string => {
  const record = asRecord(payload);
  const lines = record === undefined ? undefined : (reviewLines(record) ?? analysisLines(record));
  if (lines === undefined) {
    return JSON.stringify(payload);
  }
  return [...lines, '', 'Full detail is in structuredContent.'].join('\n');
};
