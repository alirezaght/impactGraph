import { join } from 'node:path';

import {
  evidencePanelStateSchema,
  impactGraphSchema,
  nodeExplanationSchema,
  specificationPanelStateSchema,
  WEBVIEW_PROTOCOL_VERSION,
} from '@impactgraph/contracts';
import * as vscode from 'vscode';

import { startEngineJob } from '../engine/engine-client.js';

import { EMPTY_IMPACT_GRAPH, buildImpactGraph } from './graph-model.js';
import { EMPTY_SPECIFICATION_STATE } from './spec-model.js';

import type { ImpactReviewPanel } from './panel.js';
import type { EngineJobSpec } from '../engine/protocol.js';
import type { ImpactTreeProvider } from '../views/impact-tree.js';
import type {
  EvidencePanelStateDto,
  HumanDecisionDto,
  SpecificationPanelStateDto,
} from '@impactgraph/contracts';
import type { ZodType } from 'zod';

// Story 9.1/9.3/9.5 — the host-side session behind the review panel: it runs engine jobs in the
// worker process (never in the host, §32/§33), validates every worker payload against the
// contract (ADR-0009), and pushes state to the webview. It holds NO analysis logic.

export interface SessionWiring {
  readonly context: vscode.ExtensionContext;
  readonly output: vscode.OutputChannel;
  readonly impactTree: ImpactTreeProvider;
}

export class PanelSession {
  private specification: SpecificationPanelStateDto = EMPTY_SPECIFICATION_STATE;
  /** Decisions recorded in this session, keyed `requirementId::nodeId` (§18.5 human decisions). */
  private readonly decisions = new Map<string, HumanDecisionDto[]>();

  public constructor(
    private readonly wiring: SessionWiring,
    public readonly rootDir: string,
    private readonly panel: ImpactReviewPanel,
  ) {}

  public get specificationState(): SpecificationPanelStateDto {
    return this.specification;
  }

  /** Runs one engine job in the bundled worker with a cancellable progress notification. */
  public async run<T>(
    title: string,
    request: EngineJobSpec,
    schema: ZodType<T>,
  ): Promise<T | undefined> {
    this.panel.status(true, title);
    try {
      const outcome = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: true },
        async (_progress, token) => {
          const handle = startEngineJob(
            join(this.wiring.context.extensionPath, 'dist', 'engine-worker.cjs'),
            request,
          );
          token.onCancellationRequested(() => {
            handle.cancel();
          });
          return handle.outcome;
        },
      );
      if (outcome.kind === 'cancelled') {
        return undefined;
      }
      if (outcome.kind === 'failed') {
        this.wiring.output.appendLine(
          `[webview] ${outcome.error.category}: ${outcome.error.message}`,
        );
        this.panel.error(outcome.error.category, outcome.error.message);
        return undefined;
      }
      return this.validate(schema, outcome.value);
    } finally {
      this.panel.status(false);
    }
  }

  private validate<T>(schema: ZodType<T>, value: unknown): T | undefined {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    const detail = parsed.error.issues[0]?.message ?? 'unknown';
    this.wiring.output.appendLine(`[webview] contract violation: ${detail}`);
    this.panel.error('contract-violation', `engine result failed contract validation: ${detail}`);
    return undefined;
  }

  public pushSpecification(state: SpecificationPanelStateDto): void {
    this.specification = state;
    void this.panel.post({
      protocolVersion: WEBVIEW_PROTOCOL_VERSION,
      type: 'host/specification',
      payload: { state },
    });
  }

  /** Re-projects the current analyze document (never a recomputation) onto the §18.4 graph. */
  public pushGraph(): void {
    const document = this.wiring.impactTree.current;
    const graph = document === undefined ? EMPTY_IMPACT_GRAPH : buildImpactGraph(document);
    const validated = this.validate(impactGraphSchema, graph);
    if (validated === undefined) {
      return;
    }
    void this.panel.post({
      protocolVersion: WEBVIEW_PROTOCOL_VERSION,
      type: 'host/graph',
      payload: { graph: validated },
    });
  }

  public pushEvidence(state: EvidencePanelStateDto): void {
    const validated = this.validate(evidencePanelStateSchema, state);
    if (validated === undefined) {
      return;
    }
    void this.panel.post({
      protocolVersion: WEBVIEW_PROTOCOL_VERSION,
      type: 'host/evidence',
      payload: { state: validated },
    });
  }

  public get analysisDocument(): ImpactTreeProvider['current'] {
    return this.wiring.impactTree.current;
  }

  public recordDecision(key: string, decision: HumanDecisionDto): void {
    this.decisions.set(key, [...(this.decisions.get(key) ?? []), decision]);
  }

  public decisionsFor(key: string): readonly HumanDecisionDto[] {
    return this.decisions.get(key) ?? [];
  }

  public readonly schemas = {
    specification: specificationPanelStateSchema,
    explanation: nodeExplanationSchema,
  };
}
