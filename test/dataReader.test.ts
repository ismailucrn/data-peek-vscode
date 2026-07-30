import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { loadFullProfiles, loadPreview } from '../src/dataReader';
import { validateExcelArchive } from '../src/excelArchive';
import { defaultDelimitedParsingSettings } from '../src/parsing';
import { buildProfiles, normalizeCell } from '../src/profile';

const options = {
  limit: 100,
  maxExcelFileSizeMB: 20,
  maxExcelExpandedSizeMB: 50,
  maxColumns: 500,
  maxProfileScanSizeMB: 1024
};

test('normalizes values and builds numeric profiles', () => {
  assert.equal(normalizeCell(12n), 12);
  assert.equal(normalizeCell(9_007_199_254_740_993n), '9007199254740993');
  assert.equal(normalizeCell(new Date(Number.NaN)), 'Invalid Date');
  assert.equal(normalizeCell(Symbol('value')), 'Symbol(value)');
  assert.equal(
    normalizeCell({
      toJSON: () => {
        throw new Error('no JSON');
      },
      [Symbol.toPrimitive]: () => {
        throw new Error('no string');
      }
    }),
    '[unrepresentable value]'
  );
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
    assert.equal(preview.rows[0].length, 10);
  });
});

test('preserves the 250,000-cell budget at configured row and column limits', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'cell-budget.csv');
    const header = Array.from({ length: 500 }, (_unused, index) => `c${index}`).join(',');
    const row = Array.from({ length: 500 }, (_unused, index) => String(index)).join(',');
    await fs.writeFile(
      filePath,
      `${header}\n${Array.from({ length: 600 }, () => row).join('\n')}\n`,
      'utf8'
    );

    const preview = await loadPreview(filePath, { ...options, limit: 5_000, maxColumns: 500 });
    assert.equal(preview.columns.length, 500);
    assert.equal(preview.rows.length, 500);
    assert.equal(preview.rows.length * preview.columns.length, 250_000);
    assert.equal(preview.truncation.rows, true);
  });
});

test('reapplies the cell budget when a later delimited row widens the preview', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'late-wide.csv');
    const narrowRows = Array.from({ length: 600 }, (_, index) => String(index));
    const wideRow = Array.from({ length: 500 }, (_, index) => String(index)).join(',');
    await fs.writeFile(filePath, `first\n${narrowRows.join('\n')}\n${wideRow}\n`, 'utf8');

    const preview = await loadPreview(filePath, { ...options, limit: 5_000, maxColumns: 500 });
    assert.equal(preview.columns.length, 500);
    assert.equal(preview.rows.length, 500);
    assert.equal(preview.rows.length * preview.columns.length, 250_000);
    assert.equal(preview.truncation.rows, true);
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
    assert.equal(preview.profileScope, 'preview');
    assert.equal(preview.profiledRowCount, 100);
  });
});

test('profiles every CSV row after returning a bounded preview', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'classes.csv');
    const records = Array.from(
      { length: 750 },
      (_unused, index) => `${index},${index < 500 ? 'early' : 'late'}`
    );
    await fs.writeFile(filePath, `id,class\n${records.join('\n')}\n`, 'utf8');

    const preview = await loadPreview(filePath, options);
    assert.equal(preview.rows.length, 100);
    assert.equal(preview.profiles[1].distinct, 1);

    const full = await loadFullProfiles(filePath, {
      ...options,
      columns: preview.columns,
      parsing: preview.parsing?.applied
    });
    assert.equal(full.rowCount, 750);
    assert.equal(full.profiles[1].distinct, 2);
    assert.deepEqual(full.profiles[1].topValues, [
      { value: 'early', count: 500 },
      { value: 'late', count: 250 }
    ]);
  });
});

test('applies delimiter, header, skipped-row, null and locale-number settings', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'localized.csv');
    await fs.writeFile(
      filePath,
      'Generated report\nname;amount;note\nAda;1.234,50;NA\nGrace;25,75;ok\n',
      'utf8'
    );
    const parsing = {
      ...defaultDelimitedParsingSettings(),
      delimiter: 'semicolon' as const,
      skipRows: 1,
      nullTokens: ['NA'],
      decimalSeparator: 'comma' as const,
      thousandsSeparator: 'dot' as const
    };

    const preview = await loadPreview(filePath, { ...options, parsing });
    assert.deepEqual(preview.columns, ['name', 'amount', 'note']);
    assert.deepEqual(preview.rows, [
      ['Ada', 1234.5, null],
      ['Grace', 25.75, 'ok']
    ]);
    assert.equal(preview.parsing?.detectedDelimiter, ';');
    assert.equal(preview.parsing?.resolvedDelimiter, ';');
    assert.deepEqual(preview.parsing?.applied, parsing);
  });
});

test('reads headerless custom-delimited data with generated column names', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'headerless.csv');
    await fs.writeFile(filePath, 'Ada|36\nGrace|85\n', 'utf8');
    const preview = await loadPreview(filePath, {
      ...options,
      parsing: {
        ...defaultDelimitedParsingSettings(),
        delimiter: 'custom',
        customDelimiter: '|',
        header: 'none'
      }
    });
    assert.deepEqual(preview.columns, ['column_1', 'column_2']);
    assert.deepEqual(preview.rows, [
      ['Ada', '36'],
      ['Grace', '85']
    ]);
  });
});

