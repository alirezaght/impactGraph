import { createPreflightFinding } from '@impactgraph/domain';

import type { PreflightFinding } from '@impactgraph/domain';

/**
 * Configuration defaults that are present but mean "not configured".
 *
 * `SENDGRID_TEMPLATE_IDS_JSON = "{}"` passes every presence check ever written: the variable is
 * set, the string is truthy, `json.loads` succeeds. It also means no template is configured, so the
 * feature silently does nothing in the environment where somebody forgot to set it.
 *
 * Deliberately narrow. This reads LITERAL defaults in a handful of shapes and says nothing at all
 * about the rest, because the alternative — inferring intent from arbitrary initialisation code —
 * produces confident claims about behaviour nobody verified. Anything unread is reported as
 * `not-extracted`, never as "fine".
 */

export const CONFIG_SEMANTICS = [
  /** A default that is present and truthy but carries no configuration: `"{}"`, `"[]"`, `""`. */
  'empty-but-truthy-default',
  /** A default that lets the code proceed when configuration is missing. */
  'fail-open-default',
  /** No default: the value must be supplied or the process cannot start. */
  'required',
  /** A default that is a real value. */
  'defaulted',
  /** The declaration was not in a shape this analyzer reads. */
  'not-extracted',
] as const;

export type ConfigSemantic = (typeof CONFIG_SEMANTICS)[number];

/** One configuration declaration, as read from a settings class, env schema or config file. */
export interface ConfigDeclaration {
  readonly name: string;
  readonly filePath: string;
  readonly line?: number;
  /** The default exactly as written, or absent when the declaration states none. */
  readonly defaultLiteral?: string;
  /** True when the surrounding code tolerates absence rather than raising. */
  readonly toleratesAbsence?: boolean;
  readonly evidenceIds: readonly string[];
}

/** Literals that are truthy to a presence check yet carry no configuration. */
const EMPTY_BUT_TRUTHY = new Set(['{}', '[]', '""', "''", '" "', '{ }', '[ ]']);

const normalise = (literal: string): string =>
  literal
    .trim()
    .replace(/^["'](.*)["']$/s, '$1')
    .trim();

export const classifyConfig = (declaration: ConfigDeclaration): ConfigSemantic => {
  const literal = declaration.defaultLiteral;
  if (literal === undefined) {
    return declaration.toleratesAbsence === true ? 'fail-open-default' : 'required';
  }
  const trimmed = literal.trim();
  const unquoted = normalise(trimmed);
  if (EMPTY_BUT_TRUTHY.has(trimmed) || EMPTY_BUT_TRUTHY.has(unquoted) || unquoted.length === 0) {
    return 'empty-but-truthy-default';
  }
  if (/^(none|null|nil|undefined|false|0)$/i.test(unquoted)) {
    return declaration.toleratesAbsence === true ? 'fail-open-default' : 'defaulted';
  }
  return 'defaulted';
};

export interface CheckConfigSemanticsInput {
  /** Declarations for configuration the plan says the feature needs. */
  readonly declarations: readonly ConfigDeclaration[];
  readonly requirementIds: readonly string[];
  readonly nextId: (seed: string) => string;
}

const statementFor = (declaration: ConfigDeclaration, semantic: ConfigSemantic): string =>
  semantic === 'empty-but-truthy-default'
    ? `${declaration.name} defaults to ${declaration.defaultLiteral ?? ''}, which is present and truthy but represents missing configuration — a presence check will pass in an environment where the value was never set.`
    : `${declaration.name} has no default and the surrounding code tolerates its absence, so the feature will silently do nothing where it is unset.`;

export const checkConfigSemantics = (
  input: CheckConfigSemanticsInput,
): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  for (const declaration of input.declarations) {
    const semantic = classifyConfig(declaration);
    if (semantic !== 'empty-but-truthy-default' && semantic !== 'fail-open-default') {
      continue;
    }
    const result = createPreflightFinding({
      id: input.nextId(`config:${declaration.name}`),
      kind: 'config-semantics-risk',
      severity: 'warning',
      // A risk in configuration the plan needs, never a proven defect (ADR-0018 asymmetry).
      verification: 'unverified-assumption',
      requirementIds: [...input.requirementIds],
      statement: statementFor(declaration, semantic),
      recommendation: `Fail closed when ${declaration.name} is unset, or state explicitly that the empty default is the intended behaviour.`,
      subject: { filePaths: [declaration.filePath] },
      evidenceIds: [...declaration.evidenceIds],
      confidence: semantic === 'empty-but-truthy-default' ? 0.8 : 0.6,
      provenance: 'static-analysis',
      analyzer: 'check-config-semantics',
    });
    if (result.ok) {
      findings.push(result.value);
    }
  }
  return findings;
};
