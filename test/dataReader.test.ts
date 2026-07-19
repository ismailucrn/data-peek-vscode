import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { loadPreview } from '../src/dataReader';
import { validateExcelArchive } from '../src/excelArchive';
import { buildProfiles, normalizeCell } from '../src/profile';

const options = {
  limit: 100,
  maxExcelFileSizeMB: 20,
  maxExcelExpandedSizeMB: 50,
  maxColumns: 500
};

test('normalizes values and builds numeric profiles', () => {
  assert.equal(normalizeCell(12n), 12);
  assert.equal(normalizeCell(9_007_199_254_740_993n), '9007199254740993');
  assert.match(normalizeCell('x'.repeat(100_001)) as string, /\[truncated\]$/);
  const [profile] = buildProfiles(['score'], [[1], ['2'], [null], [4]]);
  assert.equal(profile.type, 'number');
  assert.equal(profile.missing, 1);
  assert.equal(profile.mean, 7 / 3);
});

test('caps wide CSV previews and reports the source column count', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'wide.csv');
    const header = Array.from({ length: 12 }, (_unused, index) => `c${index}`).join(',');
    const row = Array.from({ length: 12 }, (_unused, index) => String(index)).join(',');
    await fs.writeFile(filePath, `${header}\n${row}\n`, 'utf8');

    const preview = await loadPreview(filePath, { ...options, maxColumns: 10 });
    assert.equal(preview.columns.length, 10);
    assert.equal(preview.totalColumns, 12);
    assert.equal(preview.truncatedColumns, true);
    assert.equal(preview.truncation.columns, true);
    assert.equal(
      preview.qualityWarnings.some((warning) => warning.code === 'truncatedColumns'),
      true
    );
    assert.equal(preview.rows[0].length, 10);
  });
});

test('reads a quoted CSV preview and reports truncation', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'people.csv');
    const records = Array.from(
      { length: 105 },
      (_unused, index) => `"Person, ${index}",${index},${index % 2 === 0}`
    );
    await fs.writeFile(filePath, `name,score,active\n${records.join('\n')}\n`, 'utf8');

    const preview = await loadPreview(filePath, options);
    assert.deepEqual(preview.columns, ['name', 'score', 'active']);
    assert.equal(preview.rows.length, 100);
    assert.equal(preview.rows[0][0], 'Person, 0');
    assert.equal(preview.truncated, true);
    assert.equal(preview.truncation.rows, true);
    assert.equal(preview.totalRows, null);
    assert.equal(preview.profiles[1].type, 'number');
  });
});

test('reports cells shortened by the normalization safety limit', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'long-cell.csv');
    await fs.writeFile(filePath, `value\n${'x'.repeat(100_001)}\n`, 'utf8');

    const preview = await loadPreview(filePath, options);
    assert.equal((preview.rows[0][0] as string).length, 100_000);
    assert.equal(preview.truncation.cells, 1);
    assert.equal(
      preview.qualityWarnings.some(
        (warning) => warning.code === 'truncatedCells' && warning.count === 1
      ),
      true
    );
    assert.equal(preview.profileScope, 'preview');
  });
});

test('reads worksheets from an Excel workbook', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'workbook.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('People').addRows([
      ['name', 'age'],
      ['Ada', 36],
      ['Grace', 85]
    ]);
    workbook.addWorksheet('Scores').addRows([
      ['team', 'score'],
      ['Blue', 10]
    ]);
    await workbook.xlsx.writeFile(filePath);

    await assert.rejects(
      validateExcelArchive(filePath, 1024),
      /Workbook rejected for safety/
    );

    const preview = await loadPreview(filePath, { ...options, sheet: 'Scores' });
    assert.equal(preview.sheet, 'Scores');
    assert.deepEqual(preview.sheets, ['People', 'Scores']);
    assert.deepEqual(preview.columns, ['team', 'score']);
    assert.deepEqual(preview.rows, [['Blue', 10]]);
  });
});

test('reads a generated Parquet file', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'events.parquet');
    const { parquetWriteFile } = await import('hyparquet-writer');
    await parquetWriteFile({
      filename: filePath,
      columnData: [
        { name: 'event', data: ['open', 'click', 'close'], type: 'STRING' },
        { name: 'duration', data: [1.5, 2.25, 3.75], type: 'DOUBLE' }
      ]
    });

    const preview = await loadPreview(filePath, options);
    assert.equal(preview.format, 'PARQUET');
    assert.equal(preview.totalRows, 3);
    assert.deepEqual(preview.columns, ['event', 'duration']);
    assert.deepEqual(preview.rows[1], ['click', 2.25]);
  });
});

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'data-peek-'));
  try {
    await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
