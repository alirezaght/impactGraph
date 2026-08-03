import type { ChangedPath, ChangeType } from '@impactgraph/application';

// NUL-separated `--name-status -z` parsing (ADR-0007): hostile filenames (newlines,
// leading dashes) can never break this — entries are exact NUL-delimited tokens.

const STATUS_MAP: Readonly<Record<string, ChangeType>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  T: 'modified', // type change (file ↔ symlink) — treated as a modification
  C: 'added', // copy: the new path appears as an added file
};

/**
 * Parse `git diff --name-status -z` output. Token stream: STATUS \0 path \0 …, where rename
 * and copy statuses (Rxxx/Cxxx) are followed by TWO paths (old \0 new).
 */
export const parseNameStatus = (raw: string): ChangedPath[] => {
  const tokens = raw.split('\0').filter((token) => token.length > 0);
  const changes: ChangedPath[] = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index] ?? '';
    const kind = status.charAt(0);
    if (kind === 'R' || kind === 'C') {
      const previousPath = tokens[index + 1];
      const path = tokens[index + 2];
      if (previousPath !== undefined && path !== undefined) {
        changes.push(
          kind === 'R'
            ? { path, changeType: 'renamed', previousPath }
            : { path, changeType: 'added' },
        );
      }
      index += 3;
      continue;
    }
    const path = tokens[index + 1];
    const changeType = STATUS_MAP[kind];
    if (path !== undefined && changeType !== undefined) {
      changes.push({ path, changeType });
    }
    index += 2;
  }
  return changes;
};

/** Parse `git ls-files --others --exclude-standard -z` — untracked files are additions. */
export const parseUntracked = (raw: string): ChangedPath[] =>
  raw
    .split('\0')
    .filter((path) => path.length > 0)
    .map((path) => ({ path, changeType: 'added' as const }));
