import type { ExitCodeName } from '@impactgraph/contracts';

/** A typed workflow failure using the §20 outcome taxonomy; shells map it to exit codes/errors. */
export interface EngineFailure {
  readonly category: Exclude<ExitCodeName, 'success'>;
  readonly message: string;
}

export const engineFailure = (
  category: EngineFailure['category'],
  message: string,
): EngineFailure => ({ category, message });

export type Failable<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: EngineFailure };

export const failWith = <T>(category: EngineFailure['category'], message: string): Failable<T> => ({
  ok: false,
  error: engineFailure(category, message),
});
