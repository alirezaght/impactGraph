// ESLint flat config for the ImpactGraph monorepo.
//
// Enforces the locked dependency direction (docs/engineering/dependency-rules.md, ADR-0004,
// ADR-0013) via eslint-plugin-boundaries, forbidden-import zones via no-restricted-imports,
// and the anti-LOC-gaming style rules that back the effective-LOC policy (ADR-0012).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

// ---------------------------------------------------------------------------
// Forbidden-import building blocks (CLAUDE.md rule 3, PRD §29)
// ---------------------------------------------------------------------------

const VSCODE = {
  name: 'vscode',
  message:
    "'vscode' may only be imported in apps/vscode-extension/src (the extension shell). Core packages talk to the editor through application ports.",
};

const NODE_IO = ['fs', 'node:fs', 'node:fs/promises', 'child_process', 'node:child_process'].map(
  (name) => ({
    name,
    message: `'${name}' is an adapter concern. domain/application stay pure (ports only); the webview is a sandboxed browser context.`,
  }),
);

const UI = ['react', 'react-dom', 'cytoscape'].map((name) => ({
  name,
  message: `'${name}' may only be imported in apps/vscode-extension/webview (ADR-0005). Everything else is UI-free.`,
}));

const SQLITE = {
  name: 'better-sqlite3',
  message:
    "'better-sqlite3' may only be imported in packages/persistence (ADR-0006 — SQLite index is a persistence-adapter detail).",
};

const AI_SDKS = ['@anthropic-ai/*', '@google/*', 'openai'].map((group) => ({
  group: [group],
  message:
    'AI-provider SDKs live only in packages/ai-inference/providers/* behind the ModelProvider port (ADR-0010, PRD §8).',
}));

/**
 * Workspace dependency direction (docs/engineering/dependency-rules.md): forbid all
 * @impactgraph/* imports except the listed packages. Closes the gap left by
 * eslint-plugin-boundaries, which does not resolve workspace package names.
 */
const workspaceOnly = (...allowed) => ({
  group: ['@impactgraph/*', ...allowed.map((name) => `!@impactgraph/${name}`)],
  message:
    'cross-package import violates the dependency direction — see docs/engineering/dependency-rules.md',
});

const NO_TEST_KIT = {
  group: ['@impactgraph/test-kit'],
  message: 'packages/test-kit is a dev dependency — production code must not import it',
};

/** Build a per-directory no-restricted-imports config object. */
const restrict = (files, { paths = [], patterns = [] }) => ({
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        ...(paths.length > 0 ? { paths } : {}),
        ...(patterns.length > 0 ? { patterns } : {}),
      },
    ],
  },
});

