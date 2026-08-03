import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asRecord,
  expectCorrectionOverlay,
  expectConfirmationProtectsFromRemoval,
  expectDeviationFlow,
  expectOwnershipOverlay,
  expectQueryAndExplain,
  expectRuleDryRun,
  expectStructureAndConfigReads,
} from './registry-flows.js';
import { expectGraphHtmlExport } from './registry-graph-flow.js';
import { callTool } from './registry.js';

import type { McpToolName } from '@impactgraph/contracts';

// Story 12.2 — the §21.1 agent workflow executed via tools alone, sequentially on one fixture
// repo (state builds up step by step, as a real agent session would).

describe('MCP tool workflow (§21.1) on a fixture repository', () => {
  let repoDir: string;
  let analysisId = '';

  const tool = async (name: McpToolName, args: unknown = {}): Promise<Record<string, unknown>> => {
    const outcome = await callTool(repoDir, name, args);
    if (!outcome.ok) {
      throw new Error(`${name} failed: ${outcome.error.message}`);
    }
    return asRecord(outcome.payload);
  };

  const toolError = async (name: McpToolName, args: unknown = {}): Promise<string> => {
    const outcome = await callTool(repoDir, name, args);
    if (outcome.ok) {
      throw new Error(`${name} unexpectedly succeeded`);
    }
    return outcome.error.message;
  };

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-mcp-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'mcp@test.dev');
    git('config', 'user.name', 'MCP Test');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('steps 3–4: initialize, index, submit the specification', async () => {
    const init = await tool('initialize_workspace');
    expect(init['alreadyInitialized']).toBe(false);

    // commit the scaffold so the tree is clean for a stable snapshot
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'init impactgraph'], { cwd: repoDir });

    const indexed = await tool('index_workspace');
    expect(asRecord(indexed['snapshot'])['dirtyWorkingTree']).toBe(false);

    const status = await tool('get_workspace_status');
    expect(status['indexed']).toBe(true);

    const submitted = await tool('submit_specification', {
      name: 'feature.md',
      content: '# Deal filtering\nDealService must filter expired deals from search results.\n',
    });
    expect(submitted['specificationId']).toBe('spec-feature');
    expect(submitted['requirementCount']).toBe(1);
  });

  it('step 5: requirements and open questions are readable', async () => {
    const requirements = await tool('extract_requirements', { specificationId: 'spec-feature' });
    expect((requirements['requirements'] as unknown[]).length).toBe(1);

    const questions = await tool('get_open_questions', { specificationId: 'spec-feature' });
    expect(questions['openQuestions']).toEqual([]);
    // §C10 readiness rides along: deterministic, requirements present, nothing open
    expect((questions['readiness'] as { score: number }).score).toBe(100);

    // answering a nonexistent question is a typed error, never a crash
    const ghost = await toolError('answer_open_question', {
      specificationId: 'spec-feature',
      questionId: 'ghost',
      answer: 'x',
    });
    expect(ghost).toContain('question not found');

    const spec = await tool('get_specification', { specificationId: 'spec-feature' });
    expect(spec['id']).toBe('spec-feature');
  });

  it('step 7: analyze_impact builds an evidence-backed analysis', async () => {
    const analyzed = await tool('analyze_impact', { specificationId: 'spec-feature' });
    const analysis = asRecord(analyzed['analysis']);
    analysisId = analysis['id'] as string;
    expect(analysis['status']).toBe('draft');
    const requirements = analyzed['requirements'] as { impacts: { name: string }[] }[];
    expect(requirements[0]?.impacts.map((impact) => impact.name)).toContain('DealService');
  });

  it('step 8–9: decisions append; approval requires explicit human confirmation (§35)', async () => {
    const analyzed = await tool('get_impact_analysis', { analysisId });
    expect(analyzed['id']).toBe(analysisId);

    const requirements = (await tool('extract_requirements', {
      specificationId: 'spec-feature',
    })) as { requirements?: { id: string }[] };
    const requirementId = requirements.requirements?.[0]?.id ?? '';
    // decisions must reference real impacts
    const badTarget = await toolError('update_impact_decision', {
      analysisId,
      requirementId,
      nodeId: 'nonexistent',
      decision: 'rejected',
    });
    expect(badTarget).toContain('no impact');

    // approval without the confirmation assertion is rejected by the CONTRACT itself
    const unconfirmed = await toolError('approve_analysis', { analysisId });
    expect(unconfirmed).toContain('invalid input');

    const approved = await tool('approve_analysis', { analysisId, confirmedByUser: true });
    expect(approved['status']).toBe('approved');

    // approval freezes: further decisions are rejected (§40.3)
    const afterApproval = await toolError('update_impact_decision', {
      analysisId,
      requirementId,
      nodeId: 'any',
      decision: 'rejected',
    });
    expect(afterApproval.length).toBeGreaterThan(0);
  });

  it('step 10: export_implementation_context returns the §22 document', async () => {
    const exported = await tool('export_implementation_context', {});
    const context = asRecord(exported['context']);
    const required = context['requiredImpacts'] as { name: string }[];
    expect(required.map((impact) => impact.name)).toContain('DealService');
    expect((context['reviewCriteria'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('steps 11–13: implement, review, report — matched with no discrepancies', async () => {
    appendFileSync(
      join(repoDir, 'src/services/deal-service.ts'),
      '\nexport const filterExpired = true;\n',
    );
    const review = await tool('review_implementation', { target: 'working-tree' });
    expect(review['discrepanciesFound']).toBe(false);
    const findings = review['findings'] as { category: string; nodeName: string }[];
    expect(findings.some((f) => f.category === 'matched' && f.nodeName === 'DealService')).toBe(
      true,
    );

    const report = await tool('get_review_report', {});
    expect(report['command']).toBe('review');
  });

  it('accept_review_deviation appends a §24.1 decision; the stored report shows the mark', async () => {
    writeFileSync(join(repoDir, 'src/rogue.ts'), 'export const rogue = 1;\n');
    await expectDeviationFlow(tool, toolError);
  });

  it('select_architectural_option fails typed when the option does not exist (§26)', async () => {
    // this deterministic analysis carries no §C8 options — selection must be a typed error
    const message = await toolError('select_architectural_option', {
      analysisId,
      optionId: 'option:ghost',
      confirmedByUser: true,
    });
    expect(message).toContain('not found');
    // the contract itself requires the human-confirmation assertion (§35)
    const unconfirmed = await toolError('select_architectural_option', {
      analysisId,
      optionId: 'option:ghost',
    });
    expect(unconfirmed).toContain('invalid input');
  });

  it('query/explain tools mirror the evidence panel (§18.5, §3)', async () => {
    await expectQueryAndExplain(tool);
  });

  it('apply → rollback → restore_configuration_version round-trips a §Z9 exclusion (§Z14)', async () => {
    const applied = await tool('apply_configuration_change', {
      operation: {
        kind: 'add-exclusion',
        component: 'SharedTypes',
        reason: 'shared type does not imply ownership',
      },
      approvedByUser: true,
    });
    const rollbackId = applied['rollbackId'] as string;
    expect(applied['file']).toBe('aliases.yml');

    await tool('rollback_configuration_change', { rollbackId, confirmedByUser: true });

    const restored = await tool('restore_configuration_version', {
      rollbackId,
      confirmedByUser: true,
    });
    expect(restored['restoredFile']).toBe('aliases.yml');

    const history = await tool('get_configuration_history', {});
    // apply + rollback + restore — three appended entries, nothing rewritten
    expect((history['entries'] as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it('§Z7 read-only tools project the structure and the committed configuration', async () => {
    await expectStructureAndConfigReads(tool);
  });

  it('test_detection_rule dry-runs a §Z8 rule — nothing is persisted', async () => {
    await expectRuleDryRun(tool, toolError);
  });

  it('confirm_configuration_value protects a value from remove_stale_configuration (§Z5)', async () => {
    await expectConfirmationProtectsFromRemoval(tool, toolError);
  });

  it('refresh_configuration re-applies detection and reports the change delta', async () => {
    const refreshed = await tool('refresh_configuration');
    const applied = refreshed['applied'] as { kind: string }[];
    expect(applied.some((item) => item.kind === 'uncovered-package')).toBe(true);
    expect(refreshed['changedFiles']).toEqual(['architecture.yml']);
    expect(refreshed['changeCountBefore']).toEqual(expect.any(Number));

    // nothing left to apply on the second pass — and the report says so
    const again = await tool('refresh_configuration');
    expect(again['applied']).toEqual([]);
    expect(again['changedFiles']).toEqual([]);
  });

  it('apply_component_correction overlays §16 corrections without touching the graph', async () => {
    await expectCorrectionOverlay(tool, toolError);
  });

  it('set-component-owner surfaces ownership with its §Z5 level and refuses an empty glob', async () => {
    await expectOwnershipOverlay(tool, toolError);
  });

  it('export_graph_html writes one self-contained, source-free local HTML file (§18.6)', async () => {
    await expectGraphHtmlExport(tool, toolError);
  });

  it('unknown nodes and invalid inputs produce typed errors, never crashes', async () => {
    expect(await toolError('explain_node', { nodeId: 'ghost' })).toContain('not found');
    expect(await toolError('find_components', {})).toContain('invalid input');
  });
});
