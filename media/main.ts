import {
  EMPTY_TABLE_VIEW_STATE,
  applyTableView,
  filterValidationError,
  normalizeTableViewState,
  operatorNeedsValue,
  operatorsForType
} from '../src/tableState';
import { formatCellDetail } from '../src/cellView';
import {
  validateDelimitedParsingSettings
} from '../src/parsing';
import {
  DEFAULT_COLUMN_WIDTH,
  NavigationKey,
  VIRTUAL_HEADER_HEIGHT,
  VIRTUAL_OVERSCAN,
  VIRTUAL_ROW_HEIGHT,
  VirtualColumnRange,
  VirtualRange,
  calculateVirtualColumns,
  calculateVirtualRange,
  centeredColumnScrollOffset,
  clampColumnWidth,
  estimateColumnWidth,
  matchColumnNames,
  navigateSelection
} from '../src/tableLayout';
import {
  CellSelection,
  ColumnFilter,
  CopyKind,
  DatasetPreview,
  DelimitedParsingSettings,
  FilterOperator,
  FullProfileResult,
  HostToWebviewMessage,
  IndexedRow,
  SerializableCell,
  TableViewState
} from '../src/types';

interface VsCodeApi<T> {
  postMessage(message: unknown): void;
  getState(): T | undefined;
  setState(state: T): void;
}

declare function acquireVsCodeApi<T = unknown>(): VsCodeApi<T>;

interface PersistedState {
  datasetSignature: string;
  table: TableViewState;
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: 'Contains',
  notContains: 'Does not contain',
  equals: 'Equals',
  notEquals: 'Does not equal',
  startsWith: 'Starts with',
  endsWith: 'Ends with',
  greaterThan: 'Greater than',
  greaterThanOrEqual: 'Greater than or equal',
  lessThan: 'Less than',
  lessThanOrEqual: 'Less than or equal',
  between: 'Between',
  isTrue: 'Is true',
  isFalse: 'Is false',
  isEmpty: 'Is empty',
  isNotEmpty: 'Is not empty'
};
const NUMBER_FORMATTER = new Intl.NumberFormat();
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3
});
const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1
});
const ROW_INDEX_WIDTH = 54;

const vscode = acquireVsCodeApi<PersistedState>();
const elements = {
  fileName: requiredElement<HTMLElement>('file-name'),
  metadata: requiredElement<HTMLElement>('metadata'),
  error: requiredElement<HTMLElement>('error'),
  loading: requiredElement<HTMLElement>('loading'),
  workspace: requiredElement<HTMLElement>('workspace'),
  reload: requiredElement<HTMLButtonElement>('reload'),
  search: requiredElement<HTMLInputElement>('search'),
  sheetWrap: requiredElement<HTMLElement>('sheet-wrap'),
  sheet: requiredElement<HTMLSelectElement>('sheet'),
  operationStatus: requiredElement<HTMLElement>('operation-status'),
  parsingSection: requiredElement<HTMLElement>('parsing-section'),
  parsingDetected: requiredElement<HTMLElement>('parsing-detected'),
  parsingDelimiter: requiredElement<HTMLSelectElement>('parsing-delimiter'),
  parsingCustomDelimiterWrap: requiredElement<HTMLElement>('parsing-custom-delimiter-wrap'),
  parsingCustomDelimiter: requiredElement<HTMLInputElement>('parsing-custom-delimiter'),
  parsingEncoding: requiredElement<HTMLSelectElement>('parsing-encoding'),
  parsingHeader: requiredElement<HTMLSelectElement>('parsing-header'),
  parsingSkipRows: requiredElement<HTMLInputElement>('parsing-skip-rows'),
  parsingQuote: requiredElement<HTMLInputElement>('parsing-quote'),
  parsingEscape: requiredElement<HTMLInputElement>('parsing-escape'),
  parsingDecimal: requiredElement<HTMLSelectElement>('parsing-decimal'),
  parsingThousands: requiredElement<HTMLSelectElement>('parsing-thousands'),
  parsingNullTokens: requiredElement<HTMLTextAreaElement>('parsing-null-tokens'),
  parsingApply: requiredElement<HTMLButtonElement>('parsing-apply'),
  parsingReset: requiredElement<HTMLButtonElement>('parsing-reset'),
  parsingError: requiredElement<HTMLElement>('parsing-error'),
  qualitySection: requiredElement<HTMLElement>('quality-section'),
  qualityWarnings: requiredElement<HTMLElement>('quality-warnings'),
  profiles: requiredElement<HTMLElement>('profiles'),
  profilesSurface: requiredElement<HTMLElement>('profiles-surface'),
  profilesNote: requiredElement<HTMLElement>('profiles-note'),
  profileSearchField: requiredElement<HTMLElement>('profile-search-field'),
  profileSearch: requiredElement<HTMLInputElement>('profile-search'),
  columnSearchResults: requiredElement<HTMLElement>('column-search-results'),
  columnSearchStatus: requiredElement<HTMLElement>('column-search-status'),
  toggleProfiles: requiredElement<HTMLButtonElement>('toggle-profiles'),
  tableHead: requiredElement<HTMLElement>('table-head'),
  tableBody: requiredElement<HTMLElement>('table-body'),
  tableSurface: requiredElement<HTMLElement>('table-surface'),
  tableScroll: requiredElement<HTMLElement>('table-scroll'),
  empty: requiredElement<HTMLElement>('empty'),
  resultCount: requiredElement<HTMLElement>('result-count'),
  filterPanel: requiredElement<HTMLElement>('filter-panel'),
  filterTitle: requiredElement<HTMLElement>('filter-title'),
  filterFields: requiredElement<HTMLElement>('filter-fields'),
  filterOperator: requiredElement<HTMLSelectElement>('filter-operator'),
  filterValueWrap: requiredElement<HTMLElement>('filter-value-wrap'),
  filterValue: requiredElement<HTMLInputElement>('filter-value'),
  filterSecondValueWrap: requiredElement<HTMLElement>('filter-second-value-wrap'),
  filterSecondValue: requiredElement<HTMLInputElement>('filter-second-value'),
  filterError: requiredElement<HTMLElement>('filter-error'),
  filterApply: requiredElement<HTMLButtonElement>('filter-apply'),
  filterCancel: requiredElement<HTMLButtonElement>('filter-cancel'),
  activeFilters: requiredElement<HTMLElement>('active-filters'),
  filterChips: requiredElement<HTMLElement>('filter-chips'),
  clearFilters: requiredElement<HTMLButtonElement>('clear-filters'),
  cellDetail: requiredElement<HTMLElement>('cell-detail'),
  cellDetailTitle: requiredElement<HTMLElement>('cell-detail-title'),
  cellDetailType: requiredElement<HTMLElement>('cell-detail-type'),
  cellDetailNull: requiredElement<HTMLElement>('cell-detail-null'),
  cellDetailValue: requiredElement<HTMLElement>('cell-detail-value'),
  copyCell: requiredElement<HTMLButtonElement>('copy-cell'),
  copyRow: requiredElement<HTMLButtonElement>('copy-row'),
  copyColumnName: requiredElement<HTMLButtonElement>('copy-column-name')
};

let dataset: DatasetPreview | null = null;
let tableState: TableViewState = { ...EMPTY_TABLE_VIEW_STATE, filters: [] };
let searchTimer = 0;
let activeFilterColumn: number | null = null;
let filterSequence = 0;
let statusTimer = 0;
let tableScrollFrame = 0;
let resizeFrame = 0;
let virtualRows: IndexedRow[] = [];
let virtualRowIndexes: number[] = [];
let virtualColumnOrder: number[] = [];
let virtualColumnWidths: number[] = [];
let renderedRows: VirtualRange = { start: -1, end: -1 };
let renderedColumns = '';
let currentDatasetSignature = '';
let columnSearchMatches: number[] = [];
let activeColumnMatch = -1;
let columnHighlightTimer = 0;
let profileActivity:
  | { state: 'idle' }
  | { state: 'running'; processedRows: number; totalRows: number | null }
  | { state: 'error'; message: string } = { state: 'idle' };

