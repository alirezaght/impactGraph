import type { CliIndexOutput } from '@impactgraph/contracts';

/**
 * Bound the index command's warning output.
 *
 * An index run over a mid-sized repository produced 792 warning lines and about 91 KB of JSON,
 * which exceeded the consuming agent's token budget — the tool returned a correct answer nobody
 * could read, which is the same as returning nothing. The counts are what a caller acts on; the
 * lines are a sample it can opt out of.
 */

/** Lines kept in summary mode. Enough to recognise the shape of the problem, not to drown in it. */
export const WARNING_SAMPLE_SIZE = 8;

/** Examples per category. One is usually enough to tell an ignore-glob bug from a parser gap. */
const EXAMPLES_PER_CATEGORY = 1;

/**
 * Group by the message tail rather than the path: a warning list is dominated by the same handful
 * of causes repeated across hundreds of files, and the cause is what a reader can act on.
 */
const categoryOf = (line: string): string => {
  const message = line.slice(line.indexOf(': ') + 2).trim();
  return message.replace(/['"`][^'"`]*['"`]/g, '…').slice(0, 90);
};

export interface SummarisedWarnings {
  readonly warnings: readonly string[];
  readonly warningSummary: NonNullable<CliIndexOutput['warningSummary']>;
}

export const summariseIndexWarnings = (
  lines: readonly string[],
  detail: 'summary' | 'full' = 'summary',
): SummarisedWarnings => {
  const byCategory = new Map<string, { count: number; example: string }>();
  for (const line of lines) {
    const category = categoryOf(line);
    const existing = byCategory.get(category);
    if (existing === undefined) {
      byCategory.set(category, { count: 1, example: line });
    } else {
      existing.count += 1;
    }
  }
  const groups = [...byCategory.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([category, entry]) => ({
      category,
      count: entry.count,
      exampleMessage: entry.example,
    }));
  // In summary mode the sample is drawn one per category, strongest first, so eight lines describe
  // eight distinct problems rather than eight instances of the same one.
  const sample =
    detail === 'full'
      ? [...lines]
      : groups
          .slice(0, WARNING_SAMPLE_SIZE)
          .flatMap((group) => [group.exampleMessage].slice(0, EXAMPLES_PER_CATEGORY));
  return {
    warnings: sample,
    warningSummary: {
      totalCount: lines.length,
      returnedCount: sample.length,
      omittedCount: Math.max(0, lines.length - sample.length),
      byCategory: groups.slice(0, 25).map((group) => ({
        category: group.category,
        count: group.count,
        exampleMessage: group.exampleMessage,
      })),
    },
  };
};
