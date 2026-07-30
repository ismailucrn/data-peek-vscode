import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { copyCellText, copyRowAsTsv } from './clipboard';
import { isSupportedFile, loadPreview } from './dataReader';
import { isWebviewMessage } from './messages';
import { validateDelimitedParsingSettings } from './parsing';
import {
  DatasetPreview,
  DelimitedParsingSettings,
  FullProfileResult,
  WebviewToHostMessage
} from './types';

class DataDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose(): void {}
}

export class DataPeekEditorProvider implements vscode.CustomReadonlyEditorProvider<DataDocument> {
  static readonly viewType = 'dataPeek.preview';

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): DataDocument {
    if (uri.scheme !== 'file' || !isSupportedFile(uri.fsPath)) {
      throw new Error('Data Peek only opens supported local data files.');
    }
    return new DataDocument(uri);
  }

  async resolveCustomEditor(
    document: DataDocument,
    webviewPanel: vscode.WebviewPanel,
    cancellationToken: vscode.CancellationToken
  ): Promise<void> {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot, distRoot]
    };

    let selectedSheet: string | undefined;
    let availableSheets = new Set<string>();
    let loading = false;
    let queued = false;
    let disposed = false;
    let readyReceived = false;
    let latestPreview: DatasetPreview | undefined;
    let parsingSettings: DelimitedParsingSettings | undefined;
    let profileGeneration = 0;
    let profileWorker: Worker | undefined;

    const stopProfileWorker = (): void => {
      const worker = profileWorker;
      profileWorker = undefined;
      if (worker) void worker.terminate();
    };

    const startFullProfile = (
      preview: DatasetPreview,
      generation: number,
      configuration: vscode.WorkspaceConfiguration
    ): void => {
      if (preview.profileScope === 'full' || preview.columns.length === 0) return;
      stopProfileWorker();
      void webviewPanel.webview.postMessage({
        type: 'profileProgress',
        processedRows: 0,
        totalRows: preview.totalRows
      });
      const worker = new Worker(
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'profileWorker.js').fsPath,
        {
          workerData: {
            filePath: document.uri.fsPath,
            limit: configuration.get<number>('previewRows', 2000),
            maxExcelFileSizeMB: configuration.get<number>('maxExcelFileSizeMB', 100),
            maxExcelExpandedSizeMB: configuration.get<number>('maxExcelExpandedSizeMB', 250),
            maxProfileScanSizeMB: configuration.get<number>('maxProfileScanSizeMB', 1024),
            maxColumns: configuration.get<number>('maxColumns', 500),
            columns: preview.columns,
            sheet: preview.sheet,
            parsing: preview.parsing?.applied ?? parsingSettings
          }
        }
      );
      profileWorker = worker;
      let settled = false;
      worker.on('message', (message: unknown) => {
        if (
          settled ||
          disposed ||
          cancellationToken.isCancellationRequested ||
          generation !== profileGeneration ||
          !isProfileWorkerMessage(message)
        ) return;
        if (message.type === 'progress') {
          void webviewPanel.webview.postMessage({
            type: 'profileProgress',
            processedRows: message.processedRows,
            totalRows: message.totalRows
          });
          return;
        }
        settled = true;
        if (message.type === 'result') {
          latestPreview = {
            ...preview,
            profiles: message.payload.profiles,
            profileScope: 'full',
            profiledRowCount: message.payload.rowCount
          };
          void webviewPanel.webview.postMessage({ type: 'profiles', payload: message.payload });
        } else {
          void webviewPanel.webview.postMessage({
            type: 'profileError',
            message: message.message
          });
        }
      });
      worker.on('error', (error) => {
        if (
          settled ||
          disposed ||
          cancellationToken.isCancellationRequested ||
          generation !== profileGeneration
        ) return;
        settled = true;
        void webviewPanel.webview.postMessage({
          type: 'profileError',
          message: (error instanceof Error ? error.message : String(error)).slice(0, 256)
        });
      });
      worker.on('exit', (code) => {
        if (profileWorker === worker) profileWorker = undefined;
        if (
          settled ||
          code === 0 ||
          disposed ||
          cancellationToken.isCancellationRequested ||
          generation !== profileGeneration
        ) return;
        settled = true;
        void webviewPanel.webview.postMessage({
          type: 'profileError',
          message: `Full-data profiling stopped unexpectedly (worker exit ${code}).`
        });
      });
    };

    const refresh = async (operation?: 'parsing'): Promise<boolean> => {
      if (disposed || cancellationToken.isCancellationRequested) return false;
      if (loading) {
        if (operation) {
          await postOperationResult(
            webviewPanel.webview,
            'parsing',
            false,
            'Wait for the current preview load to finish.'
          );
          return false;
        }
        queued = true;
        return false;
      }
      loading = true;
      stopProfileWorker();
      const generation = ++profileGeneration;
      if (!operation) void webviewPanel.webview.postMessage({ type: 'loading' });
      let succeeded = false;
      try {
        const configuration = vscode.workspace.getConfiguration('dataPeek');
        const preview = await loadPreview(document.uri.fsPath, {
          limit: configuration.get<number>('previewRows', 2000),
          maxExcelFileSizeMB: configuration.get<number>('maxExcelFileSizeMB', 100),
          maxExcelExpandedSizeMB: configuration.get<number>('maxExcelExpandedSizeMB', 250),
          maxColumns: configuration.get<number>('maxColumns', 500),
          sheet: selectedSheet,
          parsing: parsingSettings,
          isCancelled: () => disposed || cancellationToken.isCancellationRequested
        });
        if (disposed || cancellationToken.isCancellationRequested) return false;
        selectedSheet = preview.sheet;
        availableSheets = new Set(preview.sheets ?? []);
        latestPreview = preview;
        await webviewPanel.webview.postMessage({ type: 'dataset', payload: preview });
        startFullProfile(preview, generation, configuration);
        if (operation) {
          await postOperationResult(
            webviewPanel.webview,
            'parsing',
            true,
            'Parsing settings applied to the preview.'
          );
        }
        succeeded = true;
      } catch (error) {
        if (disposed || cancellationToken.isCancellationRequested) return false;
        const message = error instanceof Error ? error.message : String(error);
        if (operation && latestPreview) {
          await postOperationResult(webviewPanel.webview, 'parsing', false, message);
        } else {
          await webviewPanel.webview.postMessage({ type: 'error', message });
        }
      } finally {
        loading = false;
        if (queued && !disposed && !cancellationToken.isCancellationRequested) {
          queued = false;
          void refresh();
        }
      }
      return succeeded;
    };

    const updateParsing = async (settings: unknown): Promise<void> => {
      if (!latestPreview || (latestPreview.format !== 'CSV' && latestPreview.format !== 'TSV')) {
        await postOperationResult(
          webviewPanel.webview,
          'parsing',
          false,
          'Parsing settings are available only for CSV and TSV previews.'
        );
        return;
      }
      const previous = parsingSettings;
      if (settings === null) {
        parsingSettings = undefined;
      } else {
        const validation = validateDelimitedParsingSettings(settings);
        if (!validation.value) {
          await postOperationResult(
            webviewPanel.webview,
            'parsing',
            false,
            validation.error ?? 'Invalid parsing settings.'
          );
          return;
        }
        parsingSettings = validation.value;
      }
      if (!(await refresh('parsing'))) parsingSettings = previous;
    };

    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (!isWebviewMessage(message)) return;
        if (message.type === 'ready' && !readyReceived) {
          readyReceived = true;
          void refresh();
        } else if (message.type === 'reload') {
          void refresh();
        } else if (message.type === 'updateParsing') {
          void updateParsing(message.settings);
        } else if (
          message.type === 'selectSheet' &&
          typeof message.sheet === 'string' &&
          message.sheet.length <= 128 &&
          availableSheets.has(message.sheet)
        ) {
          selectedSheet = message.sheet;
          void refresh();
        } else if (message.type === 'copy') {
          void copyFromPreview(message, latestPreview, webviewPanel.webview);
        }
      }
    );
    webviewPanel.onDidDispose(() => {
      disposed = true;
      queued = false;
      profileGeneration += 1;
      stopProfileWorker();
      messageSubscription.dispose();
    });

    // Set the HTML after the message listener is ready so the webview's initial
    // `ready` message cannot race extension-host registration.
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Data Peek</title>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div>
        <div class="eyebrow">DATA PEEK</div>
        <h1 id="file-name">Loading data…</h1>
        <div id="metadata" class="metadata"></div>
      </div>
      <button id="reload" class="button" type="button" title="Reload file">↻ Reload</button>
    </header>

    <section id="error" class="error hidden" role="alert"></section>
    <section id="loading" class="loading">
      <span class="spinner" aria-hidden="true"></span>
      Reading a safe preview of the file…
    </section>

    <section id="workspace" class="hidden">
      <div class="toolbar">
        <label class="search-wrap">
          <span>Search preview</span>
          <input id="search" type="search" placeholder="Search all columns…" autocomplete="off">
        </label>
        <label id="sheet-wrap" class="field hidden">
          <span>Worksheet</span>
          <select id="sheet"></select>
        </label>
      </div>

      <div id="operation-status" class="operation-status hidden" role="status" aria-live="polite"></div>

      <section id="parsing-section" class="parsing-section hidden" aria-labelledby="parsing-title">
        <div class="section-heading">
          <div>
            <h2 id="parsing-title">CSV / TSV parsing</h2>
            <span id="parsing-detected"></span>
          </div>
        </div>
        <div class="parsing-grid">
          <label class="field">
            <span>Delimiter</span>
            <select id="parsing-delimiter">
              <option value="auto">Auto</option>
              <option value="comma">Comma</option>
              <option value="semicolon">Semicolon</option>
              <option value="tab">Tab</option>
              <option value="pipe">Pipe</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label id="parsing-custom-delimiter-wrap" class="field hidden">
            <span>Custom delimiter</span>
            <input id="parsing-custom-delimiter" type="text" maxlength="2" autocomplete="off">
          </label>
          <label class="field">
            <span>Encoding</span>
            <select id="parsing-encoding">
              <option value="utf8">UTF-8</option>
              <option value="utf16le">UTF-16LE</option>
              <option value="latin1">Latin-1</option>
            </select>
          </label>
          <label class="field">
            <span>Header</span>
            <select id="parsing-header">
              <option value="firstNonEmpty">First non-empty row</option>
              <option value="none">No header</option>
            </select>
          </label>
          <label class="field">
            <span>Rows to skip</span>
            <input id="parsing-skip-rows" type="number" min="0" max="10000" step="1">
          </label>
          <label class="field">
            <span>Quote</span>
            <input id="parsing-quote" type="text" maxlength="2" autocomplete="off">
          </label>
          <label class="field">
            <span>Escape</span>
            <input id="parsing-escape" type="text" maxlength="2" autocomplete="off">
          </label>
          <label class="field">
            <span>Decimal separator</span>
            <select id="parsing-decimal">
              <option value="dot">Dot</option>
              <option value="comma">Comma</option>
            </select>
          </label>
          <label class="field">
            <span>Thousands separator</span>
            <select id="parsing-thousands">
              <option value="none">None</option>
              <option value="comma">Comma</option>
              <option value="dot">Dot</option>
              <option value="space">Space</option>
            </select>
          </label>
          <label class="field parsing-null-tokens">
            <span>Null tokens (one per line, max 20)</span>
            <textarea id="parsing-null-tokens" rows="3" maxlength="1300" autocomplete="off"></textarea>
          </label>
        </div>
        <div class="parsing-actions">
          <button id="parsing-apply" class="button" type="button">Apply</button>
          <button id="parsing-reset" class="button secondary" type="button">Reset to detected defaults</button>
        </div>
        <div id="parsing-error" class="field-error hidden" role="alert"></div>
      </section>

      <section id="quality-section" class="quality-section hidden" aria-labelledby="quality-title">
        <div class="section-heading">
          <h2 id="quality-title">Data quality</h2>
          <span>Based on preview</span>
        </div>
        <div id="quality-warnings" class="quality-warnings"></div>
      </section>

      <div class="table-workspace">
        <section class="table-section" aria-label="Data preview">
          <section class="profiles-section" aria-labelledby="profiles-title">
            <div class="section-heading profiles-heading">
              <div class="profiles-title-block">
                <div class="profiles-title-copy">
                  <h2 id="profiles-title">Column profile</h2>
                  <span id="profiles-note">Based on preview</span>
                </div>
                <button id="toggle-profiles" class="link-button profile-toggle" type="button" aria-controls="profiles" aria-expanded="true">Hide profiles</button>
              </div>
              <label class="profile-search-field">
                <span>Find profile</span>
                <input id="profile-search" type="search" placeholder="Search column names…" aria-label="Find a profile column" autocomplete="off">
              </label>
            </div>
            <div id="profiles" class="profiles">
              <div id="profiles-surface" class="profiles-surface"></div>
            </div>
          </section>
          <section id="active-filters" class="active-filters hidden" aria-label="Active filters">
            <div class="active-filters-content">
              <span class="active-filters-label">Active filters</span>
              <div id="filter-chips" class="filter-chips"></div>
            </div>
            <button id="clear-filters" class="link-button" type="button">Clear all</button>
          </section>
          <section id="filter-panel" class="filter-panel hidden" aria-labelledby="filter-title">
            <div class="filter-panel-heading">
              <div class="filter-title-group">
                <span class="filter-icon" aria-hidden="true"></span>
                <div>
                  <span>Filtering column</span>
                  <h2 id="filter-title">Filter column</h2>
                </div>
              </div>
              <button id="filter-cancel" class="icon-button" type="button" aria-label="Close filter">×</button>
            </div>
            <div id="filter-fields" class="filter-fields">
              <label class="field">
                <span>Condition</span>
                <select id="filter-operator"></select>
              </label>
              <label id="filter-value-wrap" class="field">
                <span>Value</span>
                <input id="filter-value" type="text" autocomplete="off" aria-describedby="filter-error">
              </label>
              <label id="filter-second-value-wrap" class="field hidden">
                <span>To</span>
                <input id="filter-second-value" type="text" autocomplete="off" aria-describedby="filter-error">
              </label>
              <button id="filter-apply" class="button filter-apply" type="button">Add filter</button>
            </div>
            <div id="filter-error" class="field-error hidden" role="alert"></div>
          </section>
          <div id="table-scroll" class="table-scroll" role="grid" aria-label="Loaded data preview" tabindex="-1">
            <div id="table-surface" class="table-surface">
              <div id="table-head" class="virtual-header" role="row" aria-rowindex="1"></div>
              <div id="table-body" class="virtual-body" role="rowgroup"></div>
            </div>
            <div id="empty" class="empty hidden">No preview rows match the active view.</div>
          </div>
          <footer class="table-status">
            <span><span id="result-count"></span> <span class="preview-scope">Filters apply only to the loaded preview.</span></span>
            <span>Scroll to explore the preview.</span>
          </footer>
        </section>

        <aside id="cell-detail" class="cell-detail hidden" aria-labelledby="cell-detail-title">
          <div class="cell-detail-heading">
            <div>
              <span class="eyebrow">SELECTED CELL</span>
              <h2 id="cell-detail-title"></h2>
            </div>
            <span id="cell-detail-type" class="type"></span>
          </div>
          <div id="cell-detail-null" class="cell-null hidden">Null value</div>
          <pre id="cell-detail-value" tabindex="0"></pre>
          <div class="cell-actions">
            <button id="copy-cell" class="button small" type="button">Copy cell</button>
            <button id="copy-row" class="button small secondary" type="button">Copy row</button>
            <button id="copy-column-name" class="button small secondary" type="button">Copy column name</button>
          </div>
        </aside>
      </div>
    </section>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