elements.reload.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
elements.parsingDelimiter.addEventListener('change', renderCustomDelimiterField);
elements.parsingApply.addEventListener('click', applyParsingSettings);
elements.parsingReset.addEventListener('click', () => {
  clearParsingError();
  setParsingPending(true);
  vscode.postMessage({ type: 'updateParsing', settings: null });
});
elements.search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    tableState = { ...tableState, query: elements.search.value };
    resetTablePosition();
    persistState();
    renderTable();
  }, 120);
});
elements.sheet.addEventListener('change', () => {
  vscode.postMessage({ type: 'selectSheet', sheet: elements.sheet.value });
});
elements.tableScroll.addEventListener('scroll', () => {
  if (tableScrollFrame) return;
  tableScrollFrame = window.requestAnimationFrame(() => {
    tableScrollFrame = 0;
    elements.profiles.scrollLeft = elements.tableScroll.scrollLeft;
    renderVirtualViewport();
  });
}, { passive: true });
elements.profiles.addEventListener('wheel', (event) => {
  const shiftedDelta = event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY);
  const horizontalDelta = shiftedDelta ? event.deltaY : event.deltaX;
  if (
    horizontalDelta === 0 ||
    (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))
  ) return;
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? elements.tableScroll.clientWidth
        : 1;
  const previous = elements.tableScroll.scrollLeft;
  setSharedHorizontalScroll(previous + horizontalDelta * unit);
  if (elements.tableScroll.scrollLeft !== previous) event.preventDefault();
}, { passive: false });
elements.profiles.addEventListener('keydown', (event) => {
  if (
    event.target !== elements.profiles ||
    (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
  ) return;
  event.preventDefault();
  setSharedHorizontalScroll(
    elements.tableScroll.scrollLeft + (event.key === 'ArrowLeft' ? -80 : 80)
  );
});
elements.tableBody.addEventListener('click', (event) => {
  const cell = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
  const rowIndex = Number(cell?.dataset.rowIndex);
  const columnIndex = Number(cell?.dataset.columnIndex);
  if (Number.isInteger(rowIndex) && Number.isInteger(columnIndex)) {
    selectCell({ rowIndex, columnIndex }, true);
  }
});
elements.tableBody.addEventListener('keydown', (event) => handleCellKeydown(event));
window.addEventListener('resize', () => {
  if (!dataset || resizeFrame) return;
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0;
    renderTable();
  });
});
elements.copyCell.addEventListener('click', () => requestCopy('cell'));
elements.copyRow.addEventListener('click', () => requestCopy('row'));
elements.copyColumnName.addEventListener('click', () => requestCopy('columnName'));
elements.profileSearch.addEventListener('input', renderColumnSearchResults);
elements.profileSearch.addEventListener('focus', renderColumnSearchResults);
elements.profileSearch.addEventListener('keydown', handleColumnSearchKeydown);
document.addEventListener('pointerdown', (event) => {
  if (!elements.profileSearchField.contains(event.target as Node)) closeColumnSearchResults();
});
elements.toggleProfiles.addEventListener('click', () => {
  updateUi({ profilesCollapsed: !tableState.ui?.profilesCollapsed });
  renderProfiles();
});
elements.filterOperator.addEventListener('change', renderFilterValueFields);
elements.filterApply.addEventListener('click', applyFilter);
elements.filterCancel.addEventListener('click', closeFilterPanel);
elements.filterPanel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeFilterPanel();
});
elements.clearFilters.addEventListener('click', () => {
  tableState = { ...tableState, filters: [] };
  resetTablePosition();
  closeFilterPanel();
  persistState();
  renderTable();
});
for (const input of [elements.filterValue, elements.filterSecondValue]) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyFilter();
    if (event.key === 'Escape') closeFilterPanel();
  });
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isHostMessage(message)) return;
  if (message.type === 'loading') {
    setLoading();
  } else if (message.type === 'error') {
    setError(message.message);
  } else if (message.type === 'dataset') {
    receiveDataset(message.payload);
  } else if (message.type === 'profileProgress') {
    profileActivity = {
      state: 'running',
      processedRows: message.processedRows,
      totalRows: message.totalRows
    };
    renderProfileNote();
  } else if (message.type === 'profiles') {
    receiveFullProfiles(message.payload);
  } else if (message.type === 'profileError') {
    profileActivity = { state: 'error', message: message.message };
    renderProfileNote();
  } else {
    if (message.operation === 'parsing') {
      setParsingPending(false);
      if (!message.success) showParsingError(message.message);
    }
    showOperationStatus(message.message, message.success);
  }
});

function setLoading(): void {
  elements.error.classList.add('hidden');
  elements.workspace.classList.add('hidden');
  elements.loading.classList.remove('hidden');
}

function setError(message: string): void {
  elements.loading.classList.add('hidden');
  elements.workspace.classList.add('hidden');
  elements.error.textContent = message;
  elements.error.classList.remove('hidden');
}

function receiveDataset(nextDataset: DatasetPreview): void {
  dataset = nextDataset;
  profileActivity = { state: 'idle' };
  const signature = datasetSignature(nextDataset);
  currentDatasetSignature = signature;
  const persisted = vscode.getState();
  tableState =
    persisted?.datasetSignature === signature
      ? normalizeTableViewState(persisted.table, nextDataset)
      : { ...EMPTY_TABLE_VIEW_STATE, filters: [] };
  activeFilterColumn = null;
  elements.search.value = tableState.query;
  elements.profileSearch.value = '';
  closeColumnSearchResults();
  elements.tableScroll.scrollTop = 0;
  elements.tableScroll.scrollLeft = 0;
  closeFilterPanel();
  persistState();
  renderDataset();
  const restoredSelection = tableState.ui?.selectedCell;
  if (restoredSelection) {
    window.requestAnimationFrame(() => selectCell(restoredSelection));
  }
}

function receiveFullProfiles(result: FullProfileResult): void {
  if (!dataset || result.profiles.length !== dataset.columns.length) return;
  dataset = {
    ...dataset,
    profiles: result.profiles,
    profileScope: 'full',
    profiledRowCount: result.rowCount,
    qualityWarnings: result.qualityWarnings
  };
  profileActivity = { state: 'idle' };
  renderQualityWarnings();
  renderTable();
}

function renderDataset(): void {
  if (!dataset) return;
  elements.loading.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.workspace.classList.remove('hidden');
  elements.fileName.textContent = dataset.fileName;
  renderMetadata();
  renderSheetPicker();
  renderParsingSettings();
  renderQualityWarnings();
  renderTable();
}

function renderMetadata(): void {
  if (!dataset) return;
  elements.metadata.replaceChildren();
  const total =
    dataset.totalRows === null
      ? `${formatNumber(dataset.previewRowCount)}+ rows`
      : `${formatNumber(dataset.totalRows)} rows`;
  const columnLabel = dataset.truncatedColumns
    ? `${formatNumber(dataset.columns.length)} of ${formatNumber(dataset.totalColumns)} columns`
    : `${formatNumber(dataset.columns.length)} columns`;
  const labels = [dataset.format, total, columnLabel, formatBytes(dataset.fileSize)];
  if (dataset.truncated) labels.push(`Previewing first ${formatNumber(dataset.previewRowCount)}`);
  if (dataset.parsing) {
    labels.push(`Delimiter ${delimiterLabel(dataset.parsing.resolvedDelimiter)}`);
    labels.push(encodingLabel(dataset.parsing.applied.encoding));
  }
  for (const label of labels) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = label;
    elements.metadata.appendChild(badge);
  }
}

