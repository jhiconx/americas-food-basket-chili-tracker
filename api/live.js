const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const TRACKED_STORE = Object.freeze({
  name: "America's Food Basket Rockaway",
  wallet: '0x7d6eb946664f1defa40c9582819e251ae994a05e'
});

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BASESCAN_TX_URL = `https://basescan.org/tokentxns?a=${TRACKED_STORE.wallet}&p=1`;
const BASESCAN_BALANCE_URL = `https://basescan.org/token/${BASE_TOKEN}?a=${TRACKED_STORE.wallet}#transactions`;
const BLOCKSCOUT_TRANSFERS_URL = `https://base.blockscout.com/api/v2/addresses/${TRACKED_STORE.wallet}/token-transfers`;
const BASE_RPC_URL = 'https://mainnet.base.org';

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_TRANSFER_PAGES = 40;
const MAX_TRANSFER_RECORDS = 2_000;
const TABLE_RECORD_LIMIT = 300;
const REWARD_CHI_AMOUNT = '5';
const TRANSFER_CACHE_MS = 30_000;

let transferCache = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'AmericasFoodBasketChiliTracker/13.0',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function decimalAmount(rawValue, rawDecimals = 18) {
  const value = String(rawValue ?? '').trim();
  const decimals = Number(rawDecimals ?? 18);

  if (!/^\d+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return value || null;
  }

  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function canonicalDecimal(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';

  const [wholeRaw, fractionRaw = ''] = text.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function classifyTransfer({ from, to, amount }) {
  if (
    from === TRACKED_STORE.wallet &&
    to !== ZERO_ADDRESS &&
    canonicalDecimal(amount) === REWARD_CHI_AMOUNT
  ) {
    return 'Reward';
  }

  return 'Other';
}

function normalizeBlockscoutTransfer(item) {
  const from = String(item?.from?.hash || '').toLowerCase();
  const to = String(item?.to?.hash || '').toLowerCase();
  const transactionHash = String(item?.transaction_hash || '').toLowerCase();
  const contractAddress = String(item?.token?.address_hash || '').toLowerCase();

  if (
    contractAddress !== BASE_TOKEN.toLowerCase() ||
    !/^0x[a-f0-9]{40}$/.test(from) ||
    !/^0x[a-f0-9]{40}$/.test(to) ||
    !/^0x[a-f0-9]{64}$/.test(transactionHash)
  ) {
    return null;
  }

  const rawValue = item?.total?.value ?? '';
  const decimals = Number(item?.total?.decimals ?? item?.token?.decimals ?? 18);
  const amount = decimalAmount(rawValue, decimals);
  const event = from === ZERO_ADDRESS ? 'Mint' : to === ZERO_ADDRESS ? 'Burn' : 'Transfer';
  const activityType = classifyTransfer({ from, to, amount });

  return {
    chain: 'Base',
    chainKey: 'base',
    transactionHash,
    transactionUrl: `https://basescan.org/tx/${transactionHash}`,
    blockNumber: String(item?.block_number ?? ''),
    timestamp: item?.timestamp || null,
    from,
    to,
    fromUrl: `https://basescan.org/address/${from}`,
    toUrl: `https://basescan.org/address/${to}`,
    sourceWallet: from,
    sourceWalletUrl: `https://basescan.org/address/${from}`,
    event,
    activityType,
    amount,
    amountRaw: String(rawValue),
    decimals,
    tokenSymbol: item?.token?.symbol || 'CHI',
    logIndex: String(item?.log_index ?? '')
  };
}

function isTrackedTransfer(transfer) {
  return transfer && (
    transfer.from === TRACKED_STORE.wallet ||
    transfer.to === TRACKED_STORE.wallet
  );
}

async function fetchTokenTransfers({ force = false } = {}) {
  const now = Date.now();
  if (!force && transferCache && now - transferCache.savedAt < TRANSFER_CACHE_MS) {
    return transferCache.data;
  }

  const seen = new Set();
  const allTransfers = [];
  let nextPageParams = null;
  let pageCount = 0;

  do {
    const params = new URLSearchParams();
    if (nextPageParams && typeof nextPageParams === 'object') {
      for (const [key, value] of Object.entries(nextPageParams)) {
        if (value !== null && value !== undefined && value !== '') {
          params.set(key, String(value));
        }
      }
    }

    // Use Blockscout's canonical address token-transfer route with no optional
    // token/filter parameters. The previous optional parameter combination was
    // the request returning HTTP 500. CHI and direction are filtered locally.
    const url = params.size
      ? `${BLOCKSCOUT_TRANSFERS_URL}?${params.toString()}`
      : BLOCKSCOUT_TRANSFERS_URL;

    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Blockscout address transfer request failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    for (const item of items) {
      const transfer = normalizeBlockscoutTransfer(item);
      if (!transfer || !isTrackedTransfer(transfer)) continue;

      const key = `${transfer.transactionHash}:${transfer.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allTransfers.push(transfer);

      if (allTransfers.length >= MAX_TRANSFER_RECORDS) break;
    }

    pageCount += 1;
    nextPageParams = data?.next_page_params && Object.keys(data.next_page_params).length
      ? data.next_page_params
      : null;

    if (!items.length || allTransfers.length >= MAX_TRANSFER_RECORDS) break;
  } while (nextPageParams && pageCount < MAX_TRANSFER_PAGES);

  const capped = Boolean(nextPageParams) && (
    pageCount >= MAX_TRANSFER_PAGES ||
    allTransfers.length >= MAX_TRANSFER_RECORDS
  );

  const result = {
    allTransfers,
    transfers: allTransfers.slice(0, TABLE_RECORD_LIMIT),
    totalCount: allTransfers.length,
    fetchedLimit: MAX_TRANSFER_RECORDS,
    capped,
    pagesFetched: pageCount,
    source: 'Base Blockscout address token-transfer API',
    sourceUrl: `https://base.blockscout.com/address/${TRACKED_STORE.wallet}?tab=token_transfers`,
    explorerUrl: BASESCAN_TX_URL
  };

  transferCache = { savedAt: now, data: result };
  return result;
}

async function rpcCall(method, params) {
  const response = await fetchWithTimeout(BASE_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });

  if (!response.ok) throw new Error(`Base RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error(data.error.message || 'Base RPC error');
  return data?.result;
}

async function fetchTokenBalance() {
  const walletWord = TRACKED_STORE.wallet.slice(2).padStart(64, '0');
  const callData = `0x70a08231${walletWord}`;
  const result = await rpcCall('eth_call', [{ to: BASE_TOKEN, data: callData }, 'latest']);

  if (!/^0x[0-9a-f]+$/i.test(String(result || ''))) {
    throw new Error('Base RPC returned an invalid CHI balance');
  }

  return {
    balance: decimalAmount(BigInt(result).toString(), 18),
    source: 'Base public RPC balanceOf',
    sourceUrl: BASE_RPC_URL
  };
}

function calculateMetrics(transfers, storeChiBalance = null) {
  let rewardTransactions = 0;
  let rewardChiIssued = 0;
  let otherTransactions = 0;
  const uniqueShopperWallets = new Set();

  for (const transfer of transfers) {
    if (transfer.activityType === 'Reward') {
      rewardTransactions += 1;
      rewardChiIssued += Number(transfer.amount || 0);

      if (
        transfer.to &&
        transfer.to !== TRACKED_STORE.wallet &&
        transfer.to !== ZERO_ADDRESS &&
        transfer.to !== BASE_TOKEN.toLowerCase()
      ) {
        uniqueShopperWallets.add(transfer.to);
      }
    } else {
      otherTransactions += 1;
    }
  }

  return {
    rewardTransactions,
    rewardChiIssued,
    shopperWallets: uniqueShopperWallets.size,
    storeChiBalance,
    otherTransactions,
    totalTransactions: transfers.length
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestUrl = new URL(req.url || '/', 'https://americas-food-basket.local');
  const force = requestUrl.searchParams.get('force') === '1';

  res.setHeader(
    'Cache-Control',
    force ? 'no-store, max-age=0' : 's-maxage=20, stale-while-revalidate=60'
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const fetchedAt = new Date().toISOString();
  const [transferResult, balanceResult] = await Promise.allSettled([
    fetchTokenTransfers({ force }),
    fetchTokenBalance()
  ]);

  const transferData = transferResult.status === 'fulfilled' ? transferResult.value : null;
  const balanceData = balanceResult.status === 'fulfilled' ? balanceResult.value : null;
  const warnings = [];

  if (!transferData) {
    warnings.push(`Base CHI transfer feed unavailable: ${transferResult.reason?.message || 'unknown error'}`);
  }
  if (!balanceData) {
    warnings.push(`Base CHI wallet balance unavailable: ${balanceResult.reason?.message || 'unknown error'}`);
  }
  if (transferData?.capped) {
    warnings.push(
      `Transfer history reached the ${transferData.fetchedLimit.toLocaleString('en-US')} record safety limit. Totals may be higher.`
    );
  }

  const allTransfers = transferData?.allTransfers || [];
  const visibleTransfers = transferData?.transfers || [];
  const metrics = calculateMetrics(allTransfers, balanceData?.balance ?? null);

  return res.status(200).json({
    ok: Boolean(transferData),
    fetchedAt,
    refreshSeconds: 20,
    contract: {
      network: 'Base',
      token: BASE_TOKEN,
      explorerUrl: BASESCAN_TX_URL
    },
    balance: {
      value: balanceData?.balance ?? null,
      source: balanceData?.source || null,
      explorerUrl: BASESCAN_BALANCE_URL
    },
    trackedStore: {
      name: TRACKED_STORE.name,
      wallet: TRACKED_STORE.wallet,
      shortWallet: `${TRACKED_STORE.wallet.slice(0, 7)}…${TRACKED_STORE.wallet.slice(-4)}`,
      explorerUrl: BASESCAN_BALANCE_URL
    },
    rules: {
      rewardChiAmount: Number(REWARD_CHI_AMOUNT),
      classification: 'An exact 5 CHI transfer sent out of the tracked wallet is a reward'
    },
    metrics,
    transactions: {
      totalCount: transferData?.totalCount || 0,
      latestCount: visibleTransfers.length,
      capped: Boolean(transferData?.capped),
      fetchedLimit: transferData?.fetchedLimit || MAX_TRANSFER_RECORDS,
      records: visibleTransfers,
      source: transferData?.source || null,
      sourceUrl: transferData?.sourceUrl || null,
      pagesFetched: transferData?.pagesFetched || 0,
      explorerUrl: BASESCAN_TX_URL
    },
    note: 'An exact 5 CHI Base transfer sent out of the tracked America\'s Food Basket wallet to another wallet is classified as a reward. Chilis Rewarded is the cumulative CHI from those reward distributions. Shopper Wallets counts unique reward-recipient addresses.',
    warnings
  });
}
