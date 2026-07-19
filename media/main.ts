import {
  EMPTY_TABLE_VIEW_STATE,
  applyTableView,
  filterValidationError,
  normalizeTableViewState,
  operatorNeedsValue,
  operatorsForType
} from '../src/tableState';
import {
  ColumnFilter,
  DatasetPreview,
  FilterOperator,
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

type HostMessage =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'dataset'; payload: DatasetPreview };

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
  pageSize: requiredElement<HTMLSelectElement>('page-size'),
  profiles: requiredElement<HTMLElement>('profiles'),
  profilesNote: requiredElement<HTMLElement>('profiles-note'),
  tableHead: requiredElement<HTMLElement>('table-head'),
  tableBody: requiredElement<HTMLElement>('table-body'),
  empty: requiredElement<HTMLElement>('empty'),
  resultCount: requiredElement<HTMLElement>('result-count'),
  previous: requiredElement<HTMLButtonElement>('previous'),
  next: requiredElement<HTMLButtonElement>('next'),
  pageLabel: requiredElement<HTMLElement>('page-label'),
  filterPanel: requiredElement<HTMLElement>('filter-panel'),
  filterTitle: requiredElement<HTMLElement>('filter-title'),
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
  clearFilters: requiredElement<HTMLButtonElement>('clear-filters')
};

let dataset: DatasetPreview | null = null;
let tableState: TableViewState = { ...EMPTY_TABLE_VIEW_STATE, filters: [] };
let page = 0;
let searchTimer = 0;
let activeFilterColumn: number | null = null;
let filterSequence = 0;

