// Deterministic git-history helpers (§14 historical-co-change signal, §C7 citations).
// Input is plain files-per-commit data from the GitPort — no git access here.

export interface CoChangeIndex {
  /** Number of recent commits touching BOTH paths. */
  pairCount(a: string, b: string): number;
  /** Number of recent commits touching the path at all. */
  pathCount(path: string): number;
  readonly totalCommits: number;
}

export const buildCoChangeIndex = (commits: readonly (readonly string[])[]): CoChangeIndex => {
  const commitsByPath = new Map<string, Set<number>>();
  commits.forEach((files, index) => {
    for (const file of files) {
      const set = commitsByPath.get(file) ?? new Set<number>();
      set.add(index);
      commitsByPath.set(file, set);
    }
  });
  return {
    totalCommits: commits.length,
    pathCount: (path) => commitsByPath.get(path)?.size ?? 0,
    pairCount: (a, b) => {
      const setA = commitsByPath.get(a);
      const setB = commitsByPath.get(b);
      if (setA === undefined || setB === undefined) {
        return 0;
      }
      let count = 0;
      for (const index of setA) {
        if (setB.has(index)) {
          count += 1;
        }
      }
      return count;
    },
  };
};
