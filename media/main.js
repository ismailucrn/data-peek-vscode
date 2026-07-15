(function () {
  const vscode = acquireVsCodeApi();
  const elements = {
    fileName: document.getElementById('file-name'),
    metadata: document.getElementById('metadata'),
    error: document.getElementById('error'),
    loading: document.getElementById('loading'),
    workspace: document.getElementById('workspace'),
    reload: document.getElementById('reload'),
    search: document.getElementById('search'),
    sheetWrap: document.getElementById('sheet-wrap'),
    sheet: document.getElementById('sheet'),
    pageSize: document.getElementById('page-size'),
    profiles: document.getElementById('profiles'),
    profilesNote: document.getElementById('profiles-note'),
    tableHead: document.getElementById('table-head'),
    tableBody: document.getElementById('table-body'),
    empty: document.getElementById('empty'),
    resultCount: document.getElementById('result-count'),
    previous: document.getElementById('previous'),
    next: document.getElementById('next'),
    pageLabel: document.getElementById('page-label')
  };

  let dataset = null;
  let query = '';
  let sortColumn = -1;
  let sortDirection = 1;
  let page = 0;
  let searchTimer = 0;

  elements.reload.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
  elements.search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      query = elements.search.value.trim().toLocaleLowerCase();
      page = 0;
      renderTable();
    }, 120);
  });
  elements.pageSize.addEventListener('change', () => {
    page = 0;
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

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'loading') {
      setLoading();
    } else if (message.type === 'error') {
      setError(message.message);
    } else if (message.type === 'dataset') {
      dataset = message.payload;
      query = '';
      sortColumn = -1;
      page = 0;
      elements.search.value = '';
      renderDataset();
    }
  });

  function setLoading() {
    elements.error.classList.add('hidden');
    elements.workspace.classList.add('hidden');
    elements.loading.classList.remove('hidden');
  }

  function setError(message) {
    elements.loading.classList.add('hidden');
    elements.workspace.classList.add('hidden');
    elements.error.textContent = message;
    elements.error.classList.remove('hidden');
  }

  function renderDataset() {
    elements.loading.classList.add('hidden');
    elements.error.classList.add('hidden');
    elements.workspace.classList.remove('hidden');
    elements.fileName.textContent = dataset.fileName;
    renderMetadata();
    renderSheetPicker();
    renderProfiles();
    renderTable();
  }

  function renderMetadata() {
    elements.metadata.replaceChildren();
    const total = dataset.totalRows === null ? `${formatNumber(dataset.previewRowCount)}+ rows` : `${formatNumber(dataset.totalRows)} rows`;
    const columnLabel = dataset.truncatedColumns
      ? `${formatNumber(dataset.columns.length)} of ${formatNumber(dataset.totalColumns)} columns`
      : `${formatNumber(dataset.columns.length)} columns`;
    const labels = [dataset.format, total, columnLabel, formatBytes(dataset.fileSize)];
    if (dataset.truncated) {
      labels.push(`Previewing first ${formatNumber(dataset.previewRowCount)}`);
    }
    for (const label of labels) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = label;
      elements.metadata.appendChild(badge);
    }
  }

  function renderSheetPicker() {
    const sheets = dataset.sheets || [];
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

  function renderProfiles() {
    elements.profiles.replaceChildren();
    const visibleProfiles = dataset.profiles.slice(0, 12);
    elements.profilesNote.textContent = dataset.profiles.length > 12 ? `Showing 12 of ${dataset.profiles.length}` : '';
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

  function addStat(list, label, value) {
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    definition.textContent = value;
    definition.title = value;
    list.append(term, definition);
  }

  function renderTable() {
    if (!dataset) return;
    const filtered = filteredRows();
    const pageSize = Number(elements.pageSize.value);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, pageCount - 1);
    const start = page * pageSize;
    const visible = filtered.slice(start, start + pageSize);

    renderHeaders();
    elements.tableBody.replaceChildren();
    for (const item of visible) {
      const rowElement = document.createElement('tr');
      const indexCell = document.createElement('td');
      indexCell.className = 'row-index';
      indexCell.textContent = String(item.index + 1);
      rowElement.appendChild(indexCell);
      item.row.forEach((value, columnIndex) => {
        const cell = document.createElement('td');
        cell.dataset.type = dataset.profiles[columnIndex]?.type || 'text';
        if (value === null) {
          cell.classList.add('null');
          cell.textContent = 'null';
        } else {
          const text = String(value);
          cell.textContent = text;
          cell.title = text;
        }
        rowElement.appendChild(cell);
      });
      elements.tableBody.appendChild(rowElement);
    }

    elements.empty.classList.toggle('hidden', filtered.length !== 0);
    elements.resultCount.textContent = query ? `${formatNumber(filtered.length)} matching preview rows` : `${formatNumber(filtered.length)} preview rows`;
    elements.pageLabel.textContent = `Page ${page + 1} of ${pageCount}`;
    elements.previous.disabled = page === 0;
    elements.next.disabled = page >= pageCount - 1;
  }

  function renderHeaders() {
    elements.tableHead.replaceChildren();
    const row = document.createElement('tr');
    const indexHeader = document.createElement('th');
    indexHeader.className = 'row-index';
    indexHeader.textContent = '#';
    row.appendChild(indexHeader);
    dataset.columns.forEach((column, columnIndex) => {
      const header = document.createElement('th');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'column-button';
      const label = document.createElement('span');
      label.textContent = column;
      label.title = column;
      const type = document.createElement('small');
      type.textContent = dataset.profiles[columnIndex]?.type || 'text';
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = sortColumn === columnIndex ? (sortDirection === 1 ? '↑' : '↓') : '↕';
      button.append(label, type, arrow);
      button.addEventListener('click', () => {
        if (sortColumn === columnIndex) {
          sortDirection *= -1;
        } else {
          sortColumn = columnIndex;
          sortDirection = 1;
        }
        page = 0;
        renderTable();
      });
      header.appendChild(button);
      row.appendChild(header);
    });
    elements.tableHead.appendChild(row);
  }

  function filteredRows() {
    const rows = dataset.rows.map((row, index) => ({ row, index }));
    const matching = query
      ? rows.filter((item) => item.row.some((value) => value !== null && String(value).toLocaleLowerCase().includes(query)))
      : rows;
    if (sortColumn < 0) return matching;
    return matching.sort((left, right) => compare(left.row[sortColumn], right.row[sortColumn]) * sortDirection);
  }

  function compare(left, right) {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(value);
  }

  function formatCompact(value) {
    if (typeof value === 'number') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
    return String(value);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  vscode.postMessage({ type: 'ready' });
})();
