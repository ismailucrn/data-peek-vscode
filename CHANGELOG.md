# Changelog

All notable changes to Data Peek are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

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

[0.5.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ismailucrn/data-peek-vscode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ismailucrn/data-peek-vscode/releases/tag/v0.1.0