test('applies custom quote and escape characters', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'quoted.csv');
    await fs.writeFile(filePath, "name;note\nAda;'can\\'t stop'\n", 'utf8');
    const preview = await loadPreview(filePath, {
      ...options,
      parsing: {
        ...defaultDelimitedParsingSettings(),
        delimiter: 'semicolon',
        quote: "'",
        escape: '\\'
      }
    });
    assert.deepEqual(preview.rows, [['Ada', "can't stop"]]);
  });
});

test('decodes UTF-16LE and Latin-1 delimited files', async () => {
  await withTemporaryDirectory(async (directory) => {
    const utf16Path = path.join(directory, 'utf16.csv');
    await fs.writeFile(
      utf16Path,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('name;city\nAda;İstanbul\n', 'utf16le')])
    );
    const utf16 = await loadPreview(utf16Path, {
      ...options,
      parsing: { ...defaultDelimitedParsingSettings(), encoding: 'utf16le' }
    });
    assert.equal(utf16.parsing?.detectedDelimiter, ';');
    assert.deepEqual(utf16.rows, [['Ada', 'İstanbul']]);

    const latin1Path = path.join(directory, 'latin1.csv');
    await fs.writeFile(latin1Path, Buffer.from('name;city\nAndré;Zürich\n', 'latin1'));
    const latin1 = await loadPreview(latin1Path, {
      ...options,
      parsing: { ...defaultDelimitedParsingSettings(), encoding: 'latin1' }
    });
    assert.deepEqual(latin1.rows, [['André', 'Zürich']]);
  });
});

test('rejects invalid parsing settings inside the reader boundary', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'invalid.csv');
    await fs.writeFile(filePath, 'name\nAda\n', 'utf8');
    await assert.rejects(
      loadPreview(filePath, {
        ...options,
        parsing: { ...defaultDelimitedParsingSettings(), skipRows: -1 }
      }),
      /Invalid parsing settings: Rows to skip/
    );
  });
});

test('stops preview work when the editor load is cancelled', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'cancelled.csv');
    await fs.writeFile(filePath, 'name\nAda\n', 'utf8');
    await assert.rejects(
      loadPreview(filePath, { ...options, isCancelled: () => true }),
      /Preview loading was cancelled/
    );
    await assert.rejects(
      loadFullProfiles(filePath, {
        ...options,
        columns: ['name'],
        isCancelled: () => true
      }),
      /Preview loading was cancelled/
    );
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
        (warning) => warning.code === 'constant'
      ),
      true
    );
    assert.equal(preview.profileScope, 'full');
    assert.equal(preview.profiledRowCount, 1);
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
    const full = await loadFullProfiles(filePath, {
      ...options,
      columns: preview.columns,
      sheet: 'Scores'
    });
    assert.equal(full.rowCount, 1);
    assert.equal(full.profiles[1].mean, 10);
  });
});

test('reads sparse Excel rows without losing the true column extent', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'sparse.xlsx');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sparse');
    worksheet.getCell('A1').value = 'name';
    worksheet.getCell('A10000').value = 'late row';
    worksheet.getCell('Z10001').value = 'outside preview columns';
    await workbook.xlsx.writeFile(filePath);

    const preview = await loadPreview(filePath, { ...options, maxColumns: 10 });
    assert.equal(preview.totalColumns, 26);
    assert.equal(preview.truncatedColumns, true);
    assert.deepEqual(preview.rows, [['late row', ...Array.from({ length: 9 }, () => null)]]);
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
    const full = await loadFullProfiles(filePath, {
      ...options,
      columns: preview.columns
    });
    assert.equal(full.rowCount, 3);
    assert.equal(full.profiles[0].distinct, 3);
    assert.equal(full.profiles[1].mean, 2.5);
  });
});

test('profiles Parquet values beyond the bounded preview', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'skewed.parquet');
    const { parquetWriteFile } = await import('hyparquet-writer');
    await parquetWriteFile({
      filename: filePath,
      columnData: [
        {
          name: 'class',
          data: Array.from({ length: 150 }, (_unused, index) => index < 100 ? 'early' : 'late'),
          type: 'STRING'
        },
        {
          name: 'value',
          data: Array.from({ length: 150 }, (_unused, index) => index),
          type: 'INT32'
        }
      ]
    });

    const preview = await loadPreview(filePath, options);
    assert.equal(preview.rows.length, 100);
    assert.equal(preview.profiles[0].distinct, 1);
    assert.deepEqual(preview.qualityWarnings, []);

    const full = await loadFullProfiles(filePath, {
      ...options,
      columns: preview.columns
    });
    assert.equal(full.rowCount, 150);
    assert.equal(full.profiles[0].distinct, 2);
    assert.deepEqual(full.profiles[0].topValues, [
      { value: 'early', count: 100 },
      { value: 'late', count: 50 }
    ]);
    assert.equal(full.profiles[1].max, 149);
    assert.equal(
      full.qualityWarnings.some(
        (warning) => warning.code === 'possibleIdentifier' && warning.columnIndex === 1
      ),
      true
    );
  });
});

test('rejects full profiling beyond the configured scan boundary', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'oversized.csv');
    await fs.writeFile(filePath, 'value\n', 'utf8');
    await fs.truncate(filePath, 65 * 1024 * 1024);
    await assert.rejects(
      loadFullProfiles(filePath, {
        ...options,
        maxProfileScanSizeMB: 64,
        columns: ['value']
      }),
      /Full-data profiling is limited to 64.0 MB/
    );
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