function renderSheetPicker(): void {
  if (!dataset) return;
  const sheets = dataset.sheets ?? [];
  elements.sheet.replaceChildren();
  if (sheets.length <= 1) {
    elements.sheetWrap.classList.add('hidden');
    return;
  }
  for (const name of sheets) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.selected = name === dataset.sheet;
    elements.sheet.appendChild(option);
  }
  elements.sheetWrap.classList.remove('hidden');
}

function renderParsingSettings(): void {
  if (!dataset?.parsing || (dataset.format !== 'CSV' && dataset.format !== 'TSV')) {
    elements.parsingSection.classList.add('hidden');
    return;
  }
  const settings = dataset.parsing.applied;
  elements.parsingDelimiter.value = settings.delimiter;
  elements.parsingCustomDelimiter.value = settings.customDelimiter ?? '';
  elements.parsingEncoding.value = settings.encoding;
  elements.parsingHeader.value = settings.header;
  elements.parsingSkipRows.value = String(settings.skipRows);
  elements.parsingQuote.value = settings.quote;
  elements.parsingEscape.value = settings.escape;
  elements.parsingDecimal.value = settings.decimalSeparator;
  elements.parsingThousands.value = settings.thousandsSeparator;
  elements.parsingNullTokens.value = settings.nullTokens.join('\n');
  elements.parsingDetected.textContent =
    `Detected ${delimiterLabel(dataset.parsing.detectedDelimiter)} · Settings stay in this editor session`;
  renderCustomDelimiterField();
  clearParsingError();
  setParsingPending(false);
  elements.parsingSection.classList.remove('hidden');
}

function renderCustomDelimiterField(): void {
  elements.parsingCustomDelimiterWrap.classList.toggle(
    'hidden',
    elements.parsingDelimiter.value !== 'custom'
  );
}

function applyParsingSettings(): void {
  const candidate: DelimitedParsingSettings = {
    delimiter: elements.parsingDelimiter.value as DelimitedParsingSettings['delimiter'],
    ...(elements.parsingDelimiter.value === 'custom'
      ? { customDelimiter: elements.parsingCustomDelimiter.value }
      : {}),
    encoding: elements.parsingEncoding.value as DelimitedParsingSettings['encoding'],
    header: elements.parsingHeader.value as DelimitedParsingSettings['header'],
    skipRows: Number(elements.parsingSkipRows.value),
    quote: elements.parsingQuote.value,
    escape: elements.parsingEscape.value,
    nullTokens: elements.parsingNullTokens.value
      .split(/\r?\n/)
      .filter((token) => token.length > 0),
    decimalSeparator:
      elements.parsingDecimal.value as DelimitedParsingSettings['decimalSeparator'],
    thousandsSeparator:
      elements.parsingThousands.value as DelimitedParsingSettings['thousandsSeparator']
  };
  const validation = validateDelimitedParsingSettings(candidate);
  if (!validation.value) {
    showParsingError(validation.error ?? 'Invalid parsing settings.', validation.field);
    return;
  }
  clearParsingError();
  setParsingPending(true);
  vscode.postMessage({ type: 'updateParsing', settings: validation.value });
}

function showParsingError(
  message: string,
  field?: keyof DelimitedParsingSettings
): void {
  clearParsingError();
  elements.parsingError.textContent = message;
  elements.parsingError.classList.remove('hidden');
  parsingFieldElement(field)?.setAttribute('aria-invalid', 'true');
}

function clearParsingError(): void {
  elements.parsingError.textContent = '';
  elements.parsingError.classList.add('hidden');
  for (const element of parsingFieldElements()) element.removeAttribute('aria-invalid');
}

function parsingFieldElement(
  field: keyof DelimitedParsingSettings | undefined
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined {
  if (field === 'delimiter') return elements.parsingDelimiter;
  if (field === 'customDelimiter') return elements.parsingCustomDelimiter;
  if (field === 'encoding') return elements.parsingEncoding;
  if (field === 'header') return elements.parsingHeader;
  if (field === 'skipRows') return elements.parsingSkipRows;
  if (field === 'quote') return elements.parsingQuote;
  if (field === 'escape') return elements.parsingEscape;
  if (field === 'nullTokens') return elements.parsingNullTokens;
  if (field === 'decimalSeparator') return elements.parsingDecimal;
  if (field === 'thousandsSeparator') return elements.parsingThousands;
  return undefined;
}

function parsingFieldElements(): Array<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
> {
  return [
    elements.parsingDelimiter,
    elements.parsingCustomDelimiter,
    elements.parsingEncoding,
    elements.parsingHeader,
    elements.parsingSkipRows,
    elements.parsingQuote,
    elements.parsingEscape,
    elements.parsingNullTokens,
    elements.parsingDecimal,
    elements.parsingThousands
  ];
}

function setParsingPending(pending: boolean): void {
  elements.parsingApply.disabled = pending;
  elements.parsingReset.disabled = pending;
}

function delimiterLabel(character: string): string {
  if (character === '\t') return 'Tab';
  if (character === ' ') return 'Space';
  if (character === ',') return 'Comma';
  if (character === ';') return 'Semicolon';
  if (character === '|') return 'Pipe';
  return `“${character}”`;
}

function encodingLabel(encoding: DelimitedParsingSettings['encoding']): string {
  if (encoding === 'utf16le') return 'UTF-16LE';
  if (encoding === 'latin1') return 'Latin-1';
  return 'UTF-8';
}

function renderProfiles(): void {
  if (!dataset) return;
  elements.profilesSurface.replaceChildren();
  const collapsed = tableState.ui?.profilesCollapsed ?? false;
  elements.profiles.classList.toggle('hidden', collapsed);
  elements.toggleProfiles.textContent = collapsed ? 'Show profiles' : 'Hide profiles';
  elements.toggleProfiles.setAttribute('aria-expanded', String(!collapsed));
  renderProfileNote();
  if (collapsed) return;

  const contentWidth = ROW_INDEX_WIDTH + virtualColumnWidths.reduce(
    (width, columnWidthValue) => width + columnWidthValue,
    0
  );
  elements.profiles.style.width = `${elements.tableScroll.clientWidth}px`;
  elements.profilesSurface.style.width =
    `${Math.max(contentWidth, elements.tableScroll.clientWidth)}px`;
  const fragment = document.createDocumentFragment();
  const gutter = document.createElement('div');
  gutter.className = 'profile-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  fragment.appendChild(gutter);

  for (const columnIndex of virtualColumnOrder) {
    const profile = dataset.profiles[columnIndex];
    if (!profile) continue;
    const card = document.createElement('article');
    card.className = 'profile-card';
    card.dataset.columnIndex = String(columnIndex);
    applyColumnDimensions(card, columnIndex);
    const heading = document.createElement('div');
    heading.className = 'profile-heading';
    const name = document.createElement('strong');
    name.textContent = profile.name;
    name.title = profile.name;
    const type = document.createElement('span');
    type.className = `type type-${profile.type}`;
    type.textContent = profile.type;
    heading.append(name, type);
    card.appendChild(heading);

    const stats = document.createElement('dl');
    stats.className = 'profile-primary-stats';
    const approximate = new Set(profile.approximateMetrics ?? []);
    addStat(
      stats,
      'Missing',
      `${formatNumber(profile.missing)} (${formatPercent(profile.missingRatio)})`
    );
    addStat(stats, 'Distinct', formatNumber(profile.distinct), approximate.has('distinct'));
    addStat(
      stats,
      'Range',
      profile.min !== undefined && profile.max !== undefined
        ? `${formatCompact(profile.min)}–${formatCompact(profile.max)}`
        : '—'
    );
    card.appendChild(stats);

    const statisticsDetails = document.createElement('details');
    statisticsDetails.className = 'profile-details';
    const statisticsSummary = document.createElement('summary');
    statisticsSummary.textContent = 'More statistics';
    const secondaryStats = document.createElement('dl');
    secondaryStats.className = 'profile-secondary-stats';
    addStat(secondaryStats, 'Non-null', formatNumber(profile.nonNull));
    addStat(
      secondaryStats,
      'Unique %',
      formatPercent(profile.uniqueRatio),
      approximate.has('distinct')
    );
    if (profile.mean !== undefined) addStat(secondaryStats, 'Mean', formatCompact(profile.mean));
    if (profile.median !== undefined) {
      addStat(
        secondaryStats,
        'Median',
        formatCompact(profile.median),
        approximate.has('median')
      );
    }
    if (profile.standardDeviation !== undefined) {
      addStat(secondaryStats, 'Population σ', formatCompact(profile.standardDeviation));
    }
    if (profile.minLength !== undefined) {
      addStat(secondaryStats, 'Min length', formatNumber(profile.minLength));
    }
    if (profile.maxLength !== undefined) {
      addStat(secondaryStats, 'Max length', formatNumber(profile.maxLength));
    }
    statisticsDetails.append(statisticsSummary, secondaryStats);
    card.appendChild(statisticsDetails);

    if ((profile.histogram?.length ?? 0) > 0 || profile.topValues.length > 0) {
      const details = document.createElement('details');
      details.className = 'profile-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Distribution details';
      details.appendChild(summary);
      let detailsRendered = false;
      details.addEventListener('toggle', () => {
        if (!details.open || detailsRendered) return;
        detailsRendered = true;
        if (profile.topValues.length) {
          renderTopValues(details, profile.topValues, approximate.has('topValues'));
        }
        if (profile.histogram?.length) {
          renderHistogram(details, profile.histogram, approximate.has('histogram'));
        }
      });
      card.appendChild(details);
    }
    fragment.appendChild(card);
  }
  elements.profilesSurface.appendChild(fragment);
  elements.profiles.scrollLeft = elements.tableScroll.scrollLeft;
}

function renderQualityWarnings(): void {
  if (!dataset) return;
  elements.qualityWarnings.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const warning of dataset.qualityWarnings) {
    const item = document.createElement('div');
    item.className = `quality-warning quality-${warning.code}`;
    const icon = document.createElement('span');
    icon.className = 'quality-icon';
    icon.textContent = '•';
    icon.setAttribute('aria-hidden', 'true');
    const message = document.createElement('span');
    message.textContent = warning.message;
    item.append(icon, message);
    fragment.appendChild(item);
  }
  elements.qualityWarnings.appendChild(fragment);
  elements.qualitySection.classList.toggle('hidden', dataset.qualityWarnings.length === 0);
}

