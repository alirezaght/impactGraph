export type ValidationIssueCode =
  | 'invalid-type'
  | 'unsupported-schema-version'
  | 'blank-id'
  | 'blank-field'
  | 'unknown-provenance'
  | 'reserved-provenance'
  | 'missing-evidence'
  | 'unknown-node-category'
  | 'type-category-mismatch'
  | 'unknown-edge-type'
  | 'unknown-evidence-kind'
  | 'invalid-source'
  | 'invalid-timestamp'
  | 'invalid-commit'
  | 'duplicate-id'
  | 'unknown-node-reference'
  | 'out-of-range'
  | 'missing-signals'
  | 'unknown-signal'
  | 'wrong-sign-signal';

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface ValidationError {
  readonly name: 'ValidationError';
  readonly issues: readonly ValidationIssue[];
}

export const validationIssue = (
  code: ValidationIssueCode,
  path: string,
  message: string,
): ValidationIssue => Object.freeze({ code, path, message });

export const validationError = (issues: readonly ValidationIssue[]): ValidationError =>
  Object.freeze({ name: 'ValidationError' as const, issues: Object.freeze([...issues]) });
