import { describe, expect, it } from 'vitest';

import {
  ALREADY_HAVE_KEY,
  ANTHROPIC_CONSOLE_KEYS_URL,
  OPEN_KEY_PAGE,
  keyPageFor,
  keyPagePrompt,
  shouldOpenKeyPage,
  shouldPromptForKey,
} from './provider-key-entry.js';

// Story 13.2 / §35 — assisted key entry. The shell parts (`env.openExternal`, `showInputBox`) are
// exercised by the VS Code integration suite; this pins the decisions around them.

describe('assisted API-key entry (§35)', () => {
  it('offers the Anthropic console page for the anthropic strategy', () => {
    expect(keyPageFor('anthropic')).toBe(ANTHROPIC_CONSOLE_KEYS_URL);
    expect(ANTHROPIC_CONSOLE_KEYS_URL).toBe('https://console.anthropic.com/settings/keys');
  });

  it.each(['openai-compatible', 'local', 'none', 'external-agent'])(
    'offers no page for %s — the endpoint is the user’s, so we cannot know its console',
    (strategy) => {
      expect(keyPageFor(strategy)).toBeUndefined();
      expect(keyPagePrompt(strategy)).toBeUndefined();
    },
  );

  it('states where the key ends up, so the browser trip does not read as an upload', () => {
    const prompt = keyPagePrompt('anthropic');
    expect(prompt?.detail).toContain('SecretStorage');
    expect(prompt?.detail).toContain('never in a configuration file');
    expect(prompt?.detail).toContain(ANTHROPIC_CONSOLE_KEYS_URL);
  });

  it('puts the open action first so it is the highlighted default', () => {
    expect(keyPagePrompt('anthropic')?.choices).toEqual([OPEN_KEY_PAGE, ALREADY_HAVE_KEY]);
  });

  it('opens a browser only on an explicit request', () => {
    expect(shouldOpenKeyPage(OPEN_KEY_PAGE)).toBe(true);
    expect(shouldOpenKeyPage(ALREADY_HAVE_KEY)).toBe(false);
    // dismissing the dialog is not consent to launch a browser
    expect(shouldOpenKeyPage(undefined)).toBe(false);
  });

  it('treats a dismissed offer as cancelling the flow, not as "ask me for a secret anyway"', () => {
    expect(shouldPromptForKey(OPEN_KEY_PAGE)).toBe(true);
    expect(shouldPromptForKey(ALREADY_HAVE_KEY)).toBe(true);
    expect(shouldPromptForKey(undefined)).toBe(false);
  });

  it('never exposes a URL that could receive the key', () => {
    // The console page is where a key is CREATED. Nothing here may be a submission endpoint.
    const url = new URL(ANTHROPIC_CONSOLE_KEYS_URL);
    expect(url.protocol).toBe('https:');
    expect(url.search).toBe('');
  });
});