function renderHistogram(
  container: HTMLElement,
  bins: NonNullable<DatasetPreview['profiles'][number]['histogram']>,
  approximate: boolean
): void {
  const section = document.createElement('section');
  section.className = 'profile-distribution';
  const heading = document.createElement('strong');
  heading.textContent = approximate ? 'Histogram (estimated)' : 'Histogram';
  section.appendChild(heading);
  const maximum = Math.max(...bins.map((bin) => bin.count), 1);
  const chart = document.createElement('div');
  chart.className = 'histogram-chart';
  chart.setAttribute('role', 'img');
  chart.setAttribute(
    'aria-label',
    `${approximate ? 'Estimated histogram' : 'Histogram'}. ` +
      bins.map((bin) => `${formatHistogramRange(bin.start, bin.end)}: ${formatNumber(bin.count)}`).join(', ')
  );
  for (const bin of bins) {
    const bar = document.createElement('span');
    bar.className = 'histogram-column';
    bar.style.height = `${(bin.count / maximum) * 100}%`;
    bar.title =
      `${formatHistogramRange(bin.start, bin.end)} · ` +
      `${approximate ? '≈' : ''}${formatNumber(bin.count)}`;
    bar.setAttribute('aria-hidden', 'true');
    chart.appendChild(bar);
  }
  const axis = document.createElement('div');
  axis.className = `histogram-axis${bins.length === 1 ? ' single-value' : ''}`;
  axis.setAttribute('aria-hidden', 'true');
  const start = document.createElement('span');
  start.textContent = formatCompact(bins[0].start);
  axis.appendChild(start);
  if (bins.length > 1) {
    const end = document.createElement('span');
    end.textContent = formatCompact(bins[bins.length - 1].end);
    axis.appendChild(end);
  }
  section.append(chart, axis);
  container.appendChild(section);
}

function formatHistogramRange(start: number, end: number): string {
  return start === end ? formatCompact(start) : `${formatCompact(start)}–${formatCompact(end)}`;
}

function renderTopValues(
  container: HTMLElement,
  values: DatasetPreview['profiles'][number]['topValues'],
  approximate: boolean
): void {
  const section = document.createElement('section');
  section.className = 'profile-distribution';
  const heading = document.createElement('strong');
  heading.textContent = approximate ? 'Top values (estimated)' : 'Top values';
  section.appendChild(heading);
  for (const item of values) {
    const row = document.createElement('div');
    row.className = 'top-value-row';
    const value = document.createElement('span');
    value.textContent = item.value === null ? 'null' : String(item.value);
    value.title = value.textContent;
    const count = document.createElement('span');
    count.textContent = `${approximate ? '≈' : ''}${formatNumber(item.count)}`;
    row.append(value, count);
    section.appendChild(row);
  }
  container.appendChild(section);
}

function addStat(list: HTMLElement, label: string, value: string, approximate = false): void {
  const term = document.createElement('dt');
  term.textContent = label;
  const definition = document.createElement('dd');
  definition.textContent = `${approximate ? '≈' : ''}${value}`;
  definition.title = approximate ? `Estimated: ${value}` : value;
  list.append(term, definition);
}

function renderProfileNote(): void {
  if (!dataset) return;
  const columnSummary = `${formatNumber(virtualColumnOrder.length)} columns`;
  if (dataset.profileScope === 'full') {
    const estimated = dataset.profiles.some(
      (profile) => (profile.approximateMetrics?.length ?? 0) > 0
    );
    elements.profilesNote.textContent =
      `Full dataset · ${formatNumber(dataset.profiledRowCount)} rows · ${columnSummary}` +
      (estimated ? ' · ≈ estimated' : '');
    return;
  }
  if (profileActivity.state === 'running') {
    const progress =
      profileActivity.totalRows && profileActivity.totalRows > 0
        ? ` ${formatPercent(
            Math.min(1, profileActivity.processedRows / profileActivity.totalRows)
          )}`
        : ` ${formatNumber(profileActivity.processedRows)} rows`;
    elements.profilesNote.textContent =
      `Preview shown · Profiling full dataset…${progress} · ${columnSummary}`;
    return;
  }
  if (profileActivity.state === 'error') {
    elements.profilesNote.textContent =
      `Preview only · Full profile unavailable: ${profileActivity.message}`;
    return;
  }
  elements.profilesNote.textContent =
    `Based on preview · ${formatNumber(dataset.profiledRowCount)} rows · ${columnSummary}`;
}

