import * as vscode from 'vscode';
import { DataPeekEditorProvider } from './dataEditorProvider';
import { isSupportedFile } from './dataReader';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DataPeekEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(DataPeekEditorProvider.viewType, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand('dataPeek.open', async (resource?: vscode.Uri) => {
      const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri || uri.scheme !== 'file') {
        void vscode.window.showWarningMessage('Select a local CSV, TSV, Parquet or Excel file first.');
        return;
      }
      if (!isSupportedFile(uri.fsPath)) {
        void vscode.window.showWarningMessage(
          'Data Peek currently supports .csv, .tsv, .parquet, .xlsx and .xlsm files.'
        );
        return;
      }

      try {
        await vscode.commands.executeCommand('vscode.openWith', uri, DataPeekEditorProvider.viewType);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Could not open ${pathLabel(uri)}: ${message}`);
      }
    })
  );
}

export function deactivate(): void {}

function pathLabel(uri: vscode.Uri): string {
  return uri.path.split('/').pop() || uri.fsPath;
}
