const API_URL = '/api/live';
const BASESCAN_TX_URL = 'https://basescan.org/tokentxns?a=0x7d6eb946664f1defa40c9582819e251ae994a05e&p=1';
const REFRESH_MS = 20_000;

const state = {
  data: null,
  loading: false,
  timer: null,
  feedbackTimer: null,
  activityType: 'all'
};

const elements = {
  connectionStatus: document.querySelector('#connectionStatus'),
  lastUpdated: document.querySelector('#lastUpdated'),
  rewardTransactions: document.querySelector('#rewardTransactions'),
  rewardChiIssued: document.querySelector('#rewardChiIssued'),
  shopperWallets: document.querySelector('#shopperWallets'),
  storeChiBalance: document.querySelector('#storeChiBalance'),
  redemptionTransactions: document.querySelector('#redemptionTransactions'),
  chiRedeemed: document.querySelector('#chiRedeemed'),
  topRefresh: document.querySelector('#topRefreshButton'),
  activityRefresh: document.querySelector('#activityRefreshButton'),
  refreshFeedback: document.querySelector('#refreshFeedback'),
  activityRows: document.querySelector('#activityRows'),
  activityStatus: document.querySelector('#activityStatus'),
  activityUpdated: document.querySelector('#activityUpdated'),
  transferSource: document.querySelector('#transferSource'),
  baseTransactionsLink: document.querySelector('#baseTransactionsLink'),
  headerExplorerLink: document.querySelector('#headerExplorerLink'),
  activityTypeFilter: document.querySelector('#activityTypeFilter'),
  clearFilters: document.querySelector('#clearFilters'),
  heroStoreName: document.querySelector('#heroStoreName'),
  brandCardStoreName: document.querySelector('#brandCardStoreName'),
  brandCardWalletLabel: document.querySelector('#brandCardWalletLabel'),
  activityStoreName: document.querySelector('#activityStoreName'),
  trackedStoreName: document.querySelector('#trackedStoreName'),
  trackedWalletLink: document.querySelector('#trackedWalletLink'),
  walletStripStoreName: document.querySelector('#walletStripStoreName'),
  programWalletLink: document.querySelector('#programWalletLink'),
  programWalletShort: document.querySelector('#programWalletShort'),
  noteWalletShort: document.querySelector('#noteWalletShort')
};

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

function formatDecimalString(value) {
  if (value === null || value === undefined || value === '') return '—';
  const [whole, fraction = ''] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function shortHash(value, start = 7, end = 5) {
  if (!value) return '—';
  const text = String(value);
  return text.length > start + end + 1 ? `${text.slice(0, start)}…${text.slice(-end)}` : text;
}

function normalizeAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(text) ? text : '';
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeTime(value) {
  const date = normalizeTimestamp(value);
  if (!date) return 'Time unavailable';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const ranges = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1]
  ];

  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }

  return 'just now';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setConnection(type, text) {
  if (!elements.connectionStatus) return;
  elements.connectionStatus.className = `connection-pill ${type}`;
  elements.connectionStatus.textContent = text;
}

function setRefreshButtons({ loading = false, success = false, error = false } = {}) {
  clearTimeout(state.feedbackTimer);
  const buttons = [elements.topRefresh, elements.activityRefresh].filter(Boolean);
  buttons.forEach(button => { button.disabled = loading; });

  if (loading) {
    if (elements.topRefresh) elements.topRefresh.textContent = '↻ Refreshing…';
    if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refreshing…';
    if (elements.refreshFeedback) elements.refreshFeedback.textContent = 'Requesting current Base reward activity and wallet balance.';
    return;
  }

  if (success) {
    if (elements.topRefresh) elements.topRefresh.textContent = '✓ Updated';
    if (elements.activityRefresh) elements.activityRefresh.textContent = '✓ Activity updated';
    if (elements.refreshFeedback) elements.refreshFeedback.textContent = 'Live data refreshed.';
    state.feedbackTimer = setTimeout(() => setRefreshButtons(), 2200);
    return;
  }

  if (error) {
    if (elements.topRefresh) elements.topRefresh.textContent = 'Try again';
    if (elements.activityRefresh) elements.activityRefresh.textContent = 'Try again';
    if (elements.refreshFeedback) elements.refreshFeedback.textContent = 'Refresh failed. Automatic refresh will retry.';
    state.feedbackTimer = setTimeout(() => setRefreshButtons(), 3500);
    return;
  }

  if (elements.topRefresh) elements.topRefresh.textContent = '↻ Refresh data';
  if (elements.activityRefresh) elements.activityRefresh.textContent = '↻ Refresh activity';
  if (elements.refreshFeedback) elements.refreshFeedback.textContent = '';
}