function renderColumnSearchResults(): void {
  if (!dataset) {
    closeColumnSearchResults();
    return;
  }
  const currentDataset = dataset;
  const query = elements.profileSearch.value.slice(0, 200);
  if (elements.profileSearch.value !== query) elements.profileSearch.value = query;
  const result = matchColumnNames(currentDataset.columns, query);
  columnSearchMatches = result.matches;
  activeColumnMatch = result.matches.length > 0 ? 0 : -1;
  elements.columnSearchResults.replaceChildren();
  if (!query.trim()) {
    closeColumnSearchResults();
    return;
  }

  const fragment = document.createDocumentFragment();
  if (result.matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'column-search-empty';
    empty.textContent = 'No matching columns';
    fragment.appendChild(empty);
    elements.columnSearchStatus.textContent = 'No matching columns.';
  } else {
    result.matches.forEach((columnIndex, matchIndex) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `column-search-option-${columnIndex}`;
      option.className = 'column-search-option';
      option.dataset.matchIndex = String(matchIndex);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(matchIndex === activeColumnMatch));
      option.setAttribute('aria-posinset', String(matchIndex + 1));
      option.setAttribute('aria-setsize', String(result.total));
      option.tabIndex = -1;
      const name = document.createElement('span');
      name.className = 'column-search-name';
      name.title = currentDataset.columns[columnIndex];
      appendHighlightedText(name, currentDataset.columns[columnIndex], query);
      const type = document.createElement('span');
      type.className = 'column-search-type';
      type.textContent = currentDataset.profiles[columnIndex]?.type ?? 'text';
      option.append(name, type);
      option.addEventListener('click', () => goToColumn(columnIndex));
      fragment.appendChild(option);
    });
    if (result.total > result.matches.length) {
      const remaining = document.createElement('div');
      remaining.className = 'column-search-more';
      remaining.textContent =
        `${formatNumber(result.total - result.matches.length)} more matching columns`;
      fragment.appendChild(remaining);
    }
    elements.columnSearchStatus.textContent =
      `${formatNumber(result.total)} matching ${result.total === 1 ? 'column' : 'columns'}. ` +
      'Use the up and down arrow keys to choose, then press Enter.';
  }
  elements.columnSearchResults.appendChild(fragment);
  elements.columnSearchResults.classList.remove('hidden');
  elements.profileSearch.setAttribute('aria-expanded', 'true');
  updateActiveColumnMatch();
}

function handleColumnSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeColumnSearchResults();
    return;
  }
  if (event.key === 'Tab') {
    closeColumnSearchResults();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (columnSearchMatches.length === 0) return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    activeColumnMatch =
      (activeColumnMatch + direction + columnSearchMatches.length) %
      columnSearchMatches.length;
    updateActiveColumnMatch();
    return;
  }
  if (event.key === 'Enter' && columnSearchMatches.length > 0) {
    event.preventDefault();
    const matchPosition = activeColumnMatch >= 0 ? activeColumnMatch : 0;
    goToColumn(columnSearchMatches[matchPosition]);
  }
}

