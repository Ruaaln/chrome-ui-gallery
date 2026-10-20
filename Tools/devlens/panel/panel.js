/**
 * DevLens — Full Panel
 * Receives log events from background, renders DevTools-like table.
 */

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let allEntries   = [];
  let activeTab    = 'all';
  let filterText   = '';
  let selectedRow  = null;
  let paused       = false;
  let theme        = 'dark';
  let sourceTabId  = null;
  const counters   = { all: 0, error: 0, warn: 0, log: 0, network: 0 };

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const body       = document.body;
  const logBody    = document.getElementById('dl-log-body');
  const emptyEl    = document.getElementById('dl-empty');
  const detail     = document.getElementById('dl-detail');
  const detailTitle= document.getElementById('dl-detail-title');
  const detailBody = document.getElementById('dl-detail-body');
  const detailClose= document.getElementById('dl-detail-close');
  const searchEl   = document.getElementById('dl-search');
  const pageUrl    = document.getElementById('dl-page-url');
  const statusCount= document.getElementById('dl-status-count');
  const statusErrs = document.getElementById('dl-status-errors');
  const statusPaused= document.getElementById('dl-status-paused');
  const btnClear   = document.getElementById('btn-clear');
  const btnExport  = document.getElementById('btn-export');
  const btnPause   = document.getElementById('btn-pause');
  const btnTheme   = document.getElementById('btn-theme');

  // ── Tab counts ────────────────────────────────────────────────────────────
  const tabCounts = {
    all:     document.getElementById('cnt-all'),
    error:   document.getElementById('cnt-error'),
    warn:    document.getElementById('cnt-warn'),
    log:     document.getElementById('cnt-log'),
    network: document.getElementById('cnt-net')
  };

  // ── Receive initial dump from background ──────────────────────────────────
  chrome.runtime.sendMessage({ action: 'getPanelData' }, function (res) {
    if (chrome.runtime.lastError) return;
    if (res && typeof res.sourceTabId==='number') sourceTabId=res.sourceTabId;
    if (res && res.events) {
      res.events.forEach(addEntry);
    }
    if (res && res.url) pageUrl.textContent = res.url;
  });

  // ── Listen for live updates ───────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.action === 'newEntry' && !paused && msg.sourceTabId===sourceTabId) {
      addEntry(msg.entry);
    }
    if (msg.action === 'clearLogs' && msg.sourceTabId===sourceTabId) {
      clearAll();
    }
    if (msg.action==='panelSourceChanged') {
      sourceTabId=msg.sourceTabId;
      clearAll();
      (msg.events||[]).forEach(addEntry);
      pageUrl.textContent=msg.url||'—';
    }
  });

  // ── Core: add an entry ────────────────────────────────────────────────────
  function addEntry(entry) {
    // Merge network start/done phases
    if (entry.category === 'network' && entry.phase === 'start') {
      allEntries.push(entry);
      return; // not rendered until done/error
    }
    if (entry.category === 'network' && (entry.phase === 'done' || entry.phase === 'error')) {
      // Update existing start entry
      const idx = allEntries.findIndex(e => e.id === entry.id && e.phase === 'start');
      if (idx !== -1) {
        Object.assign(allEntries[idx], entry);
        entry = allEntries[idx];
      } else {
        allEntries.push(entry);
      }
    } else {
      allEntries.push(entry);
    }

    // Update counters
    counters.all++;
    if (entry.category === 'network') {
      counters.network++;
    } else {
      const lv = entry.level || 'log';
      if (lv === 'error' || entry.source === 'uncaught' || entry.source === 'promise') counters.error++;
      else if (lv === 'warn') counters.warn++;
      else counters.log++;
    }

    updateCounterUI();

    if (matchesFilter(entry)) {
      renderRow(entry);
    }

    updateEmpty();
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  function matchesFilter(entry) {
    // Tab filter
    if (activeTab === 'error') {
      if (entry.category !== 'console') return false;
      const lv = entry.level;
      if (lv !== 'error' && entry.source !== 'uncaught' && entry.source !== 'promise') return false;
    } else if (activeTab === 'warn') {
      if (entry.category !== 'console' || entry.level !== 'warn') return false;
    } else if (activeTab === 'log') {
      if (entry.category !== 'console') return false;
      const lv = entry.level;
      if (lv === 'error' || lv === 'warn') return false;
    } else if (activeTab === 'network') {
      if (entry.category !== 'network') return false;
    }

    // Skip network start-only entries
    if (entry.category === 'network' && entry.phase === 'start') return false;

    // Text filter
    if (filterText) {
      const q = filterText.toLowerCase();
      const haystack = (entry.message || entry.url || '').toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  }

  // ── Render a row ──────────────────────────────────────────────────────────
  function renderRow(entry) {
    const tr = document.createElement('tr');
    tr.className = 'dl-row';
    tr.dataset.id = entry.id;

    const time = new Date(entry.time);
    const timeStr = time.toLocaleTimeString('en-US', { hour12: false }) + '.' +
                    String(time.getMilliseconds()).padStart(3, '0');

    let levelCell, sourceCell, msgCell, metaCell;

    if (entry.category === 'console') {
      const lv = entry.level || 'log';
      const isErr = lv === 'error' || entry.source === 'uncaught' || entry.source === 'promise';
      const lvClass = isErr ? 'dl-lv-error' : (lv === 'warn' ? 'dl-lv-warn' : (lv === 'info' ? 'dl-lv-info' : (lv === 'debug' ? 'dl-lv-debug' : 'dl-lv-log')));
      const lvLabel = isErr ? 'ERROR' : lv.toUpperCase();

      levelCell  = `<span class="dl-level-badge ${lvClass}">${escHtml(lvLabel)}</span>`;
      sourceCell = entry.source === 'uncaught' ? 'uncaught' : (entry.source === 'promise' ? 'promise' : 'console');
      const msgClass = isErr ? ' dl-msg-error' : (lv === 'warn' ? ' dl-msg-warn' : '');
      msgCell    = `<span class="dl-msg-cell${msgClass}">${escHtml(truncate(entry.message || '', 200))}</span>`;
      metaCell   = '';

    } else {
      // Network
      const ok    = entry.ok;
      const isErr = entry.phase === 'error' || ok === false || String(entry.status).startsWith('4') || String(entry.status).startsWith('5');
      const lvClass = isErr ? 'dl-lv-net-err' : 'dl-lv-network';
      const lvLabel = isErr ? 'NET ERR' : 'NETWORK';

      levelCell  = `<span class="dl-level-badge ${lvClass}">${lvLabel}</span>`;
      sourceCell = entry.type ? entry.type.toUpperCase() : 'NET';
      const statusClass = isErr ? 'dl-status-err' : (String(entry.status).startsWith('3') ? 'dl-status-rdr' : 'dl-status-ok');
      const statusStr = entry.status ? `<span class="${statusClass}">${escHtml(String(entry.status))}</span>` : '<span class="dl-status-err">ERR</span>';
      msgCell    = `<span class="dl-msg-cell"><span class="dl-method">${escHtml(entry.method || 'GET')}</span>${escHtml(truncate(entry.url || '', 180))}</span>`;
      const sizeStr = entry.size != null ? formatBytes(entry.size) : '—';
      const durStr  = entry.duration != null ? escHtml(String(entry.duration)) + 'ms' : '—';
      metaCell   = `${statusStr} · ${durStr} · ${sizeStr}`;
    }

    tr.innerHTML = `
      <td>${levelCell}</td>
      <td title="${escHtml(timeStr)}">${escHtml(timeStr)}</td>
      <td title="${escHtml(sourceCell)}">${escHtml(sourceCell)}</td>
      <td>${msgCell}</td>
      <td>${metaCell}</td>
    `;

    tr.addEventListener('click', function () {
      selectRow(tr, entry);
    });

    logBody.appendChild(tr);
    // Auto-scroll only if already at bottom
    const main = logBody.closest('.dl-main');
    if (main && main.scrollTop + main.clientHeight >= main.scrollHeight - 40) {
      tr.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }

  // ── Select row / show detail ──────────────────────────────────────────────
  function selectRow(tr, entry) {
    if (selectedRow) selectedRow.classList.remove('selected');
    tr.classList.add('selected');
    selectedRow = tr;
    showDetail(entry);
  }

  function showDetail(entry) {
    detail.classList.add('open');

    if (entry.category === 'console') {
      detailTitle.textContent = `Console ${(entry.level || 'log').toUpperCase()} — ${new Date(entry.time).toLocaleString()}`;
      let text = '';
      text += `Message:\n  ${entry.message || ''}\n\n`;
      if (entry.args && entry.args.length > 1) {
        text += `Arguments:\n${entry.args.map((a, i) => `  [${i}] ${a}`).join('\n')}\n\n`;
      }
      if (entry.stack) {
        text += `Stack Trace:\n${entry.stack}`;
      }
      detailBody.textContent = text;

    } else {
      detailTitle.textContent = `Network ${entry.type ? entry.type.toUpperCase() : ''} — ${entry.method} ${new Date(entry.time).toLocaleString()}`;
      let text = '';
      text += `URL:       ${entry.url || '—'}\n`;
      text += `Method:    ${entry.method || '—'}\n`;
      text += `Type:      ${entry.type || '—'}\n`;
      text += `Status:    ${entry.status || '—'} ${entry.statusText || ''}\n`;
      text += `Duration:  ${entry.duration != null ? entry.duration + ' ms' : '—'}\n`;
      text += `Size:      ${entry.size != null ? formatBytes(entry.size) + ` (${entry.size} bytes)` : '—'}\n`;
      text += `Success:   ${entry.ok === true ? 'Yes' : (entry.ok === false ? 'No' : '—')}\n`;
      if (entry.error) text += `Error:     ${entry.error}\n`;
      text += `Phase:     ${entry.phase || '—'}\n`;
      text += `Timestamp: ${new Date(entry.time).toISOString()}`;
      detailBody.textContent = text;
    }
  }

  detailClose.addEventListener('click', function () {
    detail.classList.remove('open');
    if (selectedRow) { selectedRow.classList.remove('selected'); selectedRow = null; }
  });

  // ── Counter UI ────────────────────────────────────────────────────────────
  function updateCounterUI() {
    tabCounts.all.textContent     = counters.all;
    tabCounts.error.textContent   = counters.error;
    tabCounts.warn.textContent    = counters.warn;
    tabCounts.log.textContent     = counters.log;
    tabCounts.network.textContent = counters.network;

    statusCount.textContent = counters.all + ' entries';
    statusErrs.textContent  = counters.error > 0 ? `${counters.error} error${counters.error > 1 ? 's' : ''}` : '';
  }

  function updateEmpty() {
    emptyEl.style.display = logBody.children.length === 0 ? '' : 'none';
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.dl-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.dl-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      rerender();
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────
  searchEl.addEventListener('input', function () {
    filterText = searchEl.value.trim();
    rerender();
  });

  // ── Rerender all matching entries ─────────────────────────────────────────
  function rerender() {
    logBody.innerHTML = '';
    selectedRow = null;
    detail.classList.remove('open');
    allEntries.forEach(function (entry) {
      if (matchesFilter(entry)) renderRow(entry);
    });
    updateEmpty();
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  function clearAll() {
    allEntries = [];
    counters.all = counters.error = counters.warn = counters.log = counters.network = 0;
    logBody.innerHTML = '';
    selectedRow = null;
    detail.classList.remove('open');
    updateCounterUI();
    updateEmpty();
  }

  btnClear.addEventListener('click', function () {
    clearAll();
    chrome.runtime.sendMessage({ action: 'clearLogs', sourceTabId }).catch(() => {});
  });

  // ── Export ────────────────────────────────────────────────────────────────
  btnExport.addEventListener('click', function () {
    const data = {
      exported:  new Date().toISOString(),
      pageUrl:   pageUrl.textContent,
      totalEntries: allEntries.length,
      entries:   allEntries
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'devlens-logs-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Pause ─────────────────────────────────────────────────────────────────
  btnPause.addEventListener('click', function () {
    paused = !paused;
    btnPause.textContent = paused ? '▶ Resume' : '⏸ Pause';
    btnPause.classList.toggle('active', paused);
    statusPaused.textContent = paused ? '⏸ Paused' : '';
  });

  // ── Theme ─────────────────────────────────────────────────────────────────
  btnTheme.addEventListener('click', function () {
    theme = theme === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', theme);
    btnTheme.textContent = theme === 'dark' ? '☽' : '☀';
    try { chrome.storage.local.set({ devlens_panel_theme: theme }); } catch (e) {}
  });

  // Load saved theme
  try {
    chrome.storage.local.get('devlens_panel_theme', function (res) {
      if (res && res.devlens_panel_theme) {
        theme = res.devlens_panel_theme;
        body.setAttribute('data-theme', theme);
        btnTheme.textContent = theme === 'dark' ? '☽' : '☀';
      }
    });
  } catch (e) {}

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      clearAll();
      chrome.runtime.sendMessage({action:'clearLogs',sourceTabId}).catch(()=>{});
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      searchEl.focus();
      e.preventDefault();
    }
    if (e.key === 'Escape') {
      detail.classList.remove('open');
      searchEl.blur();
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(str, max) {
    return str && str.length > max ? str.slice(0, max) + '…' : str;
  }

  function formatBytes(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  updateEmpty();

})();
