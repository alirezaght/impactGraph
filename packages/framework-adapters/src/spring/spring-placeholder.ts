import { isConflict, statedProperty } from './spring-properties.js';

import type { SpringPropertySources, Stated } from './spring-properties.js';

// Resolving one `@Value("${key}")` / `@Value("${key:default}")` placeholder.
//
// The whole annotation argument must be exactly one placeholder. `@Value("topics-${env}")` is a
// COMPOSITE, and resolving the hole would produce a name assembled here rather than stated
// anywhere — the same mistake as reading an f-string's prefix as a topic name. It resolves to
// nothing.
//
// Every other refusal has the same shape: two candidate values (a profile conflict), zero
// candidate values (an unknown key with no default), or a value that is itself a placeholder
// (`deals.topic: ${OTHER}` — the repository still does not state the value; nothing here expands a
// second time, so a `${}` chain terminates immediately rather than recursing).
//
// A resolved name must also LOOK like a bare resource name — no whitespace, no `/`. A configuration
// value of `projects/p/topics/t` is a fully-qualified resource path, not a name, and treating the
// whole string as a topic name would land on a node id no other adapter produces.

const PLACEHOLDER = /^\$\{([^{}:]+)(?::([^{}]*))?\}$/;

const BARE_NAME = /^[^\s/]+$/;

export interface PlaceholderResolution {
  /** The literal the repository states, when it states exactly one. */
  readonly name?: string;
  /** Evidence for the configuration entry — absent when the default in the annotation supplied it. */
  readonly configEvidenceId?: string;
  /** Why nothing resolved. Present exactly when `name` is absent. */
  readonly refusal?: string;
}

const refuse = (refusal: string): PlaceholderResolution => ({ refusal });

const accept = (name: string, configEvidenceId?: string): PlaceholderResolution =>
  BARE_NAME.test(name)
    ? { name, ...(configEvidenceId === undefined ? {} : { configEvidenceId }) }
    : refuse(`the configured value '${name}' is not a bare resource name`);

/** What a key the configuration DOES state resolves to. */
const fromStatedValue = (stated: Stated, key: string): PlaceholderResolution => {
  if (isConflict(stated)) {
    return refuse(
      `'${key}' is stated differently by ${stated.conflictingFiles.join(' and ')} — ` +
        'which one applies depends on the active profile, which the repository does not state',
    );
  }
  return stated.value.includes('${')
    ? refuse(`'${key}' is configured to another placeholder ('${stated.value}')`)
    : accept(stated.value, stated.evidenceId);
};

/**
 * The literal a `@Value` annotation argument resolves to in one module, or the reason it does not.
 * Nothing is expanded recursively and no profile is chosen (PRD §35).
 */
export const resolvePlaceholder = (
  argument: string,
  moduleRoot: string,
  sources: SpringPropertySources,
): PlaceholderResolution => {
  const matched = PLACEHOLDER.exec(argument);
  const key = matched?.[1]?.trim();
  if (key === undefined || key === '') {
    return refuse(`'${argument}' is not a single \${key} placeholder`);
  }
  const stated = statedProperty(sources, moduleRoot, key);
  if (stated !== undefined) {
    return fromStatedValue(stated, key);
  }
  const fallback = matched?.[2];
  return fallback === undefined || fallback === ''
    ? refuse(`no Spring configuration in this module states '${key}'`)
    : accept(fallback);
};
