// Cancellation + progress ports (PRD §32): every long-running use case takes a token,
// responds within ~500 ms, reports structured progress, and persists partial progress safely.

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
}

export const NEVER_CANCELLED: CancellationToken = Object.freeze({
  isCancellationRequested: false,
});

export interface OperationCancelled {
  readonly name: 'OperationCancelled';
  readonly message: string;
}

export const operationCancelled = (message: string): OperationCancelled =>
  Object.freeze({ name: 'OperationCancelled' as const, message });

export type IndexPhase = 'scanning' | 'parsing' | 'assembling' | 'persisting';

export interface IndexProgress {
  readonly phase: IndexPhase;
  readonly filesProcessed: number;
  readonly totalFiles: number;
}

export type ProgressReporter = (progress: IndexProgress) => void;
