import { randomBytes } from 'node:crypto';

// Webview hosting security (PRD §35, main skill §9): a strict CSP with a per-load nonce, no
// remote origins at all, and script execution limited to the one bundled webview script.
// Pure string construction — unit-tested without Electron.

/** 128 bits of CSPRNG entropy, base64 — a fresh nonce per panel load, never reused. */
export const createNonce = (): string => randomBytes(16).toString('base64');

export interface WebviewHtmlOptions {
  readonly nonce: string;
  /** `webview.cspSource` — the only origin allowed to serve styles/images. */
  readonly cspSource: string;
  /** Script URI produced by `webview.asWebviewUri` over the built bundle. */
  readonly scriptUri: string;
  /** Stylesheet URI from the same bundle directory (emitted alongside the script). */
  readonly styleUri: string;
  readonly title: string;
}

/**
 * `default-src 'none'` denies everything by default; each directive then opens exactly one
 * local capability. There is no `connect-src`, no `font-src`, and no CDN — the webview cannot
 * reach the network even if a dependency tried to (PRD §35, privacy).
 */
export const contentSecurityPolicy = (nonce: string, cspSource: string): string =>
  [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "font-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

/** Escape everything interpolated into markup — repository content is untrusted (§42.5). */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildWebviewHtml = (options: WebviewHtmlOptions): string => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(
      contentSecurityPolicy(options.nonce, options.cspSource),
    )}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${escapeHtml(options.styleUri)}" />
    <title>${escapeHtml(options.title)}</title>
  </head>
  <body>
    <div id="impactgraph-root" role="application" aria-label="${escapeHtml(options.title)}"></div>
    <script nonce="${escapeHtml(options.nonce)}" src="${escapeHtml(options.scriptUri)}"></script>
  </body>
</html>
`;
