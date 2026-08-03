import {
  hostMessageSchema,
  parseWebviewMessage,
  WEBVIEW_PROTOCOL_VERSION,
} from '@impactgraph/contracts';
import * as vscode from 'vscode';

import { buildWebviewHtml, createNonce } from './html.js';

import type { HostMessage, MessageParseError, WebviewMessage } from '@impactgraph/contracts';

// Story 9.1/9.5/9.3 — webview HOSTING only (main skill §9): lifecycle, CSP, and validated
// message plumbing. Every inbound message is Zod-validated against packages/contracts before it
// reaches a handler; an unknown protocol version is refused, never best-effort parsed.
//
// `receive` and `post` return what the host decided instead of swallowing it. That is not a test
// affordance bolted on: it is the only way the decision is observable at all (the OutputChannel
// cannot be read back through any VS Code API), and the integration lane asserts on it.

export type WebviewRequestHandler = (message: WebviewMessage) => Promise<void>;

/** Whether the live webview actually took the message — `postMessage` answers truthfully. */
export type PostOutcome = 'delivered' | 'not-delivered' | 'refused';

const VIEW_TYPE = 'impactgraph.reviewPanel';
const TITLE = 'ImpactGraph: Impact Review';

export class ImpactReviewPanel {
  private static instance: ImpactReviewPanel | undefined;

  private readonly accepted: WebviewMessage['type'][] = [];
  private readonly delivered: HostMessage['type'][] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly output: vscode.OutputChannel,
    private readonly handle: WebviewRequestHandler,
  ) {}

  public static current(): ImpactReviewPanel | undefined {
    return ImpactReviewPanel.instance;
  }

  /** Create or reveal the single review panel. */
  public static show(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    handle: WebviewRequestHandler,
  ): ImpactReviewPanel {
    const existing = ImpactReviewPanel.instance;
    if (existing !== undefined) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return existing;
    }
    const bundleRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      {
        enableScripts: true,
        enableCommandUris: false,
        // Nothing outside the built webview bundle may be loaded (PRD §35).
        localResourceRoots: [bundleRoot],
        retainContextWhenHidden: true,
      },
    );
    const created = new ImpactReviewPanel(panel, output, handle);
    created.render(bundleRoot);
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      created.receive(raw);
    });
    ImpactReviewPanel.instance = created;
    panel.onDidDispose(() => {
      ImpactReviewPanel.instance = undefined;
    });
    return created;
  }

  private render(bundleRoot: vscode.Uri): void {
    const nonce = createNonce();
    const asUri = (file: string): string =>
      this.panel.webview.asWebviewUri(vscode.Uri.joinPath(bundleRoot, file)).toString();
    this.panel.webview.html = buildWebviewHtml({
      nonce,
      cspSource: this.panel.webview.cspSource,
      scriptUri: asUri('webview.js'),
      styleUri: asUri('webview.css'),
      title: TITLE,
    });
  }

  /**
   * The host side of one inbound message: validate, then dispatch. Returns the parse error the
   * host acted on (`undefined` = accepted), so a refusal is a reported outcome rather than a
   * line nobody can read.
   */
  public receive(raw: unknown): MessageParseError | undefined {
    const parsed = parseWebviewMessage(raw);
    if (!parsed.ok) {
      this.output.appendLine(`[webview] rejected message: ${parsed.error.code}`);
      this.error(parsed.error.code, parsed.error.message);
      return parsed.error;
    }
    this.accepted.push(parsed.value.type);
    void this.handle(parsed.value);
    return undefined;
  }

  /** Webview → host message types this panel accepted, in arrival order. */
  public get acceptedTypes(): readonly string[] {
    return this.accepted;
  }

  /** Host → webview message types the live webview actually took, in send order. */
  public get deliveredTypes(): readonly string[] {
    return this.delivered;
  }

  /** Host → webview, validated before it leaves the host (both ends validate — main skill §5). */
  public async post(message: HostMessage): Promise<PostOutcome> {
    const parsed = hostMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.output.appendLine(
        `[webview] refused to post an invalid ${message.type}: ${parsed.error.issues[0]?.message ?? '?'}`,
      );
      return 'refused';
    }
    if (!(await this.panel.webview.postMessage(parsed.data))) {
      return 'not-delivered';
    }
    this.delivered.push(parsed.data.type);
    return 'delivered';
  }

  public status(busy: boolean, label?: string): void {
    void this.post({
      protocolVersion: WEBVIEW_PROTOCOL_VERSION,
      type: 'host/status',
      payload: { busy, ...(label === undefined ? {} : { label }) },
    });
  }

  public error(code: string, message: string): void {
    void this.post({
      protocolVersion: WEBVIEW_PROTOCOL_VERSION,
      type: 'host/error',
      payload: { code, message },
    });
  }
}
