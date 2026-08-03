# Data Peek for VS Code

Data Peek is a read-only custom editor for quickly and safely inspecting CSV, TSV, Parquet, and Excel files in VS Code. It lets you review a file's structure, sample rows, and basic quality signals without writing Pandas or notebook code.

## Supported files

| Format | Extensions | Notes |
| --- | --- | --- |
| Delimited text | `.csv`, `.tsv` | Session-only parsing controls for delimiters, encodings, headers, null tokens, and localized numbers |
| Apache Parquet | `.parquet` | Bounded preview and full-data profiling with an uncompressed-data safety guard |
| Microsoft Excel | `.xlsx`, `.xlsm` | Worksheet selection and ZIP archive validation before the workbook is loaded |

## Features

- Open `.csv`, `.tsv`, `.parquet`, `.xlsx`, and `.xlsm` files.
- Use **Open with Data Peek** from the Explorer or editor-title context menu.
- Search the loaded preview and combine multiple type-aware column filters.
- Sort columns and scroll large tables with two-axis virtualization.
- Resize columns.
- Find matching column names and jump directly to the selected table column.
- Navigate cells with the keyboard, view readable typed values, and inspect the complete raw selected value.
- Copy a cell, row, or column name to the clipboard.
- View background-calculated full-data profiles for numeric, boolean, date, text, mixed, and empty columns.
- Review missing and unique ratios, distributions, top values, and data-quality warnings that jump to the affected column.
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

You can also open a supported file normally, open the editor-title context menu, and select **Open with Data Peek**. Data Peek remains an optional custom editor and does not replace the source file's default editor.

### Preview and full-data profiles

Data Peek loads a bounded table preview first so that large files remain responsive. Search, filters, sorting, navigation, and row copying operate on this loaded preview only.

If the file contains more rows than the preview, Data Peek calculates column profiles in a background worker. Profile results and data-quality warnings can therefore describe the complete dataset even though the interactive table contains only the configured number of preview rows. When bounded-memory estimates are used, affected values are marked with `≈`.

## Settings

| Setting | Default | Range | Description |
| --- | ---: | ---: | --- |
| `dataPeek.previewRows` | `2000` | `100–5000` | Maximum data rows loaded into the interactive preview |
| `dataPeek.maxColumns` | `500` | `10–2000` | Maximum columns loaded into the preview |
| `dataPeek.maxExcelFileSizeMB` | `100` | `1–1000` | Maximum Excel workbook size that may be loaded into memory |
| `dataPeek.maxExcelExpandedSizeMB` | `250` | `10–2000` | Maximum allowed uncompressed size of an Excel ZIP archive |
| `dataPeek.maxProfileScanSizeMB` | `1024` | `64–8192` | Maximum source file size scanned for full-data profiles; Parquet also applies this limit to selected uncompressed data |

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

Requirements:

- VS Code 1.100.0 or newer
- Node.js
- pnpm 10.34.5 (the version declared by `packageManager` in `package.json`)

Install dependencies:

```sh
pnpm install
```

If pnpm is not available, a recent Node.js installation can activate the declared version through Corepack:

```sh
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm install
```

### Run the extension locally

1. Open this repository in VS Code.
2. Start the build watcher in the integrated terminal:

   ```sh
   pnpm run watch
   ```

3. Press `F5` or select **Run and Debug → Run Data Peek Extension**.
4. In the new Extension Development Host window, right-click a supported data file and select **Open with Data Peek**.

The watcher rebuilds the extension and webview bundles as files change. Reload the Extension Development Host when a code change is not reflected automatically.

### Validate changes

Run the type checker and test suite while developing:

```sh
pnpm run check
pnpm test
```

Create the production bundles before handing off a completed change:

```sh
pnpm run package
```

To build an installable VSIX package:

```sh
pnpm run vsix
```

Generated `dist/` and `.test-dist/` output is not tracked in the repository.

## Project structure

- `src/extension.ts`: extension activation and command/editor registration
- `src/dataEditorProvider.ts`: custom-editor lifecycle and extension-to-webview communication
- `src/dataReader.ts`: bounded CSV, TSV, Parquet, and Excel readers
- `src/profile.ts` and `src/dataQuality.ts`: column profiles and deterministic quality warnings
- `media/main.ts` and `media/styles.css`: interactive table behavior and VS Code-theme-aware presentation
- `test/`: reader, parsing, profiling, state, layout, clipboard, and safety tests

## Product boundaries

- Data Peek is an inspection tool; it does not edit, save, or overwrite source datasets.
- The interactive table is a bounded preview, not an unbounded full-file grid.
- Full-data profiling may be unavailable when a file exceeds configured safety limits or cannot be parsed safely. The preview remains available when possible, and the UI reports the profiling error.
- CSV and TSV parsing changes apply only to the current editor session.

## License

MIT