function updateActiveColumnMatch(): void {
  const options = elements.columnSearchResults.querySelectorAll<HTMLElement>(
    '.column-search-option'
  );
  options.forEach((option, index) => {
    const active = index === activeColumnMatch;
    option.setAttribute('aria-selected', String(active));
    if (active) {
      elements.profileSearch.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
  });
  if (activeColumnMatch < 0) elements.profileSearch.removeAttribute('aria-activedescendant');
}

function closeColumnSearchResults(): void {
  columnSearchMatches = [];
  activeColumnMatch = -1;
  elements.columnSearchResults.replaceChildren();
  elements.columnSearchResults.classList.add('hidden');
  elements.columnSearchStatus.textContent = '';
  elements.profileSearch.setAttribute('aria-expanded', 'false');
  elements.profileSearch.removeAttribute('aria-activedescendant');
}

function appendHighlightedText(container: HTMLElement, value: string, query: string): void {
  const normalizedQuery = query.trim().toLowerCase();
  const matchStart = value.toLowerCase().indexOf(normalizedQuery);
  if (!normalizedQuery || matchStart < 0) {
    container.textContent = value;
    return;
  }
  container.append(document.createTextNode(value.slice(0, matchStart)));
  const mark = document.createElement('mark');
  mark.textContent = value.slice(matchStart, matchStart + normalizedQuery.length);
  container.append(mark, document.createTextNode(value.slice(matchStart + normalizedQuery.length)));
}

function goToColumn(columnIndex: number): void {
  if (!dataset || columnIndex < 0 || columnIndex >= dataset.columns.length) return;
  const columnName = dataset.columns[columnIndex];
  elements.profileSearch.value = columnName;
  closeColumnSearchResults();
  const viewportWidth = Math.max(0, elements.tableScroll.clientWidth - ROW_INDEX_WIDTH);
  const target = centeredColumnScrollOffset(
    dataset.columns.map((_column, index) => columnWidth(index)),
    columnIndex,
    viewportWidth
  );
  elements.tableScroll.scrollLeft = target;
  elements.profiles.scrollLeft = target;
  renderVirtualViewport();
  elements.tableScroll.scrollIntoView({
    block: 'nearest',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  });
  elements.columnSearchStatus.textContent = `Moved to column ${columnName}.`;
  window.requestAnimationFrame(() => highlightColumnHeader(columnIndex));
}

function setSharedHorizontalScroll(scrollLeft: number): void {
  const maximum = Math.max(
    0,
    elements.tableScroll.scrollWidth - elements.tableScroll.clientWidth
  );
  const next = Math.max(0, Math.min(scrollLeft, maximum));
  elements.tableScroll.scrollLeft = next;
  elements.profiles.scrollLeft = next;
  renderVirtualViewport();
}

function highlightColumnHeader(columnIndex: number): void {
  const header = elements.tableHead.querySelector<HTMLElement>(
    `.virtual-header-cell[data-column-index="${columnIndex}"]`
  );
  if (!header) return;
  window.clearTimeout(columnHighlightTimer);
  header.classList.add('column-jump-target');
  header.querySelector<HTMLButtonElement>('.column-button')?.focus({ preventScroll: true });
  columnHighlightTimer = window.setTimeout(
    () => header.classList.remove('column-jump-target'),
    1_400
  );
}

function renderTable(): void {
  if (!dataset) return;
  virtualRows = applyTableView(dataset, tableState);
  virtualRowIndexes = virtualRows.map((item) => item.index);
  virtualColumnOrder = Array.from({ length: dataset.columns.length }, (_, index) => index);
  virtualColumnWidths = virtualColumnOrder.map(columnWidth);
  const selection = ensureValidSelection(virtualRowIndexes, virtualColumnOrder);
  const contentWidth = ROW_INDEX_WIDTH + virtualColumnWidths.reduce(
    (width, columnWidthValue) => width + columnWidthValue,
    0
  );
  elements.tableSurface.style.width = `${Math.max(contentWidth, elements.tableScroll.clientWidth)}px`;
  elements.tableSurface.style.height = `${VIRTUAL_HEADER_HEIGHT + virtualRows.length * VIRTUAL_ROW_HEIGHT}px`;
  elements.tableScroll.setAttribute('aria-rowcount', String(dataset.rows.length + 1));
  elements.tableScroll.setAttribute('aria-colcount', String(dataset.columns.length + 1));
  elements.empty.classList.toggle('hidden', virtualRows.length !== 0);
  renderCellDetail(selection);
  renderFilterChips();
  const viewIsFiltered = tableState.query.trim().length > 0 || tableState.filters.length > 0;
  elements.resultCount.textContent = viewIsFiltered
    ? `${formatNumber(virtualRows.length)} matching preview rows.`
    : `${formatNumber(virtualRows.length)} preview rows.`;
  renderedRows = { start: -1, end: -1 };
  renderedColumns = '';
  renderProfiles();
  renderVirtualViewport();
}

function renderVirtualViewport(): void {
  if (!dataset) return;
  const rowRange = calculateVirtualRange(
    virtualRows.length,
    VIRTUAL_ROW_HEIGHT,
    elements.tableScroll.scrollTop,
    Math.max(0, elements.tableScroll.clientHeight - VIRTUAL_HEADER_HEIGHT)
  );
  const columnRange = calculateVirtualColumns(
    virtualColumnWidths,
    elements.tableScroll.scrollLeft,
    Math.max(0, elements.tableScroll.clientWidth - ROW_INDEX_WIDTH),
    VIRTUAL_OVERSCAN
  );
  const columnSignature = [
    columnRange.start,
    columnRange.end,
    columnRange.before,
    columnRange.after
  ].join(':');
  if (columnSignature !== renderedColumns) {
    renderedColumns = columnSignature;
    renderHeaders(columnRange);
  }
  if (
    rowRange.start !== renderedRows.start ||
    rowRange.end !== renderedRows.end ||
    columnSignature !== elements.tableBody.dataset.columnSignature
  ) {
    renderedRows = rowRange;
    elements.tableBody.dataset.columnSignature = columnSignature;
    reconcileVirtualRows(rowRange, columnRange);
  }
}

function reconcileVirtualRows(rowRange: VirtualRange, columnRange: VirtualColumnRange): void {
  const count = rowRange.end - rowRange.start;
  const scrollingColumns = virtualColumnOrder.slice(columnRange.start, columnRange.end);
  while (elements.tableBody.children.length < count) {
    const row = document.createElement('div');
    row.className = 'virtual-row';
    row.setAttribute('role', 'row');
    elements.tableBody.appendChild(row);
  }
  while (elements.tableBody.children.length > count) {
    elements.tableBody.lastElementChild?.remove();
  }
  for (let slot = 0; slot < count; slot += 1) {
    const itemPosition = rowRange.start + slot;
    const item = virtualRows[itemPosition];
    const row = elements.tableBody.children[slot] as HTMLElement;
    row.style.top = `${VIRTUAL_HEADER_HEIGHT + itemPosition * VIRTUAL_ROW_HEIGHT}px`;
    row.style.height = `${VIRTUAL_ROW_HEIGHT}px`;
    row.dataset.rowIndex = String(item.index);
    row.setAttribute('aria-rowindex', String(item.index + 2));
    renderVirtualRow(row, item, columnRange, scrollingColumns);
  }
}

function renderVirtualRow(
  row: HTMLElement,
  item: IndexedRow,
  columnRange: VirtualColumnRange,
  scrollingColumns: number[]
): void {
  const required = scrollingColumns.length + 3;
  while (row.children.length < required) row.appendChild(document.createElement('div'));
  while (row.children.length > required) row.lastElementChild?.remove();
  let childIndex = 0;
  const indexCell = row.children[childIndex++] as HTMLElement;
  resetVirtualElement(indexCell, 'virtual-cell row-index');
  setElementWidth(indexCell, ROW_INDEX_WIDTH);
  indexCell.textContent = String(item.index + 1);
  indexCell.setAttribute('role', 'rowheader');
  configureSpacer(row.children[childIndex++] as HTMLElement, columnRange.before);
  for (const columnIndex of scrollingColumns) {
    configureDataCell(row.children[childIndex++] as HTMLElement, item, columnIndex);
  }
  configureSpacer(row.children[childIndex] as HTMLElement, columnRange.after);
}

function configureDataCell(
  cell: HTMLElement,
  item: IndexedRow,
  columnIndex: number
): void {
  if (!dataset) return;
  const selection = tableState.ui?.selectedCell;
  const selected = selection?.rowIndex === item.index && selection.columnIndex === columnIndex;
  resetVirtualElement(cell, `virtual-cell${selected ? ' selected' : ''}`);
  cell.dataset.type = dataset.profiles[columnIndex]?.type ?? 'text';
  cell.dataset.rowIndex = String(item.index);
  cell.dataset.columnIndex = String(columnIndex);
  setElementWidth(cell, columnWidth(columnIndex));
  cell.setAttribute('role', 'gridcell');
  cell.setAttribute('aria-colindex', String(columnIndex + 2));
  cell.setAttribute('aria-selected', String(selected));
  cell.tabIndex = selected ? 0 : -1;
  renderCell(cell, item.row[columnIndex] ?? null);
}

function resetVirtualElement(element: HTMLElement, className: string): void {
  element.className = className;
  element.textContent = '';
  element.removeAttribute('style');
  element.removeAttribute('title');
  element.removeAttribute('aria-hidden');
  element.removeAttribute('aria-colindex');
  element.removeAttribute('aria-selected');
  element.removeAttribute('role');
  element.removeAttribute('data-type');
  element.removeAttribute('data-row-index');
  element.removeAttribute('data-column-index');
  element.tabIndex = -1;
}

function configureSpacer(element: HTMLElement, width: number): void {
  resetVirtualElement(element, 'virtual-spacer');
  setElementWidth(element, width);
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('role', 'presentation');
}

function setElementWidth(element: HTMLElement, width: number): void {
  element.style.width = `${width}px`;
  element.style.minWidth = `${width}px`;
  element.style.maxWidth = `${width}px`;
  element.style.flexBasis = `${width}px`;
}

function renderCell(cell: HTMLElement, value: SerializableCell): void {
  if (value === null) {
    cell.classList.add('null');
    cell.textContent = 'null';
    return;
  }
  const text = String(value);
  cell.textContent = text;
  cell.title = text;
}

function renderHeaders(columnRange: VirtualColumnRange): void {
  if (!dataset) return;
  elements.tableHead.replaceChildren();
  const indexHeader = document.createElement('div');
  indexHeader.className = 'virtual-cell virtual-header-cell row-index';
  setElementWidth(indexHeader, ROW_INDEX_WIDTH);
  indexHeader.textContent = '#';
  indexHeader.setAttribute('role', 'columnheader');
  elements.tableHead.appendChild(indexHeader);
  const before = document.createElement('div');
  configureSpacer(before, columnRange.before);
  elements.tableHead.appendChild(before);
  for (const columnIndex of virtualColumnOrder.slice(columnRange.start, columnRange.end)) {
    elements.tableHead.appendChild(createHeaderCell(columnIndex));
  }
  const after = document.createElement('div');
  configureSpacer(after, columnRange.after);
  elements.tableHead.appendChild(after);
}

function createHeaderCell(columnIndex: number): HTMLElement {
  if (!dataset) throw new Error('Cannot render a header without a dataset.');
  const column = dataset.columns[columnIndex];
  const header = document.createElement('div');
  header.className = 'virtual-cell virtual-header-cell';
  header.dataset.columnIndex = String(columnIndex);
  applyColumnDimensions(header, columnIndex);
  header.setAttribute('role', 'columnheader');
  header.setAttribute('aria-colindex', String(columnIndex + 2));
  const controls = document.createElement('div');
  controls.className = 'column-controls';

    const sortButton = document.createElement('button');
    sortButton.type = 'button';
    sortButton.className = 'column-button';
    sortButton.setAttribute('aria-label', `Sort by ${column}`);
    const label = document.createElement('span');
    label.textContent = column;
    label.title = column;
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    const sort = tableState.sort;
    arrow.textContent =
      sort?.columnIndex === columnIndex ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
    sortButton.append(label, arrow);
    sortButton.addEventListener('click', () => {
      const current = tableState.sort;
      tableState = {
        ...tableState,
        sort: {
          columnIndex,
          direction:
            current?.columnIndex === columnIndex && current.direction === 'asc' ? 'desc' : 'asc'
        }
      };
      resetTablePosition();
      persistState();
      renderTable();
    });

    const filterButton = document.createElement('button');
    filterButton.type = 'button';
    filterButton.className = 'filter-button';
    if (tableState.filters.some((filter) => filter.columnIndex === columnIndex)) {
      filterButton.classList.add('active');
    }
    filterButton.title = `Filter ${column}`;
    filterButton.setAttribute('aria-label', `Filter ${column}`);
    filterButton.setAttribute('aria-controls', 'filter-panel');
    filterButton.setAttribute('aria-expanded', String(activeFilterColumn === columnIndex));
    filterButton.addEventListener('click', () => {
      if (activeFilterColumn === columnIndex) closeFilterPanel();
      else openFilterPanel(columnIndex);
    });

    const resizeHandle = document.createElement('span');
    resizeHandle.className = 'resize-handle';
    resizeHandle.tabIndex = 0;
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-orientation', 'vertical');
    resizeHandle.setAttribute('aria-label', `Resize ${column}`);
    resizeHandle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidth(columnIndex);
      let nextWidth = startWidth;
      let pointerFrame = 0;
      resizeHandle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent): void => {
        nextWidth = startWidth + moveEvent.clientX - startX;
        if (pointerFrame) return;
        pointerFrame = window.requestAnimationFrame(() => {
          pointerFrame = 0;
          setColumnWidth(columnIndex, nextWidth, false);
        });
      };
      const finish = (): void => {
        resizeHandle.removeEventListener('pointermove', move);
        resizeHandle.removeEventListener('pointerup', finish);
        resizeHandle.removeEventListener('pointercancel', finish);
        if (pointerFrame) {
          window.cancelAnimationFrame(pointerFrame);
          pointerFrame = 0;
        }
        setColumnWidth(columnIndex, nextWidth, false);
        persistState();
        renderTable();
      };
      resizeHandle.addEventListener('pointermove', move);
      resizeHandle.addEventListener('pointerup', finish);
      resizeHandle.addEventListener('pointercancel', finish);
    });
    resizeHandle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      setColumnWidth(
        columnIndex,
        columnWidth(columnIndex) + direction * (event.shiftKey ? 40 : 10),
        false
      );
      persistState();
      renderTable();
    });
    resizeHandle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setColumnWidth(
        columnIndex,
        estimateColumnWidth(
          column,
          virtualRows
            .slice(Math.max(0, renderedRows.start), Math.max(0, renderedRows.end))
            .map((item) => item.row[columnIndex] ?? null)
        )
      );
    });

  controls.append(sortButton, filterButton, resizeHandle);
  header.appendChild(controls);
  return header;
}