function renderTrackedStore(data) {
  const trackedStore = data.trackedStore || {};
  const storeName = trackedStore.name || "America's Food Basket Rockaway";
  const wallet = trackedStore.wallet || '';
  const shortWallet = trackedStore.shortWallet || shortHash(wallet, 7, 5);
  const link = trackedStore.explorerUrl || (wallet ? `https://basescan.org/address/${wallet}` : '#');

  [elements.heroStoreName, elements.brandCardStoreName, elements.activityStoreName, elements.trackedStoreName, elements.walletStripStoreName].forEach(node => {
    if (node) node.textContent = storeName;
  });
  if (elements.brandCardWalletLabel) elements.brandCardWalletLabel.textContent = wallet || 'Wallet unavailable';
  if (elements.trackedWalletLink) {
    elements.trackedWalletLink.textContent = wallet ? `${wallet} ↗` : 'Wallet unavailable';
    elements.trackedWalletLink.href = link;
  }
  if (elements.programWalletShort) elements.programWalletShort.textContent = shortWallet;
  if (elements.programWalletLink) elements.programWalletLink.href = link;
  if (elements.noteWalletShort) elements.noteWalletShort.textContent = shortWallet;
}

function renderMetrics(data) {
  const metrics = data.metrics || {};
  if (elements.rewardTransactions) elements.rewardTransactions.textContent = formatNumber(metrics.rewardTransactions);
  if (elements.rewardChiIssued) elements.rewardChiIssued.textContent = formatNumber(metrics.rewardChiIssued);
  if (elements.shopperWallets) elements.shopperWallets.textContent = formatNumber(metrics.shopperWallets);
  if (elements.storeChiBalance) elements.storeChiBalance.textContent = formatDecimalString(metrics.storeChiBalance);
  if (elements.redemptionTransactions) elements.redemptionTransactions.textContent = formatNumber(metrics.redemptionTransactions);
  if (elements.chiRedeemed) elements.chiRedeemed.textContent = formatNumber(metrics.chiRedeemed);
}

function allTransferRecords(data) {
  return Array.isArray(data.transactions?.records) ? data.transactions.records : [];
}

function filteredTransfers(data) {
  const selectedType = state.activityType;
  let rows = allTransferRecords(data);

  if (selectedType !== 'all') {
    rows = rows.filter(item => String(item.activityType || 'other').toLowerCase() === selectedType);
  }

  return rows;
}

function activityClass(value) {
  const normalized = String(value || 'other').toLowerCase();
  return ['reward', 'redemption', 'mint', 'burn'].includes(normalized) ? normalized : 'other';
}

function renderStoreCell(trackedStore) {
  const name = trackedStore?.name || "America's Food Basket Rockaway";
  const wallet = trackedStore?.wallet || '';
  const link = trackedStore?.explorerUrl || (wallet ? `https://basescan.org/address/${wallet}` : '#');
  const keyLabel = wallet ? shortHash(wallet, 10, 8) : 'Public key unavailable';
  const keyLink = wallet
    ? `<a class="store-key-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(wallet)}">${escapeHtml(keyLabel)}</a>`
    : `<span class="store-key-link unavailable">Public key unavailable</span>`;

  return `
    <div class="store-cell">
      <strong class="store-name">${escapeHtml(name)}</strong>
      ${keyLink}
    </div>`;
}