type ProfileWorkerMessage =
  | { type: 'progress'; processedRows: number; totalRows: number | null }
  | { type: 'result'; payload: FullProfileResult }
  | { type: 'error'; message: string };

function isProfileWorkerMessage(value: unknown): value is ProfileWorkerMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'progress') {
    return (
      typeof message.processedRows === 'number' &&
      Number.isFinite(message.processedRows) &&
      message.processedRows >= 0 &&
      (message.totalRows === null ||
        (typeof message.totalRows === 'number' &&
          Number.isFinite(message.totalRows) &&
          message.totalRows >= 0))
    );
  }
  if (message.type === 'error') {
    return typeof message.message === 'string' && message.message.length <= 256;
  }
  if (message.type === 'result' && message.payload && typeof message.payload === 'object') {
    const payload = message.payload as Record<string, unknown>;
    return (
      Array.isArray(payload.profiles) &&
      typeof payload.rowCount === 'number' &&
      Number.isFinite(payload.rowCount) &&
      payload.rowCount >= 0
    );
  }
  return false;
}

async function postOperationResult(
  webview: vscode.Webview,
  operation: 'copy' | 'parsing',
  success: boolean,
  message: string
): Promise<void> {
  await webview.postMessage({
    type: 'operationResult',
    operation,
    success,
    message: message.slice(0, 256)
  });
}

