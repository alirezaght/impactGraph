import { z } from 'zod';

import { evidenceRangeSchema } from '../artifacts/explanation.js';

import {
  evidencePanelStateSchema,
  impactGraphSchema,
  specificationPanelStateSchema,
} from './panels.js';
import { parseVersionedMessage, WEBVIEW_PROTOCOL_VERSION } from './protocol.js';

import type { MessageParseResult } from './protocol.js';

// PRD §29.2 — the complete webview message vocabulary, v1. Host → webview messages carry state;
// webview → host messages carry INTENT ONLY. The webview never decides: every accept/reject/
// answer/edit is a request whose authoritative outcome comes back as a fresh state message.

const envelope = <T extends string, P extends z.ZodRawShape>(type: T, payload: P) =>
  z
    .object({
      protocolVersion: z.literal(WEBVIEW_PROTOCOL_VERSION),
      type: z.literal(type),
      payload: z.object(payload).strict(),
    })
    .strict();

// --------------------------------------------------------------------------------------------
// Host → webview
// --------------------------------------------------------------------------------------------

export const hostMessageSchema = z.discriminatedUnion('type', [
  envelope('host/specification', { state: specificationPanelStateSchema }),
  envelope('host/graph', { graph: impactGraphSchema }),
  envelope('host/evidence', { state: evidencePanelStateSchema }),
  envelope('host/status', {
    busy: z.boolean(),
    label: z.string().min(1).optional(),
    notice: z.string().min(1).optional(),
  }),
  envelope('host/error', {
    code: z.string().min(1),
    message: z.string().min(1),
  }),
]);

export type HostMessage = z.infer<typeof hostMessageSchema>;

export const HOST_MESSAGE_TYPES: readonly HostMessage['type'][] = [
  'host/specification',
  'host/graph',
  'host/evidence',
  'host/status',
  'host/error',
];

// --------------------------------------------------------------------------------------------
// Webview → host
// --------------------------------------------------------------------------------------------

const specificationRef = {
  specificationId: z.string().min(1),
} as const;

export const webviewMessageSchema = z.discriminatedUnion('type', [
  envelope('webview/ready', {}),
  /** §18.2 import: the host reads the current Markdown file or the editor selection. */
  envelope('webview/import-specification', { source: z.enum(['current-file', 'selection']) }),
  /** §19 Analyze Specification, driven from the panel's editor. */
  envelope('webview/analyze-specification', {
    name: z.string().min(1),
    text: z.string().min(1),
  }),
  /** §19 Save Specification Version — persists version N+1 when the text changed. */
  envelope('webview/save-specification-version', {
    name: z.string().min(1),
    text: z.string().min(1),
  }),
  /** §19 Compare Specification Versions. */
  envelope('webview/compare-specification-versions', {
    ...specificationRef,
    left: z.number().int().min(1),
    right: z.number().int().min(1),
  }),
  envelope('webview/answer-question', {
    ...specificationRef,
    questionId: z.string().min(1),
    answer: z.string().min(1),
  }),
  envelope('webview/dismiss-question', { ...specificationRef, questionId: z.string().min(1) }),
  envelope('webview/requirement-decision', {
    ...specificationRef,
    requirementId: z.string().min(1),
    decision: z.enum(['confirmed', 'rejected']),
  }),
  envelope('webview/edit-requirement', {
    ...specificationRef,
    requirementId: z.string().min(1),
    statement: z.string().min(1),
  }),
  /** §18.4 open source file from a node; the range reveals the declaration (§40.4). */
  envelope('webview/open-source', {
    path: z.string().min(1),
    range: evidenceRangeSchema.optional(),
  }),
  /** §18.5 selection → evidence. The host answers with `host/evidence`. */
  envelope('webview/select-node', {
    nodeId: z.string().min(1),
    analysisId: z.string().min(1).optional(),
    requirementId: z.string().min(1).optional(),
  }),
  /** §40.3 accept/reject. Append-only on the host; the webview waits for the result. */
  envelope('webview/impact-decision', {
    analysisId: z.string().min(1),
    requirementId: z.string().min(1),
    nodeId: z.string().min(1),
    decision: z.enum(['accepted', 'rejected']),
    reason: z.string().min(1).optional(),
  }),
  /** §18.4 "add missing impact" — the host runs the node picker; free text is impossible. */
  envelope('webview/add-manual-impact', {}),
  envelope('webview/refresh', {}),
]);

export type WebviewMessage = z.infer<typeof webviewMessageSchema>;

export const WEBVIEW_MESSAGE_TYPES: readonly WebviewMessage['type'][] = [
  'webview/ready',
  'webview/import-specification',
  'webview/analyze-specification',
  'webview/save-specification-version',
  'webview/compare-specification-versions',
  'webview/answer-question',
  'webview/dismiss-question',
  'webview/requirement-decision',
  'webview/edit-requirement',
  'webview/open-source',
  'webview/select-node',
  'webview/impact-decision',
  'webview/add-manual-impact',
  'webview/refresh',
];

/** Validate a host → webview message (called INSIDE the webview before rendering). */
export const parseHostMessage = (raw: unknown): MessageParseResult<HostMessage> =>
  parseVersionedMessage(hostMessageSchema, HOST_MESSAGE_TYPES, raw);

/** Validate a webview → host message (called INSIDE the extension host before acting). */
export const parseWebviewMessage = (raw: unknown): MessageParseResult<WebviewMessage> =>
  parseVersionedMessage(webviewMessageSchema, WEBVIEW_MESSAGE_TYPES, raw);
