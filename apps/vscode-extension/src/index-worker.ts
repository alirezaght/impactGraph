// Bundled index-worker entry (Story 7.2): forked by the extension so indexing never runs in
// the extension host (PRD §32/§33).
import { runIndexWorker } from '@impactgraph/repository-intelligence';

runIndexWorker();
