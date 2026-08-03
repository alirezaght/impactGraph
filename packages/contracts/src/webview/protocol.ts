import { z } from 'zod';

// The webview ↔ extension-host envelope (PRD §29.2, ADR-0009). Every message carries an explicit
// protocol version and is Zod-validated on BOTH ends. An unknown version is a typed error — the
// webview and the host both refuse to best-effort parse a message they may not understand.

export const WEBVIEW_PROTOCOL_VERSION = 1;

export const webviewEnvelopeSchema = z
  .object({
    protocolVersion: z.number().int().min(1),
    type: z.string().min(1),
  })
  .passthrough();

export type MessageParseError =
  | { readonly code: 'malformed'; readonly message: string }
  | {
      readonly code: 'unsupported-protocol-version';
      readonly message: string;
      readonly receivedVersion: number;
    }
  | { readonly code: 'unknown-type'; readonly message: string; readonly receivedType: string }
  | { readonly code: 'invalid-payload'; readonly message: string; readonly receivedType: string };

export type MessageParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MessageParseError };

/**
 * Envelope → version → payload, in that order, so the failure reported is the first real one.
 * `knownTypes` is checked before the payload schema, because a discriminated-union failure on an
 * unrecognised `type` would otherwise be reported as a payload problem.
 */
export const parseVersionedMessage = <T>(
  schema: z.ZodType<T>,
  knownTypes: readonly string[],
  raw: unknown,
): MessageParseResult<T> => {
  const envelope = webviewEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { ok: false, error: { code: 'malformed', message: 'not a versioned webview message' } };
  }
  if (envelope.data.protocolVersion !== WEBVIEW_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: {
        code: 'unsupported-protocol-version',
        message: `webview protocol v${String(envelope.data.protocolVersion)} is not supported (this build speaks v${String(WEBVIEW_PROTOCOL_VERSION)})`,
        receivedVersion: envelope.data.protocolVersion,
      },
    };
  }
  if (!knownTypes.includes(envelope.data.type)) {
    return {
      ok: false,
      error: {
        code: 'unknown-type',
        message: `unknown webview message type '${envelope.data.type}'`,
        receivedType: envelope.data.type,
      },
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'invalid-payload',
        message: parsed.error.issues[0]?.message ?? 'payload failed contract validation',
        receivedType: envelope.data.type,
      },
    };
  }
  return { ok: true, value: parsed.data };
};
