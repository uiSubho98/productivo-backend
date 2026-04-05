import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const CSC_KEY = '3c8236535c19b189650a7fc46f10e5831b4edb3fce34e974b1edd723bd637c86';
const CSC_BASE = 'https://api.countrystatecity.in/v1';

const INDIA_STATES = [
  { name: 'Andaman and Nicobar Islands', iso2: 'AN' },
  { name: 'Andhra Pradesh', iso2: 'AP' },
  { name: 'Arunachal Pradesh', iso2: 'AR' },
  { name: 'Assam', iso2: 'AS' },
  { name: 'Bihar', iso2: 'BR' },
  { name: 'Chandigarh', iso2: 'CH' },
  { name: 'Chhattisgarh', iso2: 'CT' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', iso2: 'DH' },
  { name: 'Delhi', iso2: 'DL' },
  { name: 'Goa', iso2: 'GA' },
  { name: 'Gujarat', iso2: 'GJ' },
  { name: 'Haryana', iso2: 'HR' },
  { name: 'Himachal Pradesh', iso2: 'HP' },
  { name: 'Jammu and Kashmir', iso2: 'JK' },
  { name: 'Jharkhand', iso2: 'JH' },
  { name: 'Karnataka', iso2: 'KA' },
  { name: 'Kerala', iso2: 'KL' },
  { name: 'Ladakh', iso2: 'LA' },
  { name: 'Lakshadweep', iso2: 'LD' },
  { name: 'Madhya Pradesh', iso2: 'MP' },
  { name: 'Maharashtra', iso2: 'MH' },
  { name: 'Manipur', iso2: 'MN' },
  { name: 'Meghalaya', iso2: 'ML' },
  { name: 'Mizoram', iso2: 'MZ' },
  { name: 'Nagaland', iso2: 'NL' },
  { name: 'Odisha', iso2: 'OR' },
  { name: 'Puducherry', iso2: 'PY' },
  { name: 'Punjab', iso2: 'PB' },
  { name: 'Rajasthan', iso2: 'RJ' },
  { name: 'Sikkim', iso2: 'SK' },
  { name: 'Tamil Nadu', iso2: 'TN' },
  { name: 'Telangana', iso2: 'TG' },
  { name: 'Tripura', iso2: 'TR' },
  { name: 'Uttarakhand', iso2: 'UK' },
  { name: 'Uttar Pradesh', iso2: 'UP' },
  { name: 'West Bengal', iso2: 'WB' },
];

// ─── In-memory city cache ─────────────────────────────────────────────────────
// Cached responses never hit the upstream again for the same state in this process.
const cityCache = new Map();

// ─── CSC usage counters ───────────────────────────────────────────────────────
// Free tier: 3,000 requests/month, 100/day
// Only city fetches hit the upstream (states are static); cached cities don't count.
const cscCounters = {
  monthKey: '',   // 'YYYY-MM'
  dayKey: '',     // 'YYYY-MM-DD'
  monthCount: 0,
  dayCount: 0,
  cacheHits: 0,   // served from cache — no upstream call made
};

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function tickCsc() {
  const day = todayKey();
  const month = thisMonthKey();
  if (cscCounters.dayKey !== day) { cscCounters.dayKey = day; cscCounters.dayCount = 0; }
  if (cscCounters.monthKey !== month) { cscCounters.monthKey = month; cscCounters.monthCount = 0; }
  cscCounters.dayCount++;
  cscCounters.monthCount++;
}

// ─── LocationIQ usage counters ────────────────────────────────────────────────
// Limits: 5,000/day · 60/minute · 2/second
// LocationIQ is called client-side for static map tiles only — we track those
// requests separately when the map endpoint is requested via our proxy.
// (The static map <img> is loaded directly by the browser/RN Image component,
//  so we expose the limits as reference info and let the counter be incremented
//  by any future server-side proxy calls.)
const liqCounters = {
  dayKey: '',
  minuteKey: '',  // 'HH:MM'
  secondKey: '',  // epoch second (string)
  dayCount: 0,
  minuteCount: 0,
  secondCount: 0,
};

function nowMinuteKey() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function nowSecondKey() {
  return String(Math.floor(Date.now() / 1000));
}

export function tickLocationIQ() {
  const day = todayKey();
  const min = nowMinuteKey();
  const sec = nowSecondKey();
  if (liqCounters.dayKey !== day) { liqCounters.dayKey = day; liqCounters.dayCount = 0; }
  if (liqCounters.minuteKey !== min) { liqCounters.minuteKey = min; liqCounters.minuteCount = 0; }
  if (liqCounters.secondKey !== sec) { liqCounters.secondKey = sec; liqCounters.secondCount = 0; }
  liqCounters.dayCount++;
  liqCounters.minuteCount++;
  liqCounters.secondCount++;
}

// ─── Public getter used by superAdminController ───────────────────────────────
export function getLocationUsage() {
  return {
    csc: {
      monthCount: cscCounters.monthCount,
      dayCount: cscCounters.dayCount,
      cacheHits: cscCounters.cacheHits,
      // Free tier limits
      monthlyLimit: 3000,
      dailyLimit: 100,
      cacheSize: cityCache.size,  // how many states are cached (no upstream call needed)
    },
    locationiq: {
      dayCount: liqCounters.dayCount,
      minuteCount: liqCounters.minuteCount,
      secondCount: liqCounters.secondCount,
      // Free tier limits
      dailyLimit: 5000,
      minuteLimit: 60,
      secondLimit: 2,
    },
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/location/states
 * Returns all Indian states with iso2 codes (no upstream call).
 */
router.get('/states', authenticate, (_req, res) => {
  res.json({ success: true, data: INDIA_STATES });
});

/**
 * GET /api/v1/location/cities/:stateIso2
 * Proxies CSC API. Cached responses skip the upstream call entirely.
 */
router.get('/cities/:stateIso2', authenticate, async (req, res) => {
  const { stateIso2 } = req.params;
  const iso = stateIso2.toUpperCase();

  const knownState = INDIA_STATES.find((s) => s.iso2 === iso);
  if (!knownState) {
    return res.status(400).json({ success: false, error: 'Unknown Indian state code.' });
  }

  // Serve from cache — free, no quota consumed
  if (cityCache.has(iso)) {
    cscCounters.cacheHits++;
    return res.json({ success: true, data: cityCache.get(iso), cached: true });
  }

  // Guard against daily/monthly limits before hitting upstream
  const day = todayKey();
  const month = thisMonthKey();
  if (cscCounters.dayKey === day && cscCounters.dayCount >= 100) {
    return res.status(429).json({ success: false, error: 'CSC daily limit reached (100/day). Try again tomorrow.' });
  }
  if (cscCounters.monthKey === month && cscCounters.monthCount >= 3000) {
    return res.status(429).json({ success: false, error: 'CSC monthly limit reached (3,000/month).' });
  }

  try {
    const upstream = await fetch(
      `${CSC_BASE}/countries/IN/states/${iso}/cities`,
      { headers: { 'X-CSCAPI-KEY': CSC_KEY } }
    );

    if (!upstream.ok) {
      return res.status(502).json({ success: false, error: 'Failed to fetch cities from upstream.' });
    }

    const raw = await upstream.json();
    const cities = Array.isArray(raw) ? raw.map((c) => c.name).sort() : [];

    // Cache permanently + tick counter
    cityCache.set(iso, cities);
    tickCsc();

    return res.json({ success: true, data: cities, cached: false });
  } catch (err) {
    console.error('[location] cities fetch error:', err.message);
    return res.status(500).json({ success: false, error: 'Location service unavailable.' });
  }
});

/**
 * GET /api/v1/location/usage
 * Returns current CSC + LocationIQ usage stats (superadmin use).
 */
router.get('/usage', authenticate, (_req, res) => {
  res.json({ success: true, data: getLocationUsage() });
});

export default router;
