const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const TRACKED_STORE = Object.freeze({
  name: "America's Food Basket Rockaway",
  wallet: '0x7d6eb946664f1defa40c9582819e251ae994a05e'
});
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BASESCAN_TX_URL = `https://basescan.org/tokentxns?a=${TRACKED_STORE.wallet}&p=1`;
const BASESCAN_BALANCE_URL = `https://basescan.org/token/${BASE_TOKEN}?a=${TRACKED_STORE.wallet}#transactions`;
const BASE_RPC_URL = 'https://mainnet.base.org';
const TIMEOUT_MS = 12_000;
const TRANSFER_FETCH_LIMIT = '10000';
const TABLE_RECORD_LIMIT = 300;
const V2_MAX_PAGES = 24;
const V2_MAX_RECORDS = 1200;
const REWARD_CHI_AMOUNT = '5';

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: options.accept || '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 (compatible; AmericasFoodBasketChiliTracker/1.0)',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function decimalAmount(rawValue, rawDecimals) {
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

function classifyTransfer({ event, amount, from, to }) {
  const wallet = TRACKED_STORE.wallet;
  if (event === 'Mint') return 'Mint';
  if (event === 'Burn') return 'Burn';

  const normalizedAmount = canonicalDecimal(amount);
  if (normalizedAmount === REWARD_CHI_AMOUNT && from === wallet && to !== ZERO_ADDRESS) return 'Reward';
  return 'Other';
}

function normalizeTransfer(item) {
  const token = BASE_TOKEN.toLowerCase();
  const from = String(item.from || '').toLowerCase();
  const to = String(item.to || '').toLowerCase();
  const transactionHash = String(item.hash || item.transactionHash || '').toLowerCase();
  const contractAddress = String(item.contractAddress || BASE_TOKEN).toLowerCase();

  if (contractAddress !== token || !transactionHash || !from || !to) return null;

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  const amount = decimalAmount(item.value, item.tokenDecimal);
  const activityType = classifyTransfer({ event, amount, from, to });

  return {
    chain: 'Base',
    chainKey: 'base',
    transactionHash,
    transactionUrl: `https://basescan.org/tx/${transactionHash}`,
    blockNumber: String(item.blockNumber || ''),
    timestamp: item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : null,
    from,
    to,
    fromUrl: `https://basescan.org/address/${from}`,
    toUrl: `https://basescan.org/address/${to}`,
    event,
    activityType,
    amount,
    amountRaw: String(item.value ?? ''),
    decimals: Number(item.tokenDecimal ?? 18),
    tokenSymbol: item.tokenSymbol || 'CHI'
  };
}

function isTrackedTransfer(transfer) {
  return transfer && (transfer.from === TRACKED_STORE.wallet || transfer.to === TRACKED_STORE.wallet);
}

async function fetchTokenTransfersLegacy(offset = TRANSFER_FETCH_LIMIT) {
  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    contractaddress: BASE_TOKEN,
    address: TRACKED_STORE.wallet,
    page: '1',
    offset,
    sort: 'desc'
  });

  const url = `https://base.blockscout.com/api?${params.toString()}`;
  const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const result = Array.isArray(data.result) ? data.result : [];
  if (!result.length && data.status !== '1') {
    throw new Error(String(data.message || data.result || 'No transfer records returned'));
  }

  const seen = new Set();
  const allTransfers = [];
  for (const item of result) {
    const transfer = normalizeTransfer(item);
    if (!transfer || !isTrackedTransfer(transfer)) continue;
    const key = `${transfer.transactionHash}:${item.logIndex || item.transactionIndex || allTransfers.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allTransfers.push(transfer);
    if (allTransfers.length >= Number(offset)) break;
  }

  return {
    allTransfers,
    transfers: allTransfers.slice(0, TABLE_RECORD_LIMIT),
    totalCount: allTransfers.length,
    fetchedLimit: Number(offset),
    capped: allTransfers.length >= Number(offset),
    source: 'Base Blockscout legacy ERC-20 indexer',
    sourceUrl: `https://base.blockscout.com/token/${BASE_TOKEN}?tab=token_transfers`,
    explorerUrl: BASESCAN_TX_URL
  };
}


function normalizeV2Transfer(item) {
  const token = BASE_TOKEN.toLowerCase();
  const from = String(item?.from?.hash || item?.from || '').toLowerCase();
  const to = String(item?.to?.hash || item?.to || '').toLowerCase();
  const transactionHash = String(item?.transaction_hash || item?.transactionHash || '').toLowerCase();
  const contractAddress = String(item?.token?.address_hash || item?.token?.address || BASE_TOKEN).toLowerCase();

  if (contractAddress !== token || !transactionHash || !from || !to) return null;

  let event = 'Transfer';
  if (from === ZERO_ADDRESS) event = 'Mint';
  else if (to === ZERO_ADDRESS) event = 'Burn';

  const rawValue = item?.total?.value ?? item?.value ?? '';
  const decimals = item?.total?.decimals ?? item?.token?.decimals ?? 18;
  const amount = decimalAmount(rawValue, decimals);
  const activityType = classifyTransfer({ event, amount, from, to });

  return {
    chain: 'Base',
    chainKey: 'base',
    transactionHash,
    transactionUrl: `https://basescan.org/tx/${transactionHash}`,
    blockNumber: String(item?.block_number || ''),
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
    amountRaw: String(rawValue ?? ''),
    decimals: Number(decimals ?? 18),
    tokenSymbol: item?.token?.symbol || 'CHI',
    logIndex: String(item?.log_index ?? item?.index ?? '')
  };
}

