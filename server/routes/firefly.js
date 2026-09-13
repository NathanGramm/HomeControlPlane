const express = require('express');

const router = express.Router();

const FIREFLY_URL = process.env.FIREFLY_URL || 'http://firefly-app:8080';
const FIREFLY_API_TOKEN = process.env.FIREFLY_API_TOKEN || '***REMOVED***';

async function fireflyFetch(path) {
  const res = await fetch(`${FIREFLY_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${FIREFLY_API_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// Net worth via summing asset account balances rather than
// /api/v1/summary/basic, which has a long-standing upstream bug rejecting
// valid start/end query params (firefly-iii/firefly-iii#12059). Listing
// asset accounts is a plainer, more stable endpoint and adds up to the
// same thing for a single-currency household setup.
async function getNetWorth() {
  const data = await fireflyFetch('/api/v1/accounts?type=asset&limit=100');
  const byCurrency = new Map();
  for (const account of data.data || []) {
    const a = account.attributes || {};
    const amount = parseFloat(a.current_balance ?? '0');
    if (Number.isNaN(amount)) continue;
    const code = a.currency_code || '?';
    byCurrency.set(code, (byCurrency.get(code) || 0) + amount);
  }
  return [...byCurrency.entries()].map(([currency, amount]) => ({
    currency,
    amount: Math.round(amount * 100) / 100,
  }));
}

async function getRecentTransactions(limit) {
  const data = await fireflyFetch(`/api/v1/transactions?limit=${limit}&page=1`);
  return (data.data || []).map((entry) => {
    // Firefly groups a journal's splits under attributes.transactions[] —
    // a plain (non-split) transaction is just the first and only entry.
    const split = entry.attributes?.transactions?.[0] || {};
    return {
      description: split.description || '(no description)',
      amount: split.amount != null ? parseFloat(split.amount) : null,
      currency: split.currency_code || null,
      type: split.type || null,
      date: split.date || null,
    };
  });
}

// GET /api/firefly/summary -> { configured, netWorth: [{currency, amount}], recentTransactions: [...], updatedAt }
router.get('/summary', async (req, res) => {
  if (!FIREFLY_API_TOKEN) {
    return res.json({
      configured: false,
      netWorth: [],
      recentTransactions: [],
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    const [netWorth, recentTransactions] = await Promise.all([
      getNetWorth().catch((err) => {
        console.warn('Firefly net worth fetch failed:', err.message);
        return [];
      }),
      getRecentTransactions(5).catch((err) => {
        console.warn('Firefly transactions fetch failed:', err.message);
        return [];
      }),
    ]);

    res.json({
      configured: true,
      netWorth,
      recentTransactions,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/firefly/summary failed:', err.message);
    res.status(500).json({ error: 'Could not read Firefly data' });
  }
});

module.exports = router;