function getNonce(): string {
  return randomBytes(24).toString('base64url');
}

async function copyFromPreview(
  message: Extract<WebviewToHostMessage, { type: 'copy' }>,
  preview: DatasetPreview | undefined,
  webview: vscode.Webview
): Promise<void> {
  if (
    !preview ||
    message.rowIndex >= preview.rows.length ||
    message.columnIndex >= preview.columns.length
  ) {
    await webview.postMessage({
      type: 'operationResult',
      operation: 'copy',
      success: false,
      message: 'The selected preview cell is no longer available.'
    });
    return;
  }
  try {
    const text =
      message.kind === 'cell'
        ? copyCellText(preview.rows[message.rowIndex][message.columnIndex] ?? null)
        : message.kind === 'columnName'
          ? preview.columns[message.columnIndex]
          : copyRowAsTsv(
              Array.from(
                { length: preview.columns.length },
                (_, columnIndex) => preview.rows[message.rowIndex][columnIndex] ?? null
              )
            );
    await vscode.env.clipboard.writeText(text);
    await webview.postMessage({
      type: 'operationResult',
      operation: 'copy',
      success: true,
      message:
        message.kind === 'cell'
          ? 'Cell copied.'
          : message.kind === 'row'
            ? 'Row copied as TSV.'
            : 'Column name copied.'
    });
  } catch {
    await webview.postMessage({
      type: 'operationResult',
      operation: 'copy',
      success: false,
      message: 'Could not write to the clipboard.'
    });
  }
}
