# Data Peek for VS Code

Data Peek opens CSV, TSV, Parquet and modern Excel workbooks in an interactive, read-only VS Code tab. It is designed for analysts and data scientists who want to inspect a file without first writing Pandas or notebook code.

## Current MVP

- Right-click a supported file in Explorer and select **Open with Data Peek**.
- Preview `.csv`, `.tsv`, `.parquet`, `.xlsx` and `.xlsm` files.
- Search across the loaded preview.
- Sort by any column and page through rows.
- Inspect inferred column types, missing values, distinct counts and basic ranges.
- Switch between worksheets in an Excel workbook.
- Respect VS Code light, dark and high-contrast themes.

The editor is intentionally read-only. CSV and Parquet readers limit work to the preview where possible. Excel workbooks are loaded into memory and are protected by the `dataPeek.maxExcelFileSizeMB` setting.

Untrusted data is rendered with DOM `textContent` under a restrictive Content Security Policy. Wide datasets, oversized cells, expanded Excel ZIP content, and Parquet preview decompression are bounded to protect the VS Code extension host from accidental or malicious resource exhaustion.

## Run locally

1. Install dependencies with `pnpm install`.
2. Build with `pnpm run package`.
3. Open this folder in VS Code and press `F5` to launch an Extension Development Host.
4. In the development host, right-click a supported data file and choose **Open with Data Peek**.

During development, use `pnpm run watch` and keep the Extension Development Host open.

## Settings

- `dataPeek.previewRows`: maximum rows placed in an interactive preview (default `2000`, maximum `5000`).
- `dataPeek.maxExcelFileSizeMB`: Excel workbook memory safety limit (default `100`).
- `dataPeek.maxExcelExpandedSizeMB`: uncompressed Excel ZIP safety limit (default `250`).
- `dataPeek.maxColumns`: maximum columns loaded into a preview (default `500`).

## Planned next steps

- Per-column filters and configurable parsing options.
- Virtualized rendering for larger previews.
- Exporting filtered data and generated Pandas/Polars code.
- Richer distributions, histograms and data quality warnings.
- Optional editable transformations with an explicit save/export flow.

## License

MIT