function renderActivity(data) {
  if (!elements.activityRows) return;

  const transfers = filteredTransfers(data);
  const totalLoaded = allTransferRecords(data).length;
  const indexedTotal = Number(data.transactions?.totalCount ?? totalLoaded);
  const fetched = normalizeTimestamp(data.fetchedAt);
  const capped = Boolean(data.transactions?.capped);
  const trackedStore = data.trackedStore || {};

  if (elements.transferSource) {
    const suffix = capped ? '+' : '';
    const sourceLabel = trackedStore?.name ? ` for ${trackedStore.name}` : '';
    elements.transferSource.textContent = `Transfer source: ${formatNumber(indexedTotal)}${suffix} Base CHI transfer events indexed${sourceLabel}`;
  }
  if (elements.baseTransactionsLink) {
    elements.baseTransactionsLink.href = data.transactions?.explorerUrl || BASESCAN_TX_URL;
  }
  if (elements.headerExplorerLink) {
    elements.headerExplorerLink.href = data.transactions?.explorerUrl || BASESCAN_TX_URL;
  }
  if (elements.activityUpdated) {
    elements.activityUpdated.textContent = fetched
      ? `Updated ${fetched.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
      : 'Update time unavailable';
  }

  if (!totalLoaded) {
    elements.activityStatus.textContent = 'No Base CHI transaction records were returned for the tracked store wallet.';
    elements.activityRows.innerHTML = '<tr><td colspan="5" class="empty-state">No Chili reward activity was returned for the tracked wallet. Use “Refresh activity” to retry or open BaseScan.</td></tr>';
    return;
  }

  if (!transfers.length) {
    const message = 'No loaded Chili activity matched the selected filter.';
    elements.activityStatus.textContent = message;
    elements.activityRows.innerHTML = `<tr><td colspan="5" class="empty-state">${escapeHtml(message)}</td></tr>`;
    return;
  }

  const typeText = state.activityType === 'all' ? '' : ` · ${state.activityType}`;
  elements.activityStatus.textContent = `Showing ${formatNumber(transfers.length)} latest loaded rows${typeText}. Metrics are calculated from ${formatNumber(indexedTotal)}${capped ? '+' : ''} indexed Base transfers for the tracked store wallet.`;

  elements.activityRows.innerHTML = transfers.map(item => {
    const tx = item.transactionHash || '';
    const sourceWallet = item.sourceWallet || item.transactionInitiator || item.from || '';
    const txLink = item.transactionUrl || `https://basescan.org/tx/${tx}`;
    const sourceLink = item.sourceWalletUrl || `https://basescan.org/address/${sourceWallet}`;
    const storeCell = renderStoreCell(trackedStore);

    return `
      <tr>
        <td title="${escapeHtml(item.timestamp || '')}">${escapeHtml(relativeTime(item.timestamp))}</td>
        <td><a class="mono-link" href="${escapeHtml(sourceLink)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(sourceWallet)}">${escapeHtml(shortHash(sourceWallet))}</a></td>
        <td>${storeCell}</td>
        <td class="amount-cell">${escapeHtml(formatDecimalString(item.amount))}</td>
        <td><a class="mono-link" href="${escapeHtml(txLink)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(tx)}">${escapeHtml(shortHash(tx, 9, 6))} ↗</a></td>
      </tr>`;
  }).join('');
}

function renderStatus(data) {
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  if (!data.ok) {
    setConnection('bad', 'Live Base source unavailable');
  } else if (warnings.length) {
    setConnection('warn', `Live with ${warnings.length} data warning${warnings.length === 1 ? '' : 's'}`);
  } else {
    setConnection('good', 'Live Base data connected');
  }

  const fetched = normalizeTimestamp(data.fetchedAt);
  elements.lastUpdated.textContent = fetched
    ? `Updated ${fetched.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
    : 'Update time unavailable';
}

async function loadLiveData({ manual = false } = {}) {
  if (state.loading) return;
  state.loading = true;

  if (manual) setRefreshButtons({ loading: true });
  if (manual || !state.data) setConnection('loading', 'Refreshing live Base data…');
  if (elements.activityStatus && manual) elements.activityStatus.textContent = 'Refreshing Chili reward activity and wallet balance…';

  try {
    const params = new URLSearchParams({ t: String(Date.now()) });
    if (manual) params.set('force', '1');

    const response = await fetch(`${API_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      cache: 'no-store'
    });

    if (!response.ok) throw new Error(`Live endpoint returned HTTP ${response.status}`);
    const data = await response.json();
    state.data = data;
    renderTrackedStore(data);
    renderMetrics(data);
    renderActivity(data);
    renderStatus(data);
    if (manual) setRefreshButtons({ success: true });
  } catch (error) {
    setConnection('bad', 'Live Base connection failed');
    elements.lastUpdated.textContent = error instanceof Error ? error.message : 'Unknown refresh error';
    if (elements.activityStatus) elements.activityStatus.textContent = 'Chili activity refresh failed.';
    if (!state.data && elements.activityRows) {
      elements.activityRows.innerHTML = '<tr><td colspan="5" class="empty-state">The live endpoint could not be reached. Vercel will retry on the next automatic refresh.</td></tr>';
    }
    if (manual) setRefreshButtons({ error: true });
  } finally {
    state.loading = false;
    if (!manual) {
      if (elements.topRefresh) elements.topRefresh.disabled = false;
      if (elements.activityRefresh) elements.activityRefresh.disabled = false;
    }
  }
}

function scheduleRefresh() {
  clearInterval(state.timer);
  state.timer = setInterval(() => loadLiveData(), REFRESH_MS);
}

function rerenderActivityFromControls() {
  if (!state.data) return;
  state.activityType = elements.activityTypeFilter?.value || 'all';
  renderActivity(state.data);
}

if (elements.topRefresh) elements.topRefresh.addEventListener('click', () => loadLiveData({ manual: true }));
if (elements.activityRefresh) elements.activityRefresh.addEventListener('click', () => loadLiveData({ manual: true }));
if (elements.activityTypeFilter) elements.activityTypeFilter.addEventListener('change', rerenderActivityFromControls);
if (elements.clearFilters) {
  elements.clearFilters.addEventListener('click', () => {
    if (elements.activityTypeFilter) elements.activityTypeFilter.value = 'all';
    state.activityType = 'all';
    if (state.data) renderActivity(state.data);
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadLiveData();
});

loadLiveData();
scheduleRefresh();
