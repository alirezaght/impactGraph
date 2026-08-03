// Conventional Commits (brief: locked tooling). Scopes mirror the workspace layout;
// warning-level so cross-cutting commits (e.g. repo-wide rename) are not blocked.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'domain',
        'application',
        'contracts',
        'repo-intel',
        'lang-adapters',
        'framework-adapters',
        'git',
        'persistence',
        'ai',
        'extension',
        'webview',
        'cli',
        'mcp',
        'test-kit',
        'quality',
        'docs',
        'ci',
        'release',
        'deps',
      ],
    ],
  },
};