async function fetchTokenTransfersV2() {
  const baseParams = new URLSearchParams({
    type: 'ERC-20',
    filter: 'from',
    token: BASE_TOKEN
  });

  let nextPageParams = null;
  let pageCount = 0;
  const seen = new Set();
  const allTransfers = [];

  while (pageCount < V2_MAX_PAGES && allTransfers.length < V2_MAX_RECORDS) {
    const params = new URLSearchParams(baseParams);
    if (nextPageParams && typeof nextPageParams === 'object') {
      for (const [key, value] of Object.entries(nextPageParams)) {
        if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
      }
    }

    const url = `https://base.blockscout.com/api/v2/addresses/${TRACKED_STORE.wallet}/token-transfers?${params.toString()}`;
    const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`V2 HTTP ${response.status}`);

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    for (const item of items) {
      const transfer = normalizeV2Transfer(item);
      if (!transfer || !isTrackedTransfer(transfer)) continue;
      const key = `${transfer.transactionHash}:${transfer.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allTransfers.push(transfer);
      if (allTransfers.length >= V2_MAX_RECORDS) break;
    }

    pageCount += 1;
    nextPageParams = data.next_page_params && Object.keys(data.next_page_params).length
      ? data.next_page_params
      : null;
    if (!nextPageParams || !items.length) break;
  }

  const capped = Boolean(nextPageParams) || allTransfers.length >= V2_MAX_RECORDS;
  return {
    allTransfers,
    transfers: allTransfers.slice(0, TABLE_RECORD_LIMIT),
    totalCount: allTransfers.length,
    fetchedLimit: V2_MAX_RECORDS,
    capped,
    source: 'Base Blockscout V2 address token-transfer indexer',
    sourceUrl: `https://base.blockscout.com/address/${TRACKED_STORE.wallet}?tab=token_transfers`,
    explorerUrl: BASESCAN_TX_URL,
    fallbackUsed: true,
    pagesFetched: pageCount
  };
}

async function fetchTokenTransfers() {
  let legacyError = null;
  try {
    const legacy = await fetchTokenTransfersLegacy();
    if (legacy.allTransfers.length) return legacy;
    legacyError = new Error('Legacy transfer endpoint returned zero records');
  } catch (error) {
    legacyError = error;
  }

  try {
    const v2 = await fetchTokenTransfersV2();
    if (!v2.allTransfers.length) {
      throw new Error('V2 transfer endpoint returned zero records');
    }
    return {
      ...v2,
      fallbackWarning: `Legacy transfer lookup failed: ${legacyError?.message || 'unknown error'}`
    };
  } catch (v2Error) {
    throw new Error(`Legacy lookup failed: ${legacyError?.message || 'unknown error'}; V2 fallback failed: ${v2Error.message}`);
  }
}

async function fetchContractTransactions(offset = '500') {
  const params = new URLSearchParams({
    module: 'account',
    action: 'txlist',
    address: BASE_TOKEN,
    page: '1',
    offset,
    sort: 'desc'
  });

  const url = `https://base.blockscout.com/api?${params.toString()}`;
  const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const result = Array.isArray(data.result) ? data.result : [];
  if (!result.length && data.status !== '1') {
    throw new Error(String(data.message || data.result || 'No contract transactions returned'));
  }

  const byHash = new Map();
  for (const tx of result) {
    const hash = String(tx.hash || '').toLowerCase();
    if (!hash) continue;
    byHash.set(hash, {
      transactionHash: hash,
      initiator: String(tx.from || '').toLowerCase(),
      calledContract: String(tx.to || BASE_TOKEN).toLowerCase(),
      methodId: tx.methodId || null,
      functionName: tx.functionName || null,
      timestamp: tx.timeStamp ? new Date(Number(tx.timeStamp) * 1000).toISOString() : null,
      blockNumber: String(tx.blockNumber || '')
    });
  }

  return {
    byHash,
    source: 'Base Blockscout contract transaction indexer',
    sourceUrl: `https://base.blockscout.com/address/${BASE_TOKEN}?tab=txs`
  };
}

