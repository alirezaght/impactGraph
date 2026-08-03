// Story 13.2 / §35 — the pure part of assisted API-key entry: which provider has a console page
// worth opening, and what the user is asked before the key prompt appears.
//
// No `vscode` import here, so it is testable outside an extension host; the shell does the two
// side effects (`env.openExternal`, `showInputBox`) and nothing else. Opening a browser is the
// ONLY thing this adds — the key itself still goes to SecretStorage and to nowhere else, and no
// code path here touches configuration.

/** Where Anthropic issues API keys. Public documentation URL; nothing is sent to it. */
export const ANTHROPIC_CONSOLE_KEYS_URL = 'https://console.anthropic.com/settings/keys';

/**
 * The console page for a strategy, or undefined when there is nothing sensible to open.
 *
 * `openai-compatible` and `local` deliberately return undefined: the endpoint is whatever the user
 * configured — Ollama, llama.cpp, a self-hosted gateway — so there is no page we could know about,
 * and guessing `platform.openai.com` would send someone to the wrong vendor's billing page.
 */
export const keyPageFor = (strategy: string): string | undefined =>
  strategy === 'anthropic' ? ANTHROPIC_CONSOLE_KEYS_URL : undefined;

/** Labels for the pre-prompt choice. `Open` is first so it is the default-highlighted action. */
export const OPEN_KEY_PAGE = 'Open key page';
export const ALREADY_HAVE_KEY = 'I already have a key';

export interface KeyPagePrompt {
  readonly url: string;
  readonly title: string;
  readonly detail: string;
  readonly choices: readonly [typeof OPEN_KEY_PAGE, typeof ALREADY_HAVE_KEY];
}

/**
 * The offer shown before the key input box, or undefined when the strategy has no console page and
 * the shell should go straight to the prompt.
 */
export const keyPagePrompt = (strategy: string): KeyPagePrompt | undefined => {
  const url = keyPageFor(strategy);
  if (url === undefined) {
    return undefined;
  }
  return {
    url,
    title: 'ImpactGraph needs an Anthropic API key',
    // States where the key ends up, so the browser trip does not read as "and then we upload it".
    detail:
      `Open ${url} to create one, then paste it here. ` +
      'The key is stored in VS Code SecretStorage only — never in a configuration file.',
    choices: [OPEN_KEY_PAGE, ALREADY_HAVE_KEY],
  };
};

/**
 * Whether the shell should open a browser for this answer. Dismissing the dialog returns undefined
 * and must NOT be read as consent to launch a browser.
 */
export const shouldOpenKeyPage = (choice: string | undefined): boolean => choice === OPEN_KEY_PAGE;

/**
 * Whether to continue to the key prompt. Dismissing the offer cancels the whole flow — the user
 * closed a dialog, which is not the same as "carry on and ask me for a secret anyway".
 */
export const shouldPromptForKey = (choice: string | undefined): boolean => choice !== undefined;
