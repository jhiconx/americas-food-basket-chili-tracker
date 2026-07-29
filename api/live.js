const BASE_TOKEN = '0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8';
const TRACKED_STORE = Object.freeze({
  name: "America's Food Basket Rockaway",
  wallet: '0x7d6eb946664f1defa40c9582819e251ae994a05e'
});
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BASESCAN_TX_URL = `https://basescan.org/token/${BASE_TOKEN}#transactions`;
const TIMEOUT_MS = 12_000;
const TRANSFER_FETCH_LIMIT = '10000';
const TABLE_RECORD_LIMIT = 300;
const REWARD_CHI_AMOUNT = '5';
const REDEMPTION_CHI_AMOUNT = '3';

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
  if (normalizedAmount === REWARD_CHI_AMOUNT && to === wallet) return 'Reward';
  if (normalizedAmount === REDEMPTION_CHI_AMOUNT && from === wallet) return 'Redemption';
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

async function fetchTokenTransfers(offset = TRANSFER_FETCH_LIMIT) {
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
    source: 'Base Blockscout ERC-20 indexer',
    sourceUrl: `https://base.blockscout.com/token/${BASE_TOKEN}?tab=token_transfers`,
    explorerUrl: BASESCAN_TX_URL
  };
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

function calculateMetrics(transfers) {
  let rewardTransactions = 0;
  let rewardChiIssued = 0;
  let redemptionTransactions = 0;
  let chiRedeemed = 0;
  let otherTransactions = 0;
  const uniqueShopperWallets = new Set();

  for (const transfer of transfers) {
    if (transfer.activityType === 'Reward') {
      rewardTransactions += 1;
      rewardChiIssued += Number(transfer.amount || 0);
    } else if (transfer.activityType === 'Redemption') {
      redemptionTransactions += 1;
      chiRedeemed += Number(transfer.amount || 0);
    } else {
      otherTransactions += 1;
    }

    const counterparty = transfer.from === TRACKED_STORE.wallet ? transfer.to : transfer.from;
    if (
      counterparty &&
      counterparty !== TRACKED_STORE.wallet &&
      counterparty !== ZERO_ADDRESS &&
      counterparty !== BASE_TOKEN.toLowerCase()
    ) {
      uniqueShopperWallets.add(counterparty);
    }
  }

  return {
    rewardTransactions,
    rewardChiIssued,
    shopperWallets: uniqueShopperWallets.size,
    redemptionTransactions,
    chiRedeemed,
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
  const [transferResult, contractTxResult] = await Promise.allSettled([
    fetchTokenTransfers(),
    fetchContractTransactions()
  ]);

  const warnings = [];
  const transferData = transferResult.status === 'fulfilled' ? transferResult.value : null;
  const contractTxData = contractTxResult.status === 'fulfilled' ? contractTxResult.value : null;

  if (!transferData) {
    warnings.push(`Base CHI transfer feed unavailable: ${transferResult.reason?.message || 'unknown error'}`);
  }
  if (!contractTxData) {
    warnings.push(`Base CHI source-wallet feed unavailable: ${contractTxResult.reason?.message || 'unknown error'}`);
  }
  if (transferData?.capped) {
    warnings.push(`The Base transfer feed reached the ${transferData.fetchedLimit.toLocaleString('en-US')} record fetch limit. Reported totals may be higher.`);
  }

  const allTransfers = transferData?.allTransfers || [];
  const visibleTransfers = enrichTransfersWithTransactions(transferData?.transfers || [], contractTxData);
  const metrics = calculateMetrics(allTransfers);

  return res.status(200).json({
    ok: Boolean(transferData),
    fetchedAt,
    refreshSeconds: 20,
    contract: {
      network: 'Base',
      token: BASE_TOKEN,
      explorerUrl: BASESCAN_TX_URL
    },
    trackedStore: {
      name: TRACKED_STORE.name,
      wallet: TRACKED_STORE.wallet,
      shortWallet: `${TRACKED_STORE.wallet.slice(0, 7)}…${TRACKED_STORE.wallet.slice(-4)}`,
      explorerUrl: `https://basescan.org/address/${TRACKED_STORE.wallet}`
    },
    rules: {
      rewardChiAmount: Number(REWARD_CHI_AMOUNT),
      redemptionChiAmount: Number(REDEMPTION_CHI_AMOUNT),
      classification: 'Exact transfer amount + wallet direction'
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
      signerSource: contractTxData?.source || null,
      signerSourceUrl: contractTxData?.sourceUrl || null,
      explorerUrl: BASESCAN_TX_URL
    },
    note: 'A 5 CHI Base transfer into the tracked America\'s Food Basket wallet is classified as a reward. A 3 CHI Base transfer out of that wallet is classified as a redemption. Shopper wallets count unique counterparty addresses tied to the tracked wallet, excluding the tracked wallet, the CHI token contract, and the zero address.',
    warnings
  });
}
