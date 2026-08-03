// PRD §20 — exit codes must distinguish these outcomes. Apps map typed errors to this enum;
// no literal exit numbers may appear in apps/cli (typed-message-contract skill).
export const EXIT_CODES = {
  success: 0,
  /** Unexpected internal failure — not one of the §20 categories, reserved by convention. */
  internalError: 1,
  warningsFound: 2,
  reviewDiscrepancies: 3,
  configurationError: 4,
  indexingFailure: 5,
  providerFailure: 6,
  unsupportedProject: 7,
} as const;

export type ExitCodeName = keyof typeof EXIT_CODES;

export type ExitCode = (typeof EXIT_CODES)[ExitCodeName];

export const EXIT_CODE_NAMES = Object.keys(EXIT_CODES) as readonly ExitCodeName[];
