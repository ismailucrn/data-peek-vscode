import yauzl, { Entry } from 'yauzl';

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_COMPRESSION_RATIO = 1_000;
const COMPRESSION_RATIO_CHECK_MINIMUM_BYTES = 10 * 1024 * 1024;

/**
 * Reads only ZIP central-directory metadata before ExcelJS expands the XLSX.
 * This keeps a small, highly-compressed workbook from exhausting extension-host memory.
 */
export function validateExcelArchive(
  filePath: string,
  maxExpandedBytes: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          reject(new Error(`Invalid Excel archive: ${openError?.message ?? 'could not open ZIP'}`));
          return;
        }

        let entryCount = 0;
        let expandedBytes = 0;
        let settled = false;

        const fail = (error: Error): void => {
          if (settled) return;
          settled = true;
          zipFile.close();
          reject(error);
        };

        zipFile.on('error', (error) => fail(error));
        zipFile.on('entry', (entry) => {
          try {
            entryCount += 1;
            validateEntry(entry, entryCount, expandedBytes, maxExpandedBytes);
            expandedBytes += entry.uncompressedSize;
            zipFile.readEntry();
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
        zipFile.on('end', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        zipFile.readEntry();
      }
    );
  });
}

function validateEntry(
  entry: Entry,
  entryCount: number,
  expandedBytesBeforeEntry: number,
  maxExpandedBytes: number
): void {
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw unsafeWorkbook('too many archive entries');
  }
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw unsafeWorkbook('encrypted ZIP entries are not supported');
  }
  if (entry.uncompressedSize > maxExpandedBytes) {
    throw unsafeWorkbook('a single archive entry is too large');
  }
  if (expandedBytesBeforeEntry + entry.uncompressedSize > maxExpandedBytes) {
    throw unsafeWorkbook('expanded workbook size exceeds the configured safety limit');
  }
  if (
    entry.uncompressedSize >= COMPRESSION_RATIO_CHECK_MINIMUM_BYTES &&
    entry.compressedSize > 0 &&
    entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO
  ) {
    throw unsafeWorkbook('suspicious compression ratio');
  }
}

function unsafeWorkbook(reason: string): Error {
  return new Error(`Workbook rejected for safety: ${reason}.`);
}
