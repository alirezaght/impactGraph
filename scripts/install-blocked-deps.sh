#!/usr/bin/env bash
# Dependencies approved on 2026-08-01 but not installable from the assistant session
# (package-manager commands are blocked there). Run this once from the repo root:
#
#   bash scripts/install-blocked-deps.sh
#
# Unblocks: Epic 16 (multi-stack adapters), Epic 9 (graph webview), Epic 17.4 (electron tests).
set -euo pipefail

# Epic 16 — tree-sitter WASM parser runtime + prebuilt grammars (ADR-0008: WASM, no native bindings)
pnpm --filter @impactgraph/language-adapters add web-tree-sitter
pnpm --filter @impactgraph/language-adapters add -D tree-sitter-wasms

# Epic 16.1 — Terraform/HCL grammar (ADR-0014). tree-sitter-wasms ships no HCL grammar;
# this package publishes a prebuilt .wasm with a modern dylink.0 section.
pnpm --filter @impactgraph/language-adapters add @tree-sitter-grammars/tree-sitter-hcl

# Epic 9 — graph webview (React + Cytoscape, webview only per dependency rules)
pnpm --filter impactgraph add react react-dom cytoscape
pnpm --filter impactgraph add -D @types/react @types/react-dom @types/cytoscape jsdom

# Epic 17.4 — VS Code integration-test harness
pnpm --filter impactgraph add -D @vscode/test-electron

echo "Done. Tell the assistant the install is complete to continue Epics 9, 16, and 17.4."
