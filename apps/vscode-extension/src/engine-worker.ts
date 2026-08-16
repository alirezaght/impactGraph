import {
  applicationsForGraph,
  buildAnalyzeOutput,
  contextsForGraph,
  buildAnalysisForSpecification,
  buildExportBundle,
  buildExportOutput,
  buildReviewOutput,
  createWorkspaceAiServices,
  failWith,
  runReviewPipeline,
  submitSpecification,
} from '@impactgraph/workspace-engine';

import { runWebviewJob } from './engine/spec-jobs.js';

import type { EngineJobRequest, EngineJobResponse } from './engine/protocol.js';
import type { Failable } from '@impactgraph/workspace-engine';

// Story 7.2 applied to the analysis engines: analyze/review/export run in this bundled child
// process — never in the extension host (PRD §32/§33). One job per process; the parent kills
// the child to cancel (index writes are transactional, so a kill never corrupts state).

type AnalyzeJob = Extract<EngineJobRequest, { op: 'analyze' }>;

const runAnalyzeJob = async (request: AnalyzeJob): Promise<Failable<unknown>> => {
  const ai = createWorkspaceAiServices(request.rootDir, { apiKey: request.apiKey });
  if (!ai.ok) {
    return ai;
  }
  const submitted = await submitSpecification({
    rootDir: request.rootDir,
    specName: request.specName,
    rawText: request.rawText,
    extractor: ai.value.extractor,
  });
  if (!submitted.ok) {
    return submitted;
  }
  const built = await buildAnalysisForSpecification(
    request.rootDir,
    submitted.value.specification,
    { classifier: ai.value.classifier, interpreter: ai.value.interpreter },
  );
  if (!built.ok) {
    return built;
  }
  return {
    ok: true,
    value: buildAnalyzeOutput({
      specification: submitted.value.specification,
      analysis: built.value.analysis,
      graph: built.value.graph,
      evidenceFileById: built.value.evidenceFileById,
      extractionMode: submitted.value.extractionMode,
      contextByNodeId: contextsForGraph(request.rootDir, built.value.graph),
      applicationByNodeId: applicationsForGraph(built.value.graph),
    }),
  };
};

const runJob = async (request: EngineJobRequest): Promise<Failable<unknown>> => {
  const webviewJob = await runWebviewJob(request);
  if (webviewJob !== undefined) {
    return webviewJob;
  }
  if (request.op === 'analyze') {
    return runAnalyzeJob(request);
  }
  if (request.op === 'review') {
    const bundle = await runReviewPipeline(request.rootDir, request.target);
    if (!bundle.ok) {
      return bundle;
    }
    return {
      ok: true,
      value: buildReviewOutput(
        bundle.value.review,
        bundle.value.analysis,
        bundle.value.violations,
        {
          breakdownContext: bundle.value.breakdownContext,
          planContract: bundle.value.planContract,
        },
      ),
    };
  }
  if (request.op !== 'export') {
    return failWith('internalError', `unsupported engine job: ${request.op}`);
  }
  const bundle = await buildExportBundle(request.rootDir, request.analysisId);
  if (!bundle.ok) {
    return bundle;
  }
  return { ok: true, value: buildExportOutput(bundle.value.context) };
};

process.on('message', (message: unknown) => {
  const request = message as EngineJobRequest;
  void runJob(request)
    .then((result) => {
      const response: EngineJobResponse = result.ok
        ? { id: request.id, ok: true, value: result.value }
        : { id: request.id, ok: false, error: result.error };
      process.send?.(response);
    })
    .catch((error: unknown) => {
      const response: EngineJobResponse = {
        id: request.id,
        ok: false,
        error: {
          category: 'internalError',
          message: error instanceof Error ? error.message : String(error),
        },
      };
      process.send?.(response);
    });
});
