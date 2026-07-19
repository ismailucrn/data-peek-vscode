# Changelog

All notable changes to Data Peek are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [0.6.1] - 2026-07-19

### Changed

- Precompiled active filters, reused sort/number formatters, and removed repeated scroll-time layout allocations.
- Deferred profile distribution DOM until details are opened and reduced large-list DOM mutations.
- Combined distinct/top-value profiling into one bounded pass without sorting every unique value.

### Fixed

- Preserved the true column extent of sparse Excel sheets without walking or materializing every empty row gap.
- Stopped reader work promptly when an editor load is cancelled or disposed.
- Safely normalized invalid dates and values that cannot be serialized or converted to text.

### Security

- Reject webview messages with unknown fields, oversized parsing values, or embedded row/path payloads.

## [0.6.0] - 2026-07-19

### Added

- Session-only CSV/TSV parsing controls for delimiter, encoding, header mode, skipped rows, quote, escape, null tokens, and locale-aware numbers.
- Host and reader boundary validation for every parsing option, with safe preview reload and reset-to-detected-defaults behavior.
- Applied parsing metadata and detected delimiters in the preview contract and interface.

## [0.5.0] - 2026-07-19

### Added

- Continuous vertical and horizontal virtual scrolling with ten-item overscan.
- Viewport-sized row reuse while pinned columns, sticky headers, selection, and keyboard navigation remain available.
- Performance coverage for 5,000-row and 500-column layouts plus the 250,000-cell preview budget.

### Changed

- Replaced pagination and rows-per-page controls with a fixed-row-height virtual grid.

## [0.4.0] - 2026-07-19

### Added

- Preview-based missing/unique ratios, median, population standard deviation, histograms, text lengths, date ranges, and top values.
- Data-quality warnings for mixed, empty, constant, highly missing, identifier-like, duplicate, and truncated preview data.
- Searchable, collapsible profiles for every loaded column with dependency-free distribution details.

## [0.3.0] - 2026-07-19

### Added

- Pointer and keyboard column resizing with visible-content auto sizing.
- Column visibility and pinned-column controls with restored panel preferences.
- Keyboard cell navigation, a safe full-value detail panel, and host-validated clipboard actions.

## [0.2.0] - 2026-07-19

### Added

- Per-column, type-aware filters that combine with global preview search.
- A shared, tested table-state core with stable sorting and null-last behavior.
- Restored filter, search, and sort state when a webview is recreated.

## [0.1.1] - 2026-07-19

### Added

- Cross-platform CI for type-checking, tests, builds, and VSIX packaging.
- Repository metadata, dependency updates, and contributor/security documentation.

## [0.1.0] - 2026-07-19

### Added

- Initial read-only previews for CSV, TSV, Parquet, XLSX, and XLSM files.
- Search, sorting, pagination, worksheet selection, and bounded column profiles.
- Safety limits for wide data, large cells, Excel archives, and Parquet previews.

[0.6.1]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ismailucrn/data-peek-vscode/releases/tag/v0.1.0
