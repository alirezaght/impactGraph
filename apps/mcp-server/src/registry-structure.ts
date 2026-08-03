import {
  explainConfiguration,
  readConfigurationDocuments,
  summarizeRepositoryStructure,
  testDetectionRule,
  validateConfiguration,
} from '@impactgraph/workspace-engine';

import type { ToolHandler } from './handler-types.js';

// Read-only structure/configuration inspection tools (§Z7). None of these writes anything:
// they project the current deterministic graph or read the committed documents. Outputs are
// validated against the contract by callTool before they leave the server (ADR-0009).

const repositoryStructure: ToolHandler<'detect_repository_structure'> = async (rootDir) => {
  const structure = await summarizeRepositoryStructure(rootDir);
  if (!structure.ok) {
    return structure;
  }
  return {
    ok: true,
    value: {
      snapshotId: structure.value.snapshotId,
      workspaces: [...structure.value.workspaces],
      packages: structure.value.packages.map((entry) => ({
        nodeId: entry.nodeId,
        name: entry.name,
        directory: entry.directory,
        ...(entry.manifestPath === undefined ? {} : { manifestPath: entry.manifestPath }),
        sourceRoots: [...entry.sourceRoots],
        testRoots: [...entry.testRoots],
        buildConfigFiles: [...entry.buildConfigFiles],
        entryPoints: [...entry.entryPoints],
        fileCount: entry.fileCount,
      })),
      totals: { ...structure.value.totals },
    },
  };
};

const configuration: ToolHandler<'get_configuration'> = (rootDir) => {
  const documents = readConfigurationDocuments(rootDir);
  if (!documents.ok) {
    return Promise.resolve(documents);
  }
  return Promise.resolve({
    ok: true,
    value: {
      config: documents.value.workspace,
      architecture: documents.value.architecture,
      aliases: documents.value.aliases,
      rules: documents.value.rules,
    },
  });
};

const validation: ToolHandler<'validate_configuration'> = (rootDir) => {
  const report = validateConfiguration(rootDir);
  if (!report.ok) {
    return Promise.resolve(report);
  }
  return Promise.resolve({
    ok: true,
    value: {
      valid: report.value.valid,
      files: report.value.files.map((file) => ({
        file: file.file,
        present: file.present,
        valid: file.valid,
        messages: [...file.messages],
      })),
      crossFileMessages: [...report.value.crossFileMessages],
    },
  });
};

const explanation: ToolHandler<'explain_configuration'> = async (rootDir, input) => {
  const explained = await explainConfiguration(rootDir, input.subject, input.subjectKind);
  if (!explained.ok) {
    return explained;
  }
  const value = explained.value;
  return {
    ok: true,
    value: {
      subject: value.subject,
      found: value.found,
      ...(value.subjectKind === undefined ? {} : { subjectKind: value.subjectKind }),
      ...(value.file === undefined ? {} : { file: value.file }),
      description: value.description,
      ...(value.definition === undefined ? {} : { definition: value.definition }),
      confirmed: value.confirmed,
      ...(value.origin === undefined ? {} : { origin: value.origin }),
      auditTrail: [...value.auditTrail],
      affects: {
        nodeCount: value.affects.nodeCount,
        sampleNodeIds: [...value.affects.sampleNodeIds],
        detail: value.affects.detail,
      },
    },
  };
};

const ruleDryRun: ToolHandler<'test_detection_rule'> = async (rootDir, input) => {
  const tested = await testDetectionRule(rootDir, {
    rule: input.rule,
    snippet: input.snippet,
    path: input.path,
    fileName: input.fileName,
  });
  if (!tested.ok) {
    return tested;
  }
  return {
    ok: true,
    value: {
      ...tested.value,
      wouldEmitNodes: [...tested.value.wouldEmitNodes],
      wouldEmitEdges: [...tested.value.wouldEmitEdges],
      warnings: [...tested.value.warnings],
    },
  };
};

export const STRUCTURE_HANDLERS = {
  detect_repository_structure: repositoryStructure,
  get_configuration: configuration,
  validate_configuration: validation,
  explain_configuration: explanation,
  test_detection_rule: ruleDryRun,
} as const;