export default tseslint.config(
  // -------------------------------------------------------------------------
  // Global ignores
  // -------------------------------------------------------------------------
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/out/',
      '**/build/',
      '**/coverage/',
      '**/.vscode-test/',
      'scripts/quality/effective-loc/fixtures/**',
      'packages/test-kit/fixtures/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // -------------------------------------------------------------------------
  // Base + type-checked TypeScript rules
  // -------------------------------------------------------------------------
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root-level *.config.ts (e.g. vitest.config.ts) are not part of any tsconfig.
          allowDefaultProject: ['*.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Plain JS/MJS/CJS (config files) are not covered by a tsconfig — no type-aware rules there.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },

  // -------------------------------------------------------------------------
  // Main TypeScript ruleset + architectural boundaries
  // -------------------------------------------------------------------------
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'import-x': importX,
      boundaries,
    },
    settings: {
      // Element roster mirrors docs/engineering/dependency-rules.md. Order matters:
      // specific packages first, then the adapter catch-all for the remaining packages/*.
      'boundaries/elements': [
        { type: 'domain', pattern: 'packages/domain' },
        { type: 'application', pattern: 'packages/application' },
        { type: 'contracts', pattern: 'packages/contracts' },
        { type: 'test-kit', pattern: 'packages/test-kit' },
        // git, persistence, ai-inference, repository-intelligence, language-adapters,
        // framework-adapters — all remaining packages are adapters by construction.
        { type: 'adapter', pattern: 'packages/*', capture: ['adapterName'] },
        { type: 'webview', pattern: 'apps/vscode-extension/webview' },
        { type: 'extension', pattern: 'apps/vscode-extension/src' },
        { type: 'cli', pattern: 'apps/cli' },
        { type: 'mcp', pattern: 'apps/mcp-server' },
        { type: 'quality', pattern: 'scripts/quality' },
      ],
      // Tests may reach for packages/test-kit fakes/builders regardless of their element;
      // production boundaries are enforced on production files only.
      'boundaries/ignore': ['**/*.test.ts', '**/*.test.tsx'],
    },
    rules: {
      // --- async correctness ---
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // --- type honesty ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],

      // --- imports ---
      'import-x/no-default-export': 'error',
      'import-x/no-cycle': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // --- size & complexity (backs the 300-effective-LOC policy, ADR-0012;
      //     anti-gaming: no statement-packing, no braceless one-liners) ---
      complexity: ['error', 10],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      'max-depth': ['error', 3],
      'max-statements-per-line': ['error', { max: 1 }],
      curly: ['error', 'all'],

      // --- logging goes through the logging port, never stdout (PRD §35: secrets
      //     must never leak into logs; a port makes redaction enforceable) ---
      'no-console': 'error',

      // --- architectural boundaries (CLAUDE.md rule 2) ---
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message:
            '${file.type} may not import ${dependency.type} — see docs/engineering/dependency-rules.md',
          rules: [
            // domain, contracts, quality import no internal element (default disallow).
            { from: 'application', allow: ['domain'] },
            { from: 'adapter', allow: ['application', 'domain', 'contracts'] },
            { from: 'extension', allow: ['application', 'adapter', 'contracts', 'domain'] },
            // Webview imports contracts ONLY — never domain (CLAUDE.md rule 2).
            { from: 'webview', allow: ['contracts'] },
            { from: 'cli', allow: ['application', 'adapter', 'contracts', 'domain'] },
            { from: 'mcp', allow: ['application', 'adapter', 'contracts', 'domain'] },
            { from: 'test-kit', allow: ['domain', 'application', 'contracts', 'adapter'] },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Forbidden-import zones (per-directory, CLAUDE.md rule 3)
  // -------------------------------------------------------------------------
  restrict(['packages/domain/**/*.ts'], {
    paths: [VSCODE, ...NODE_IO, ...UI, SQLITE],
    patterns: [...AI_SDKS, workspaceOnly()],
  }),
  restrict(['packages/application/**/*.ts'], {
    paths: [VSCODE, ...NODE_IO, ...UI, SQLITE],
    patterns: [...AI_SDKS, workspaceOnly('domain')],
  }),
  restrict(['apps/vscode-extension/webview/**/*.{ts,tsx}'], {
    paths: [VSCODE, ...NODE_IO, SQLITE],
    patterns: [...AI_SDKS, workspaceOnly('contracts')],
  }),
  restrict(['apps/vscode-extension/src/**/*.ts'], {
    paths: [...UI, SQLITE],
    patterns: [...AI_SDKS, NO_TEST_KIT],
  }),
  restrict(['apps/cli/**/*.ts', 'apps/mcp-server/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: [...AI_SDKS, NO_TEST_KIT],
  }),
  restrict(['packages/contracts/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: [...AI_SDKS, workspaceOnly()],
  }),
  restrict(['packages/git/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: [...AI_SDKS, workspaceOnly('application', 'domain')],
  }),
  restrict(['packages/repository-intelligence/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: [
      ...AI_SDKS,
      workspaceOnly(
        'application',
        'domain',
        'language-adapters',
        'framework-adapters',
        'persistence',
      ),
    ],
  }),
  restrict(['packages/language-adapters/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: [...AI_SDKS, workspaceOnly('application', 'domain', 'contracts')],
  }),
  restrict(['packages/framework-adapters/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: [
      ...AI_SDKS,
      workspaceOnly('application', 'domain', 'contracts', 'language-adapters'),
    ],
  }),
  restrict(['packages/test-kit/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: AI_SDKS,
  }),
  restrict(['packages/workspace-engine/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: [
      ...AI_SDKS,
      workspaceOnly(
        'application',
        'domain',
        'contracts',
        'git',
        'persistence',
        'repository-intelligence',
        'language-adapters',
        'framework-adapters',
        'ai-inference',
      ),
    ],
  }),
  restrict(['packages/persistence/**/*.ts'], {
    paths: [VSCODE, ...UI],
    patterns: [...AI_SDKS, workspaceOnly('application', 'domain', 'contracts')],
  }),
  restrict(['packages/ai-inference/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: [workspaceOnly('application', 'domain', 'contracts')],
  }),
  restrict(['scripts/quality/**/*.ts'], {
    paths: [VSCODE, ...UI, SQLITE],
    patterns: AI_SDKS,
  }),

  // -------------------------------------------------------------------------
  // Targeted overrides
  // -------------------------------------------------------------------------
  // Config files and future webview route files legitimately default-export.
  {
    files: [
      '**/*.config.{ts,mts,cts,js,mjs,cjs}',
      'eslint.config.mjs',
      'apps/vscode-extension/webview/src/routes/**',
    ],
    rules: {
      'import-x/no-default-export': 'off',
    },
  },
  // Quality-gate scripts are CLIs — their output channel IS the console.
  {
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Test files: bigger describe blocks are fine; `.only` is banned outright.
  // Policy: `.skip` requires a justification comment (docs/engineering/testing-strategy.md) —
  // reviewed by humans, not lintable without false positives.
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'max-lines-per-function': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='only']",
          message:
            '.only silently disables the rest of the suite and will pass CI while hiding failures. Remove it before committing.',
        },
      ],
    },
  },

  // The @vscode/test-electron lane (apps/vscode-extension/src/test) is test code that MUST
  // import `vscode` — it runs inside a real extension host — so it deliberately does not use the
  // `*.test.ts` suffix and is not covered by the overrides above. Same test allowances, and the
  // extension zone's own forbidden-import list (UI, sqlite, provider SDKs, test-kit) still holds.
  {
    files: ['apps/vscode-extension/src/test/**/*.ts'],
    rules: {
      'max-lines-per-function': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='only']",
          message:
            '.only silently disables the rest of the suite and will pass CI while hiding failures. Remove it before committing.',
        },
      ],
    },
  },

  // Tests may reach across packages and into test-kit (fixtures, fakes, alignment tests);
  // the hard safety net (vscode, sqlite, provider SDKs) still applies.
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [VSCODE, SQLITE], patterns: AI_SDKS }],
    },
  },
  // …except persistence's own tests, which legitimately drive better-sqlite3 directly.
  {
    files: ['packages/persistence/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [VSCODE], patterns: AI_SDKS }],
    },
  },

  // Prettier last — disables stylistic rules that would fight the formatter.
  prettier,
);
