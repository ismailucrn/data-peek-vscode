import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { FullProfileResult } from '../src/types';

test('runs full-data profiling outside the extension host thread', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'data-peek-worker-'));
  try {
    const filePath = path.join(directory, 'classes.csv');
    await fs.writeFile(
      filePath,
      `class,value\n${Array.from(
        { length: 150 },
        (_unused, index) => `${index < 100 ? 'early' : 'late'},${index}`
      ).join('\n')}\n`,
      'utf8'
    );
    const messages: unknown[] = [];
    const result = await new Promise<FullProfileResult>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, '../src/profileWorker.js'), {
        workerData: {
          filePath,
          limit: 100,
          maxExcelFileSizeMB: 20,
          maxExcelExpandedSizeMB: 50,
          maxProfileScanSizeMB: 64,
          maxColumns: 500,
          columns: ['class', 'value']
        }
      });
      worker.on('message', (message: unknown) => {
        messages.push(message);
        if (
          message &&
          typeof message === 'object' &&
          (message as { type?: unknown }).type === 'result'
        ) {
          resolve((message as { payload: FullProfileResult }).payload);
        }
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Profile worker exited with code ${code}.`));
      });
    });
    assert.equal(result.rowCount, 150);
    assert.equal(result.profiles[0].distinct, 2);
    assert.equal(
      messages.some(
        (message) =>
          message !== null &&
          typeof message === 'object' &&
          (message as { type?: unknown }).type === 'progress'
      ),
      true
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