function columnWidth(columnIndex: number): number {
  return tableState.ui?.columnWidths?.[String(columnIndex)] ?? DEFAULT_COLUMN_WIDTH;
}

function setColumnWidth(columnIndex: number, width: number, render = true): void {
  const nextWidth = clampColumnWidth(width);
  updateUi(
    {
      columnWidths: {
        ...(tableState.ui?.columnWidths ?? {}),
        [String(columnIndex)]: nextWidth
      }
    },
    render,
    render
  );
  if (!render) {
    document.querySelectorAll<HTMLElement>(`[data-column-index="${columnIndex}"]`).forEach(
      (element) => {
        element.style.width = `${nextWidth}px`;
        element.style.flexBasis = `${nextWidth}px`;
        if (element.tagName !== 'COL') {
          element.style.minWidth = `${nextWidth}px`;
          element.style.maxWidth = `${nextWidth}px`;
        }
      }
    );
  }
}

function applyColumnDimensions(element: HTMLElement, columnIndex: number): void {
  const width = `${columnWidth(columnIndex)}px`;
  element.style.width = width;
  element.style.flexBasis = width;
  element.style.minWidth = width;
  element.style.maxWidth = width;
}

function ensureValidSelection(rowOrder: number[], columnOrder: number[]): CellSelection | undefined {
  if (!rowOrder.length || !columnOrder.length) return undefined;
  const current = tableState.ui?.selectedCell;
  const selection =
    current && rowOrder.includes(current.rowIndex) && columnOrder.includes(current.columnIndex)
      ? current
      : { rowIndex: rowOrder[0], columnIndex: columnOrder[0] };
  if (
    current?.rowIndex !== selection.rowIndex ||
    current?.columnIndex !== selection.columnIndex
  ) {
    updateUi({ selectedCell: selection }, false);
  }
  return selection;
}

function selectCell(selection: CellSelection, focus = false): void {
  if (!dataset) return;
  const rowPosition = virtualRows.findIndex((item) => item.index === selection.rowIndex);
  if (rowPosition < 0 || !virtualColumnOrder.includes(selection.columnIndex)) return;
  updateUi({ selectedCell: selection }, false);
  scrollSelectionIntoView(selection, rowPosition);
  renderedRows = { start: -1, end: -1 };
  renderVirtualViewport();
  renderCellDetail(selection);
  if (focus) {
    window.requestAnimationFrame(() => {
      elements.tableBody
        .querySelector<HTMLElement>(
          `[data-row-index="${selection.rowIndex}"][data-column-index="${selection.columnIndex}"]`
        )
        ?.focus();
    });
  }
}

function scrollSelectionIntoView(selection: CellSelection, rowPosition: number): void {
  const rowTop = VIRTUAL_HEADER_HEIGHT + rowPosition * VIRTUAL_ROW_HEIGHT;
  const rowBottom = rowTop + VIRTUAL_ROW_HEIGHT;
  const visibleTop = elements.tableScroll.scrollTop + VIRTUAL_HEADER_HEIGHT;
  const visibleBottom = elements.tableScroll.scrollTop + elements.tableScroll.clientHeight;
  if (rowTop < visibleTop) {
    elements.tableScroll.scrollTop = Math.max(0, rowTop - VIRTUAL_HEADER_HEIGHT);
  } else if (rowBottom > visibleBottom) {
    elements.tableScroll.scrollTop = rowBottom - elements.tableScroll.clientHeight;
  }

  const columnPosition = virtualColumnOrder.indexOf(selection.columnIndex);
  if (columnPosition < 0) return;
  const columnStart = virtualColumnOrder
    .slice(0, columnPosition)
    .reduce((width, columnIndex) => width + columnWidth(columnIndex), 0);
  const columnEnd = columnStart + columnWidth(selection.columnIndex);
  const visibleWidth = Math.max(0, elements.tableScroll.clientWidth - ROW_INDEX_WIDTH);
  if (columnStart < elements.tableScroll.scrollLeft) {
    elements.tableScroll.scrollLeft = columnStart;
  } else if (columnEnd > elements.tableScroll.scrollLeft + visibleWidth) {
    elements.tableScroll.scrollLeft = Math.max(0, columnEnd - visibleWidth);
  }
}

function handleCellKeydown(event: KeyboardEvent): void {
  if (!dataset || !isNavigationKey(event.key)) return;
  const selection = tableState.ui?.selectedCell;
  if (!selection) return;
  event.preventDefault();
  const next = navigateSelection(
    selection,
    event.key,
    virtualRowIndexes,
    virtualColumnOrder,
    Math.max(
      1,
      Math.floor(
        (elements.tableScroll.clientHeight - VIRTUAL_HEADER_HEIGHT) / VIRTUAL_ROW_HEIGHT
      )
    )
  );
  selectCell(next, true);
}

function isNavigationKey(value: string): value is NavigationKey {
  return [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown'
  ].includes(value);
}

