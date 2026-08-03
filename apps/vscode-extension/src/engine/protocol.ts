import type { EngineFailure } from '@impactgraph/workspace-engine';

// Extension-host ↔ engine-worker protocol (one job per child process). Payloads are the
// schema-versioned CLI/tool documents — already validated JSON, safe across IPC.

export type EngineJobSpec =
  | {
      readonly op: 'analyze';
      readonly rootDir: string;
      readonly specName: string;
      readonly rawText: string;
      /** From SecretStorage; crosses only this IPC channel, never persisted or logged (§35). */
      readonly apiKey?: string | undefined;
    }
  | {
      readonly op: 'review';
      readonly rootDir: string;
      readonly target: 'working-tree' | 'commit';
    }
  | {
      readonly op: 'export';
      readonly rootDir: string;
      readonly analysisId?: string | undefined;
    }
  /** Story 9.1 — persist a specification version and return the §18.2 panel state. */
  | {
      readonly op: 'spec-submit';
      readonly rootDir: string;
      readonly specName: string;
      readonly rawText: string;
      readonly apiKey?: string | undefined;
    }
  | {
      readonly op: 'spec-load';
      readonly rootDir: string;
      readonly specificationId: string;
      readonly version?: number | undefined;
    }
  /** Story 9.1 — confirm/reject/edit a requirement, answer/dismiss an open question (§40.2). */
  | {
      readonly op: 'spec-mutate';
      readonly rootDir: string;
      readonly specificationId: string;
      readonly action: 'confirm' | 'reject' | 'edit' | 'dismiss' | 'answer';
      readonly requirementId?: string | undefined;
      readonly questionId?: string | undefined;
      readonly statement?: string | undefined;
      readonly answer?: string | undefined;
    }
  /** Story 9.3 — §18.5 evidence for one graph node (confidence signals, evidence, edges). */
  | {
      readonly op: 'explain-node';
      readonly rootDir: string;
      readonly nodeId: string;
    };

export type EngineJobRequest = EngineJobSpec & { readonly id: number };

export type EngineJobResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: EngineFailure };
