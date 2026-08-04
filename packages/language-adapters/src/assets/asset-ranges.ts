// Source lines for asset facts. Evidence that cannot point at a line is materially worse than none:
// the evidence panel opens a file at a range, and review compares facts at symbol level.
//
// This locates the line of a key by searching the raw text for its last dotted segment as a quoted
// JSON property. That is a deterministic textual lookup, not a parse — but it is honest about what
// it is: when the segment appears more than once the FIRST occurrence wins, and when it appears
// nowhere the line is 1 (the document itself). Both are stated rather than guessed at, and neither
// invents a position.

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The line a JSON property appears on, 1-based. `key` may be dotted — only the final segment is a
 * property name in the file, the earlier ones are the objects that contain it.
 */
export const lineOfKey = (content: string, key: string): number => {
  const segments = key.split('.');
  const property = segments[segments.length - 1] ?? key;
  const pattern = new RegExp(`"${escapeRegExp(property)}"\\s*:`);
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index] ?? '')) {
      return index + 1;
    }
  }
  // A path like `/api/deals` is a property name too, but it may be written with escapes; fall back
  // to a bare occurrence before giving up on the document line.
  const bare = content.indexOf(property);
  if (bare === -1) {
    return 1;
  }
  return content.slice(0, bare).split('\n').length;
};
