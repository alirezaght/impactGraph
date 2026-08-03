import { execFile } from 'node:child_process';

export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the process could not be spawned at all (e.g. git not installed). */
  readonly spawnErrorCode?: string;
}

/**
 * Run git with an ARGUMENT ARRAY — never shell interpolation (ADR-0007; branch names and
 * paths are untrusted input). Non-zero exit codes are returned, not thrown.
 */
export const runGit = (directory: string, args: readonly string[]): Promise<GitCommandResult> =>
  new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        const spawnErrorCode = typeof error.code === 'string' ? error.code : undefined;
        resolve({
          exitCode: typeof error.code === 'number' ? error.code : 1,
          stdout,
          stderr,
          ...(spawnErrorCode === undefined ? {} : { spawnErrorCode }),
        });
      },
    );
  });