function renderCellDetail(selection: CellSelection | undefined): void {
  if (!dataset || !selection) {
    elements.cellDetail.classList.add('hidden');
    return;
  }
  const value = dataset.rows[selection.rowIndex]?.[selection.columnIndex] ?? null;
  const type = dataset.profiles[selection.columnIndex]?.type ?? 'text';
  elements.cellDetailTitle.textContent = dataset.columns[selection.columnIndex];
  elements.cellDetailType.className = `type type-${type}`;
  elements.cellDetailType.textContent = type;
  elements.cellDetailNull.classList.toggle('hidden', value !== null);
  elements.cellDetailValue.textContent = formatCellDetail(value);
  elements.cellDetail.classList.remove('hidden');
}

function requestCopy(kind: CopyKind): void {
  const selection = tableState.ui?.selectedCell;
  if (!selection) return;
  vscode.postMessage({ type: 'copy', kind, ...selection });
}

function showOperationStatus(message: string, success: boolean): void {
  window.clearTimeout(statusTimer);
  elements.operationStatus.textContent = message;
  elements.operationStatus.classList.toggle('error-status', !success);
  elements.operationStatus.classList.remove('hidden');
  statusTimer = window.setTimeout(() => elements.operationStatus.classList.add('hidden'), 3_000);
}

function updateUi(
  patch: NonNullable<TableViewState['ui']>,
  render = false,
  persist = true
): void {
  tableState = { ...tableState, ui: { ...tableState.ui, ...patch } };
  if (persist) persistState();
  if (render) renderTable();
}

function openFilterPanel(columnIndex: number): void {
  if (!dataset || columnIndex < 0 || columnIndex >= dataset.columns.length) return;
  activeFilterColumn = columnIndex;
  elements.filterTitle.textContent = `Filter ${dataset.columns[columnIndex]}`;
  elements.filterOperator.replaceChildren();
  const type = dataset.profiles[columnIndex]?.type ?? 'text';
  for (const operator of operatorsForType(type)) {
    const option = document.createElement('option');
    option.value = operator;
    option.textContent = OPERATOR_LABELS[operator];
    elements.filterOperator.appendChild(option);
  }
  elements.filterValue.value = '';
  elements.filterSecondValue.value = '';
  clearFilterError();
  renderFilterValueFields();
  elements.filterPanel.classList.remove('hidden');
  document.querySelectorAll<HTMLButtonElement>('.filter-button').forEach((button) => {
    const header = button.closest<HTMLElement>('[data-column-index]');
    button.setAttribute('aria-expanded', String(Number(header?.dataset.columnIndex) === columnIndex));
  });
  window.requestAnimationFrame(() => {
    elements.filterPanel.scrollIntoView({ block: 'nearest' });
  });
  if (operatorNeedsValue(selectedOperator())) elements.filterValue.focus();
  else elements.filterOperator.focus();
}

function closeFilterPanel(): void {
  activeFilterColumn = null;
  clearFilterError();
  elements.filterPanel.classList.add('hidden');
  document.querySelectorAll<HTMLButtonElement>('.filter-button').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function renderFilterValueFields(): void {
  const operator = selectedOperator();
  const needsValue = operatorNeedsValue(operator);
  elements.filterFields.classList.toggle('no-value', !needsValue);
  elements.filterFields.classList.toggle('between', operator === 'between');
  elements.filterValueWrap.classList.toggle('hidden', !needsValue);
  elements.filterSecondValueWrap.classList.toggle('hidden', operator !== 'between');
  clearFilterError();
}

function applyFilter(): void {
  if (!dataset || activeFilterColumn === null) return;
  const type = dataset.profiles[activeFilterColumn]?.type ?? 'text';
  const operator = selectedOperator();
  const filter: ColumnFilter = {
    id: `filter-${Date.now().toString(36)}-${filterSequence++}`,
    columnIndex: activeFilterColumn,
    operator,
    ...(operatorNeedsValue(operator) ? { value: elements.filterValue.value } : {}),
    ...(operator === 'between' ? { secondValue: elements.filterSecondValue.value } : {})
  };
  const validationError = filterValidationError(filter, type);
  if (validationError) {
    showFilterError(validationError);
    return;
  }
  tableState = { ...tableState, filters: [...tableState.filters, filter] };
  resetTablePosition();
  closeFilterPanel();
  persistState();
  renderTable();
}

function renderFilterChips(): void {
  if (!dataset) return;
  elements.filterChips.replaceChildren();
  for (const filter of tableState.filters) {
    const chip = document.createElement('span');
    chip.className = 'filter-chip';
    const description = document.createElement('span');
    description.textContent = describeFilter(filter);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove filter ${description.textContent}`);
    remove.addEventListener('click', () => {
      tableState = {
        ...tableState,
        filters: tableState.filters.filter((candidate) => candidate.id !== filter.id)
      };
      resetTablePosition();
      persistState();
      renderTable();
    });
    chip.append(description, remove);
    elements.filterChips.appendChild(chip);
  }
  elements.activeFilters.classList.toggle('hidden', tableState.filters.length === 0);
}

function describeFilter(filter: ColumnFilter): string {
  if (!dataset) return '';
  const column = dataset.columns[filter.columnIndex] ?? `Column ${filter.columnIndex + 1}`;
  const operator = OPERATOR_LABELS[filter.operator];
  if (!operatorNeedsValue(filter.operator)) return `${column}: ${operator}`;
  if (filter.operator === 'between') {
    return `${column}: ${operator} ${filter.value ?? ''} and ${filter.secondValue ?? ''}`;
  }
  return `${column}: ${operator} ${filter.value ?? ''}`;
}

function showFilterError(message: string): void {
  elements.filterError.textContent = message;
  elements.filterError.classList.remove('hidden');
  elements.filterValue.setAttribute('aria-invalid', 'true');
  elements.filterSecondValue.setAttribute('aria-invalid', 'true');
}

function clearFilterError(): void {
  elements.filterError.textContent = '';
  elements.filterError.classList.add('hidden');
  elements.filterValue.removeAttribute('aria-invalid');
  elements.filterSecondValue.removeAttribute('aria-invalid');
}

function selectedOperator(): FilterOperator {
  return elements.filterOperator.value as FilterOperator;
}

function resetTablePosition(): void {
  elements.tableScroll.scrollTop = 0;
  elements.tableScroll.scrollLeft = 0;
  tableState = {
    ...tableState,
    ui: { ...tableState.ui, selectedCell: undefined }
  };
}

function persistState(): void {
  if (!dataset) return;
  vscode.setState({ datasetSignature: currentDatasetSignature, table: tableState });
}

function datasetSignature(value: DatasetPreview): string {
  return JSON.stringify([value.fileName, value.format, value.sheet ?? '', value.columns]);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing webview element: ${id}`);
  return element as T;
}

function isHostMessage(value: unknown): value is HostToWebviewMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'loading') return true;
  if (message.type === 'error') return typeof message.message === 'string';
  if (message.type === 'profileProgress') {
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
  if (message.type === 'profileError') {
    return typeof message.message === 'string' && message.message.length <= 256;
  }
  if (message.type === 'profiles') {
    return (
      typeof message.payload === 'object' &&
      message.payload !== null &&
      Array.isArray((message.payload as Record<string, unknown>).profiles) &&
      typeof (message.payload as Record<string, unknown>).rowCount === 'number'
    );
  }
  if (message.type === 'operationResult') {
    return (
      (message.operation === 'copy' || message.operation === 'parsing') &&
      typeof message.success === 'boolean' &&
      typeof message.message === 'string' &&
      message.message.length <= 256
    );
  }
  return (
    message.type === 'dataset' &&
    typeof message.payload === 'object' &&
    message.payload !== null
  );
}

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

function formatCompact(value: string | number): string {
  return typeof value === 'number'
    ? COMPACT_NUMBER_FORMATTER.format(value)
    : String(value);
}

function formatPercent(value: number): string {
  return PERCENT_FORMATTER.format(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

vscode.postMessage({ type: 'ready' });
