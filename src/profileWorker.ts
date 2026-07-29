import { parentPort, workerData } from 'node:worker_threads';
import { loadFullProfiles } from './dataReader';
import { FullProfileOptions } from './types';

type WorkerProfileOptions = Omit<FullProfileOptions, 'isCancelled' | 'onProgress'>;

async function run(): Promise<void> {
  if (!parentPort) throw new Error('Full-data profiling requires a worker parent port.');
  const options = workerData as WorkerProfileOptions & { filePath: string };
  const result = await loadFullProfiles(options.filePath, {
    ...options,
    onProgress: (processedRows, totalRows) => {
      parentPort?.postMessage({ type: 'progress', processedRows, totalRows });
    }
  });
  parentPort.postMessage({ type: 'result', payload: result });
}

void run().catch((error: unknown) => {
  parentPort?.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256)
  });
});
