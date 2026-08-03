import * as vscode from 'vscode';

import type { TelemetryEvent } from './events.js';

// §36: off by default, explicit opt-in (`impactgraph.telemetry.enabled` AND VS Code's global
// telemetry switch), visible (events land in a user-openable output channel), reversible
// (flip the setting off — nothing else persists). No remote transmission exists: the local
// channel is the ONLY sink, so opting in shows exactly what WOULD be collected.

let channel: vscode.OutputChannel | undefined;

const enabled = (): boolean =>
  vscode.env.isTelemetryEnabled &&
  vscode.workspace.getConfiguration('impactgraph').get<boolean>('telemetry.enabled', false);

export const recordTelemetry = (event: TelemetryEvent | undefined): void => {
  if (event === undefined || !enabled()) {
    return;
  }
  channel ??= vscode.window.createOutputChannel('ImpactGraph Telemetry');
  channel.appendLine(JSON.stringify({ name: event.name, ...event.properties }));
};

export const disposeTelemetry = (): void => {
  channel?.dispose();
  channel = undefined;
};
