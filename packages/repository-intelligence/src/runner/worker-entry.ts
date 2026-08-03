// Executable index-worker entry for fork() (Story 2.6). The bundleable logic lives in
// worker-main.ts so other hosts (the VS Code extension) can create their own entry file.
import { runIndexWorker } from './worker-main.js';

runIndexWorker();
