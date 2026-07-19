# Data Peek for VS Code

Data Peek opens CSV, TSV, Parquet and modern Excel workbooks in an interactive, read-only VS Code tab. It is designed for analysts and data scientists who want to inspect a file without first writing Pandas or notebook code.

## Current MVP

- Right-click a supported file in Explorer and select **Open with Data Peek**.
- Preview `.csv`, `.tsv`, `.parquet`, `.xlsx` and `.xlsm` files.
- Search across the loaded preview and combine type-aware column filters with `AND` logic.
- Sort by any column and continuously scroll through a two-axis virtualized table.
- Resize, hide and pin columns; layout preferences stay with the open editor panel.
- Navigate cells by keyboard and inspect or copy the complete selected value safely.
- Inspect searchable preview-based profiles with missing/unique ratios, distributions, top values and data-quality warnings.
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

- Configurable CSV and TSV parsing options.
- Exporting filtered data and generated Pandas/Polars code.

## License

MIT