function enrichTransfersWithTransactions(transfers, txInfo) {
  const txMap = txInfo?.byHash instanceof Map ? txInfo.byHash : new Map();

  return transfers.map(transfer => {
    const tx = txMap.get(String(transfer.transactionHash || '').toLowerCase());
    const initiator = tx?.initiator || transfer.from || null;

    return {
      ...transfer,
      sourceWallet: initiator,
      sourceWalletUrl: initiator ? `https://basescan.org/address/${initiator}` : null,
      transactionInitiator: tx?.initiator || null,
      calledContract: tx?.calledContract || null,
      methodId: tx?.methodId || null,
      functionName: tx?.functionName || null,
      timestamp: transfer.timestamp || tx?.timestamp || null,
      blockNumber: transfer.blockNumber || tx?.blockNumber || ''
    };
  });
}

function rawHexToDecimalAmount(hexValue, decimals = 18) {
  const text = String(hexValue || '').trim();
  if (!/^0x[0-9a-f]+$/i.test(text)) return null;
  return decimalAmount(BigInt(text).toString(), decimals);
}

async function fetchTokenBalanceFromBlockscout() {
  const params = new URLSearchParams({
    module: 'account',
    action: 'tokenbalance',
    contractaddress: BASE_TOKEN,
    address: TRACKED_STORE.wallet,
    tag: 'latest'
  });

  const response = await fetchWithTimeout(`https://base.blockscout.com/api?${params.toString()}`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const rawBalance = String(data.result ?? '').trim();
  if (!/^\d+$/.test(rawBalance)) {
    throw new Error(String(data.message || data.result || 'Token balance unavailable'));
  }

  return {
    balance: decimalAmount(rawBalance, 18),
    source: 'Base Blockscout token balance indexer'
  };
}

async function fetchTokenBalanceFromRpc() {
  const walletArg = TRACKED_STORE.wallet.slice(2).padStart(64, '0');
  const response = await fetchWithTimeout(BASE_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: BASE_TOKEN, data: `0x70a08231${walletArg}` }, 'latest']
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (data.error || !data.result) {
    throw new Error(data.error?.message || 'Base RPC balanceOf call failed');
  }

  const balance = rawHexToDecimalAmount(data.result, 18);
  if (balance === null) throw new Error('Base RPC returned an invalid token balance');

  return {
    balance,
    source: 'Base mainnet RPC balanceOf'
  };
}

async function fetchTokenBalance() {
  try {
    return await fetchTokenBalanceFromBlockscout();
  } catch (blockscoutError) {
    try {
      const rpcResult = await fetchTokenBalanceFromRpc();
      return { ...rpcResult, warning: `Blockscout balance lookup failed: ${blockscoutError.message}` };
    } catch (rpcError) {
      throw new Error(`Balance lookup failed: ${blockscoutError.message}; RPC fallback failed: ${rpcError.message}`);
    }
  }
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
  res.setHeader('Cache-Control', force ? 'no-store, max-age=0' : 's-maxage=10, stale-while-revalidate=20');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const fetchedAt = new Date().toISOString();
  const [transferResult, balanceResult] = await Promise.allSettled([
    fetchTokenTransfers(),
    fetchTokenBalance()
  ]);

  const warnings = [];
  const transferData = transferResult.status === 'fulfilled' ? transferResult.value : null;
  const balanceData = balanceResult.status === 'fulfilled' ? balanceResult.value : null;

  if (!transferData) {
    warnings.push(`Base CHI transfer feed unavailable: ${transferResult.reason?.message || 'unknown error'}`);
  }
  if (!balanceData) {
    warnings.push(`Base CHI wallet balance unavailable: ${balanceResult.reason?.message || 'unknown error'}`);
  } else if (balanceData.warning) {
    warnings.push(balanceData.warning);
  }
  if (transferData?.fallbackWarning) {
    warnings.push(transferData.fallbackWarning);
  }
  if (transferData?.capped) {
    warnings.push(`The Base transfer feed reached the ${transferData.fetchedLimit.toLocaleString('en-US')} record fetch limit. Reported totals may be higher.`);
  }

  const allTransfers = transferData?.allTransfers || [];
  const visibleTransfers = (transferData?.transfers || []).map(transfer => ({
    ...transfer,
    sourceWallet: transfer.sourceWallet || transfer.from || null,
    sourceWalletUrl: transfer.sourceWalletUrl || (transfer.from ? `https://basescan.org/address/${transfer.from}` : null)
  }));
  const metrics = transferData
    ? calculateMetrics(allTransfers, balanceData?.balance ?? null)
    : {
        rewardTransactions: null,
        rewardChiIssued: null,
        shopperWallets: null,
        storeChiBalance: balanceData?.balance ?? null,
        otherTransactions: null,
        totalTransactions: null
      };

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
      fetchedLimit: transferData?.fetchedLimit || Number(TRANSFER_FETCH_LIMIT),
      records: visibleTransfers,
      source: transferData?.source || null,
      sourceUrl: transferData?.sourceUrl || null,
      explorerUrl: BASESCAN_TX_URL
    },
    note: 'An exact 5 CHI Base transfer sent out of the tracked America\'s Food Basket wallet to another wallet is classified as a reward. Chilis Rewarded is the cumulative CHI from those reward distributions. Shopper Wallets counts unique reward-recipient addresses.',
    warnings
  });
}