elements.reload.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
elements.search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    tableState = { ...tableState, query: elements.search.value };
    page = 0;
    persistState();
    renderTable();
  }, 120);
});
elements.pageSize.addEventListener('change', () => {
  tableState = { ...tableState, ui: { ...tableState.ui, pageSize: currentPageSize() } };
  page = 0;
  persistState();
  renderTable();
});
elements.sheet.addEventListener('change', () => {
  vscode.postMessage({ type: 'selectSheet', sheet: elements.sheet.value });
});
elements.previous.addEventListener('click', () => {
  page = Math.max(0, page - 1);
  renderTable();
});
elements.next.addEventListener('click', () => {
  page += 1;
  renderTable();
});
elements.filterOperator.addEventListener('change', renderFilterValueFields);
elements.filterApply.addEventListener('click', applyFilter);
elements.filterCancel.addEventListener('click', closeFilterPanel);
elements.clearFilters.addEventListener('click', () => {
  tableState = { ...tableState, filters: [] };
  page = 0;
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
  } else {
    receiveDataset(message.payload);
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
  const signature = datasetSignature(nextDataset);
  const persisted = vscode.getState();
  tableState =
    persisted?.datasetSignature === signature
      ? normalizeTableViewState(persisted.table, nextDataset)
      : { ...EMPTY_TABLE_VIEW_STATE, filters: [] };
  page = 0;
  activeFilterColumn = null;
  elements.search.value = tableState.query;
  elements.pageSize.value = String(tableState.ui?.pageSize ?? 50);
  closeFilterPanel();
  persistState();
  renderDataset();
}

function renderDataset(): void {
  if (!dataset) return;
  elements.loading.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.workspace.classList.remove('hidden');
  elements.fileName.textContent = dataset.fileName;
  renderMetadata();
  renderSheetPicker();
  renderProfiles();
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

function renderProfiles(): void {
  if (!dataset) return;
  elements.profiles.replaceChildren();
  const visibleProfiles = dataset.profiles.slice(0, 12);
  elements.profilesNote.textContent =
    dataset.profiles.length > 12 ? `Showing 12 of ${dataset.profiles.length}` : '';
  for (const profile of visibleProfiles) {
    const card = document.createElement('article');
    card.className = 'profile-card';
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
    addStat(stats, 'Non-null', formatNumber(profile.nonNull));
    addStat(stats, 'Missing', formatNumber(profile.missing));
    addStat(stats, 'Distinct', formatNumber(profile.distinct));
    if (profile.mean !== undefined) addStat(stats, 'Mean', formatCompact(profile.mean));
    if (profile.min !== undefined) addStat(stats, 'Min', formatCompact(profile.min));
    if (profile.max !== undefined) addStat(stats, 'Max', formatCompact(profile.max));
    card.appendChild(stats);
    elements.profiles.appendChild(card);
  }
}

function addStat(list: HTMLElement, label: string, value: string): void {
  const term = document.createElement('dt');
  term.textContent = label;
  const definition = document.createElement('dd');
  definition.textContent = value;
  definition.title = value;
  list.append(term, definition);
}

function renderTable(): void {
  if (!dataset) return;
  const filtered = applyTableView(dataset, tableState);
  const pageSize = currentPageSize();
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  page = Math.min(page, pageCount - 1);
  const start = page * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  renderHeaders();
  renderFilterChips();
  elements.tableBody.replaceChildren();
  for (const item of visible) {
    const rowElement = document.createElement('tr');
    const indexCell = document.createElement('td');
    indexCell.className = 'row-index';
    indexCell.textContent = String(item.index + 1);
    rowElement.appendChild(indexCell);
    item.row.forEach((value, columnIndex) => {
      const cell = document.createElement('td');
      cell.dataset.type = dataset?.profiles[columnIndex]?.type ?? 'text';
      renderCell(cell, value);
      rowElement.appendChild(cell);
    });
    elements.tableBody.appendChild(rowElement);
  }

  elements.empty.classList.toggle('hidden', filtered.length !== 0);
  const viewIsFiltered = tableState.query.trim().length > 0 || tableState.filters.length > 0;
  elements.resultCount.textContent = viewIsFiltered
    ? `${formatNumber(filtered.length)} matching preview rows.`
    : `${formatNumber(filtered.length)} preview rows.`;
  elements.pageLabel.textContent = `Page ${page + 1} of ${pageCount}`;
  elements.previous.disabled = page === 0;
  elements.next.disabled = page >= pageCount - 1;
}

function renderCell(cell: HTMLTableCellElement, value: SerializableCell): void {
  if (value === null) {
    cell.classList.add('null');
    cell.textContent = 'null';
    return;
  }
  const text = String(value);
  cell.textContent = text;
  cell.title = text;
}

function renderHeaders(): void {
  if (!dataset) return;
  elements.tableHead.replaceChildren();
  const row = document.createElement('tr');
  const indexHeader = document.createElement('th');
  indexHeader.className = 'row-index';
  indexHeader.textContent = '#';
  row.appendChild(indexHeader);

  dataset.columns.forEach((column, columnIndex) => {
    const header = document.createElement('th');
    const controls = document.createElement('div');
    controls.className = 'column-controls';

    const sortButton = document.createElement('button');
    sortButton.type = 'button';
    sortButton.className = 'column-button';
    sortButton.setAttribute('aria-label', `Sort by ${column}`);
    const label = document.createElement('span');
    label.textContent = column;
    label.title = column;
    const type = document.createElement('small');
    type.textContent = dataset?.profiles[columnIndex]?.type ?? 'text';
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    const sort = tableState.sort;
    arrow.textContent =
      sort?.columnIndex === columnIndex ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
    sortButton.append(label, type, arrow);
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
      page = 0;
      persistState();
      renderTable();
    });

    const filterButton = document.createElement('button');
    filterButton.type = 'button';
    filterButton.className = 'filter-button';
    if (tableState.filters.some((filter) => filter.columnIndex === columnIndex)) {
      filterButton.classList.add('active');
    }
    filterButton.textContent = '⌄';
    filterButton.title = `Filter ${column}`;
    filterButton.setAttribute('aria-label', `Filter ${column}`);
    filterButton.addEventListener('click', () => openFilterPanel(columnIndex));

    controls.append(sortButton, filterButton);
    header.appendChild(controls);
    row.appendChild(header);
  });
  elements.tableHead.appendChild(row);
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
  if (operatorNeedsValue(selectedOperator())) elements.filterValue.focus();
  else elements.filterOperator.focus();
}

function closeFilterPanel(): void {
  activeFilterColumn = null;
  clearFilterError();
  elements.filterPanel.classList.add('hidden');
}

function renderFilterValueFields(): void {
  const operator = selectedOperator();
  const needsValue = operatorNeedsValue(operator);
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
  page = 0;
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
      page = 0;
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

function currentPageSize(): 25 | 50 | 100 | 250 {
  const value = Number(elements.pageSize.value);
  return value === 25 || value === 100 || value === 250 ? value : 50;
}

function persistState(): void {
  if (!dataset) return;
  vscode.setState({ datasetSignature: datasetSignature(dataset), table: tableState });
}

function datasetSignature(value: DatasetPreview): string {
  return JSON.stringify([value.fileName, value.format, value.sheet ?? '', value.columns]);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing webview element: ${id}`);
  return element as T;
}

function isHostMessage(value: unknown): value is HostMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'loading') return true;
  if (message.type === 'error') return typeof message.message === 'string';
  return message.type === 'dataset' && typeof message.payload === 'object' && message.payload !== null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCompact(value: string | number): string {
  return typeof value === 'number'
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)
    : String(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

vscode.postMessage({ type: 'ready' });
