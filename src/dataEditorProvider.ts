import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { copyCellText, copyRowAsTsv } from './clipboard';
import { isSupportedFile, loadPreview } from './dataReader';
import { isWebviewMessage } from './messages';
import { DatasetPreview, WebviewToHostMessage } from './types';

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

    const refresh = async (): Promise<void> => {
      if (disposed || cancellationToken.isCancellationRequested) return;
      if (loading) {
        queued = true;
        return;
      }
      loading = true;
      void webviewPanel.webview.postMessage({ type: 'loading' });
      try {
        const configuration = vscode.workspace.getConfiguration('dataPeek');
        const preview = await loadPreview(document.uri.fsPath, {
          limit: configuration.get<number>('previewRows', 2000),
          maxExcelFileSizeMB: configuration.get<number>('maxExcelFileSizeMB', 100),
          maxExcelExpandedSizeMB: configuration.get<number>('maxExcelExpandedSizeMB', 250),
          maxColumns: configuration.get<number>('maxColumns', 500),
          sheet: selectedSheet
        });
        if (disposed || cancellationToken.isCancellationRequested) return;
        selectedSheet = preview.sheet;
        availableSheets = new Set(preview.sheets ?? []);
        latestPreview = preview;
        await webviewPanel.webview.postMessage({ type: 'dataset', payload: preview });
      } catch (error) {
        if (disposed || cancellationToken.isCancellationRequested) return;
        const message = error instanceof Error ? error.message : String(error);
        await webviewPanel.webview.postMessage({ type: 'error', message });
      } finally {
        loading = false;
        if (queued && !disposed && !cancellationToken.isCancellationRequested) {
          queued = false;
          void refresh();
        }
      }
    };

    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (!isWebviewMessage(message)) return;
        if (message.type === 'ready' && !readyReceived) {
          readyReceived = true;
          void refresh();
        } else if (message.type === 'reload') {
          void refresh();
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
        <button id="columns-menu-toggle" class="button secondary" type="button" aria-expanded="false">Columns</button>
        <label class="field compact">
          <span>Rows per page</span>
          <select id="page-size">
            <option value="25">25</option>
            <option value="50" selected>50</option>
            <option value="100">100</option>
            <option value="250">250</option>
          </select>
        </label>
      </div>

      <section id="columns-menu" class="columns-menu hidden" aria-labelledby="columns-title">
        <div class="columns-menu-heading">
          <div>
            <span class="eyebrow">TABLE LAYOUT</span>
            <h2 id="columns-title">Columns</h2>
          </div>
          <button id="show-all-columns" class="link-button" type="button">Show all</button>
        </div>
        <div id="columns-list" class="columns-list"></div>
      </section>

      <div id="operation-status" class="operation-status hidden" role="status" aria-live="polite"></div>

      <section id="filter-panel" class="filter-panel hidden" aria-labelledby="filter-title">
        <div class="filter-panel-heading">
          <div>
            <span class="eyebrow">COLUMN FILTER</span>
            <h2 id="filter-title">Filter column</h2>
          </div>
          <button id="filter-cancel" class="icon-button" type="button" aria-label="Close filter">×</button>
        </div>
        <div class="filter-fields">
          <label class="field">
            <span>Operator</span>
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
          <button id="filter-apply" class="button" type="button">Apply filter</button>
        </div>
        <div id="filter-error" class="field-error hidden" role="alert"></div>
      </section>

      <section id="active-filters" class="active-filters hidden" aria-label="Active filters">
        <div id="filter-chips" class="filter-chips"></div>
        <button id="clear-filters" class="link-button" type="button">Clear all</button>
      </section>

      <section class="profiles-section" aria-labelledby="profiles-title">
        <div class="section-heading">
          <h2 id="profiles-title">Column profile</h2>
          <span id="profiles-note"></span>
        </div>
        <div id="profiles" class="profiles"></div>
      </section>

      <div class="table-workspace">
        <section class="table-section" aria-label="Data preview">
          <div id="table-scroll" class="table-scroll">
            <table role="grid" aria-label="Loaded data preview">
              <colgroup id="table-columns"></colgroup>
              <thead id="table-head"></thead>
              <tbody id="table-body"></tbody>
            </table>
            <div id="empty" class="empty hidden">No preview rows match the active view.</div>
          </div>
          <footer class="pagination">
            <span><span id="result-count"></span> <span class="preview-scope">Filters apply only to the loaded preview.</span></span>
            <div>
              <button id="previous" class="button small" type="button">Previous</button>
              <span id="page-label"></span>
              <button id="next" class="button small" type="button">Next</button>
            </div>
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
