# Data Peek for VS Code

Data Peek is a read-only custom editor for quickly and safely inspecting CSV, TSV, Parquet, and Excel files in VS Code. It lets you review a file's structure, sample rows, and basic quality signals without writing Pandas or notebook code.

## Features

- Open `.csv`, `.tsv`, `.parquet`, `.xlsx`, and `.xlsm` files.
- Use **Open with Data Peek** from the Explorer or editor-title context menu.
- Search the loaded preview and combine multiple type-aware column filters.
- Sort columns and scroll large tables with two-axis virtualization.
- Resize columns.
- Find matching column names and jump directly to the selected table column.
- Navigate cells with the keyboard and inspect the complete selected value.
- Copy a cell, row, or column name to the clipboard.
- View background-calculated full-data profiles for numeric, boolean, date, text, mixed, and empty columns.
- Review missing and unique ratios, distributions, top values, and data-quality warnings.
- Switch between worksheets in an Excel workbook.
- Adjust session-only parsing settings for CSV and TSV files.
- Use the editor in VS Code light, dark, and high-contrast themes.

The editor never changes or writes back to the source file. CSV/TSV and Parquet readers operate within explicit preview and profiling limits; Excel workbooks are loaded in memory and protected by file-size and expanded-ZIP limits.

## Safety and limits

Data Peek treats files as untrusted input. Preview rows, columns, total cells, cell size, and expanded Parquet data are bounded. Full-data profiling has a separate scan-size boundary and uses bounded-memory summaries. Excel archives pass ZIP safety checks before ExcelJS loads them. File values are never interpreted as HTML; they are rendered through safe DOM text nodes.

The bounded table preview appears first. When the source has more rows, column profiles are recalculated in the background across the complete dataset and replace the preview profiles when ready. Counts, missing ratios, types, minimums, maximums, means, standard deviations, and text-length bounds are exact. On high-cardinality columns, bounded-memory estimates for distinct counts, medians, histograms, and top values are marked with `≈`. Data-quality warnings are generated only from these full-data column profiles. Search, filters, sorting, and copied rows continue to operate only on the loaded table preview.

## Usage

1. Right-click a supported file in VS Code.
2. Select **Open with Data Peek**.
3. Search, filter, sort, jump to a column, or adjust column widths in the preview.
4. Copy the selected cell, row, or column name when needed.

## Settings

| Setting | Default | Range | Description |
| --- | ---: | ---: | --- |
| `dataPeek.previewRows` | `2000` | `100–5000` | Maximum data rows loaded into the interactive preview |
| `dataPeek.maxColumns` | `500` | `10–2000` | Maximum columns loaded into the preview |
| `dataPeek.maxExcelFileSizeMB` | `100` | `1–1000` | Maximum Excel workbook size that may be loaded into memory |
| `dataPeek.maxExcelExpandedSizeMB` | `250` | `10–2000` | Maximum allowed uncompressed size of an Excel ZIP archive |
| `dataPeek.maxProfileScanSizeMB` | `1024` | `64–8192` | Maximum source or selected uncompressed Parquet data scanned for full-data profiles |

## CSV and TSV parsing

CSV and TSV previews support the following settings:

- Automatic, comma, semicolon, tab, pipe, or custom delimiters
- UTF-8, UTF-16LE, or Latin-1 encoding
- Use the first non-empty row as headers, or load headerless data
- Number of leading rows to skip
- Quote and escape characters
- Tokens that should be treated as null
- Localized number formats with decimal and thousands separators

Settings apply only to the open editor session; they are not written to the source file or carried to other files.

## Development

Requirements: Node.js and pnpm.

```sh
pnpm install
pnpm run check
pnpm test
pnpm run package
```

To start a local Extension Development Host:

```sh
pnpm run watch
```

Then open the project in VS Code, press `F5`, and select a supported file in the launched development window.

## License

MIT
