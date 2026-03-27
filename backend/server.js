import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cheerio from 'cheerio';
import { Chess } from 'chess.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/** Quick check that you hit this repo’s API (not an old process without /api/markets). */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'cole-report-api' });
});

function makeCache(ttlMs) {
  return { ttlMs, at: 0, value: null, inflight: null };
}

async function withCache(cache, buildFn) {
  const now = Date.now();
  if (cache.value && now - cache.at < cache.ttlMs) return cache.value;
  if (!cache.inflight) {
    cache.inflight = Promise.resolve()
      .then(buildFn)
      .then((val) => {
        cache.value = val;
        cache.at = Date.now();
        return val;
      })
      .finally(() => {
        cache.inflight = null;
      });
  }
  return cache.inflight;
}

/** Like `withCache`, but does not cache failed bundles (`{ error }` without `fetchedAt`). */
async function withMarketsCache(cache, buildFn) {
  const now = Date.now();
  if (cache.value && now - cache.at < cache.ttlMs) return cache.value;
  if (!cache.inflight) {
    cache.inflight = Promise.resolve()
      .then(buildFn)
      .then((val) => {
        if (val && typeof val === 'object' && val.error != null && val.fetchedAt == null) {
          return val;
        }
        cache.value = val;
        cache.at = Date.now();
        return val;
      })
      .finally(() => {
        cache.inflight = null;
      });
  }
  return cache.inflight;
}

/** Like `withMarketsCache`, for the FRED rates bundle. */
async function withRatesCache(cache, buildFn) {
  const now = Date.now();
  if (cache.value && now - cache.at < cache.ttlMs) return cache.value;
  if (!cache.inflight) {
    cache.inflight = Promise.resolve()
      .then(buildFn)
      .then((val) => {
        if (val && typeof val === 'object' && val.error != null && val.fetchedAt == null) {
          return val;
        }
        cache.value = val;
        cache.at = Date.now();
        return val;
      })
      .finally(() => {
        cache.inflight = null;
      });
  }
  return cache.inflight;
}

// Helper: fetch with timeout and error handling
async function proxyFetch(url, errorMsg = 'Failed to fetch data') {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(errorMsg, err.message);
    return { error: errorMsg, details: err.message };
  }
}

// Helper: fetch and normalize EIA series response
async function fetchEiaSeries(seriesId, key, label) {
  const url = `https://api.eia.gov/v2/seriesid/${seriesId}?api_key=${key}`;
  const data = await proxyFetch(url, `${label} fetch failed`);
  if (data?.error) return data;

  const points = Array.isArray(data?.response?.data) ? data.response.data : [];
  const normalized = points.map((p) => ({ date: p.period, value: p.value }));
  return {
    name: label,
    interval: 'daily',
    unit: 'dollars per barrel',
    data: normalized,
  };
}

const brentCache = makeCache(15 * 60 * 1000);
const wtiCache = makeCache(15 * 60 * 1000);
const treasuryCache = makeCache(15 * 60 * 1000);
const sofrCache = makeCache(15 * 60 * 1000);
const ratesCache = makeCache(15 * 60 * 1000);
const weatherCache = makeCache(10 * 60 * 1000);
const chessCache = makeCache(6 * 60 * 60 * 1000);
const geocodeZipCache = new Map(); // zip -> { at, payload, inflight }
const GEOCODE_ZIP_CACHE_MS = 24 * 60 * 60 * 1000;

function isValidZip(zip) {
  return typeof zip === 'string' && /^\d{5}$/.test(zip);
}

// Brent Crude (EIA)
app.get('/api/brent', async (req, res) => {
  try {
    const key = process.env.EIA_API_KEY;
    if (!key) return res.json({ error: 'EIA_API_KEY not set' });
    const normalized = await withCache(brentCache, () =>
      fetchEiaSeries('PET.RBRTE.D', key, 'Brent Crude Oil Spot Price')
    );
    res.json(normalized);
  } catch (err) {
    res.json({ error: 'Brent fetch failed', details: err.message });
  }
});

// WTI Crude (EIA)
app.get('/api/wti', async (req, res) => {
  try {
    const key = process.env.EIA_API_KEY;
    if (!key) return res.json({ error: 'EIA_API_KEY not set' });
    const normalized = await withCache(wtiCache, () =>
      fetchEiaSeries('PET.RWTC.D', key, 'WTI Crude Oil Spot Price')
    );
    res.json(normalized);
  } catch (err) {
    res.json({ error: 'WTI fetch failed', details: err.message });
  }
});

// US 10Y Treasury (Alpha Vantage FRED)
app.get('/api/treasury', async (req, res) => {
  try {
    const key = process.env.ALPHA_VANTAGE_API_KEY;
    if (!key) return res.json({ error: 'ALPHA_VANTAGE_API_KEY not set' });
    const data = await withCache(treasuryCache, async () => {
      const url = `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${key}`;
      return proxyFetch(url, 'Treasury fetch failed');
    });
    res.json(data);
  } catch (err) {
    res.json({ error: 'Treasury fetch failed', details: err.message });
  }
});

/** Latest observation from a FRED single-series CSV (same pattern as SOFR). */
function parseFredLatestCsv(csvText, { name, sourceUrl }) {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { error: `${name} data empty` };
  let last = null;
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    const date = parts[0].trim();
    const val = parts[1].trim();
    if (val === '.' || val === '') continue;
    const num = Number.parseFloat(val);
    if (!Number.isNaN(num)) {
      last = { date, rate: num };
      break;
    }
  }
  if (!last) return { error: `No ${name} value found` };
  return {
    name,
    rate: last.rate,
    date: last.date,
    unit: 'percent',
    source: 'fred',
    sourceUrl,
  };
}

async function fetchFredLatest(seriesId, displayName, sourceUrl) {
  const res = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`,
    {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }
  );
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const parsed = parseFredLatestCsv(await res.text(), { name: displayName, sourceUrl });
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

async function fetchFredSofr() {
  return fetchFredLatest('SOFR', 'SOFR', 'https://fred.stlouisfed.org/series/SOFR');
}

async function buildFredRatesBundle() {
  try {
    const out = { fetchedAt: new Date().toISOString() };
    const defs = [
      ['sofr', 'SOFR', 'SOFR', 'https://fred.stlouisfed.org/series/SOFR'],
      ['fedFunds', 'DFF', 'Fed funds effective', 'https://fred.stlouisfed.org/series/DFF'],
      ['dgs10', 'DGS10', '10Y Treasury', 'https://fred.stlouisfed.org/series/DGS10'],
      ['dgs2', 'DGS2', '2Y Treasury', 'https://fred.stlouisfed.org/series/DGS2'],
    ];
    await Promise.all(
      defs.map(async ([key, seriesId, label, pageUrl]) => {
        try {
          out[key] = await fetchFredLatest(seriesId, label, pageUrl);
        } catch (e) {
          out[key] = { error: e.message };
        }
      })
    );
    return out;
  } catch (e) {
    console.error('[buildFredRatesBundle]', e);
    return {
      error: 'Rates bundle failed',
      details: String(e?.message || e),
    };
  }
}

app.get('/api/sofr', async (req, res) => {
  try {
    const refresh =
      req.query?.refresh === '1' || req.query?.refresh === 'true' || req.query?.refresh === 'yes';
    if (refresh) {
      sofrCache.value = null;
      sofrCache.at = 0;
    }
    const payload = await withCache(sofrCache, () => fetchFredSofr());
    res.json(payload);
  } catch (err) {
    res.json({ error: 'SOFR fetch failed', details: err.message });
  }
});

/** SOFR + Fed funds + Treasury curve spots — FRED CSV, no API key. */
app.get('/api/rates', async (req, res) => {
  try {
    const refresh =
      req.query?.refresh === '1' || req.query?.refresh === 'true' || req.query?.refresh === 'yes';
    if (refresh) {
      ratesCache.value = null;
      ratesCache.at = 0;
    }
    const payload = await withRatesCache(ratesCache, () => buildFredRatesBundle());
    res.status(200).json(payload);
  } catch (err) {
    console.error('[api/rates]', err);
    res.status(200).json({
      error: 'Rates bundle failed',
      details: String(err?.message || err),
    });
  }
});

const marketsCache = makeCache(2 * 60 * 1000); // 2 min — balances freshness vs upstream limits
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/** Sample std dev of the last 5 daily % moves from 6 consecutive closes (oldest → newest). */
function computeWeeklyVolatilityFromCloses(closes) {
  if (!Array.isArray(closes) || closes.length < 6) return null;
  const nums = closes.map((c) => Number(c)).filter((c) => !Number.isNaN(c));
  if (nums.length < 6) return null;
  const last6 = nums.slice(-6);
  const dailyPct = [];
  for (let i = 1; i < last6.length; i += 1) {
    const prev = last6[i - 1];
    const cur = last6[i];
    if (prev === 0) return null;
    dailyPct.push(((cur - prev) / prev) * 100);
  }
  const mean = dailyPct.reduce((a, b) => a + b, 0) / dailyPct.length;
  const variance = dailyPct.reduce((s, x) => s + (x - mean) ** 2, 0) / dailyPct.length;
  const std = Math.sqrt(variance);
  return Number.isFinite(std) ? std : null;
}

/** Daily close series for volatility — meta fields here are not used (see fetchYahooQuote for quote/day %). */
async function fetchYahooDailyCloses(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': YAHOO_UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.chart?.error) {
    const ce = data.chart.error;
    throw new Error(
      typeof ce === 'string' ? ce : ce.description || ce.code || JSON.stringify(ce)
    );
  }
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error('No chart data');
  const closesRaw = r.indicators?.quote?.[0]?.close;
  return Array.isArray(closesRaw) ? closesRaw : [];
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': YAHOO_UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.chart?.error) {
    const ce = data.chart.error;
    throw new Error(
      typeof ce === 'string' ? ce : ce.description || ce.code || JSON.stringify(ce)
    );
  }
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error('No chart data');
  const meta = r.meta;
  const price = meta.regularMarketPrice ?? meta.previousClose;
  if (price == null) throw new Error('No price');
  /** Prefer price vs previous close — matches Yahoo UI; `regularMarketChangePercent` can be inconsistent across ranges. */
  let changePct = null;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  if (meta.regularMarketPrice != null && prevClose != null) {
    const prev = Number(prevClose);
    const cur = Number(meta.regularMarketPrice);
    if (prev !== 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      changePct = ((cur - prev) / prev) * 100;
    }
  }
  if (changePct == null && meta.regularMarketChangePercent != null) {
    const raw = Number(meta.regularMarketChangePercent);
    if (Number.isFinite(raw)) changePct = raw;
  }
  return {
    price: Number(price),
    currency: meta.currency || 'USD',
    symbol: meta.symbol || symbol,
    changePct: changePct != null ? Number(changePct) : null,
    source: 'yahoo',
  };
}

async function fetchCoinGeckoCrypto() {
  const url =
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,ripple&vs_currencies=usd&include_24hr_change=true';
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': YAHOO_UA },
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  const coin = (id) => {
    const o = data?.[id];
    if (o?.usd == null) return { error: `CoinGecko missing ${id}` };
    return {
      price: o.usd,
      change24hPct: o.usd_24h_change ?? null,
      source: 'coingecko',
    };
  };
  return {
    bitcoin: coin('bitcoin'),
    ethereum: coin('ethereum'),
    xrp: coin('ripple'),
  };
}

async function buildMarketsBundle() {
  try {
    const out = { fetchedAt: new Date().toISOString() };

    const yahooPairs = [
      ['gold', 'GC=F'],
      ['silver', 'SI=F'],
      ['platinum', 'PL=F'],
      ['dow', '^DJI'],
      ['nasdaq', '^IXIC'],
      ['sp500', '^GSPC'],
    ];

    await Promise.all(
      yahooPairs.map(async ([key, sym]) => {
        try {
          out[key] = await fetchYahooQuote(sym);
        } catch (e) {
          out[key] = { error: e.message };
        }
      })
    );

    try {
      const cg = await fetchCoinGeckoCrypto();
      Object.assign(out, cg);
    } catch (e) {
      const msg = e.message;
      out.bitcoin = { error: msg };
      out.ethereum = { error: msg };
      out.xrp = { error: msg };
    }

    return out;
  } catch (e) {
    console.error('[buildMarketsBundle]', e);
    return {
      error: 'Markets bundle failed',
      details: String(e?.message || e),
    };
  }
}

app.get('/api/markets', async (req, res) => {
  try {
    const refresh =
      req.query?.refresh === '1' || req.query?.refresh === 'true' || req.query?.refresh === 'yes';
    if (refresh) {
      marketsCache.value = null;
      marketsCache.at = 0;
    }
    const payload = await withMarketsCache(marketsCache, () => buildMarketsBundle());
    res.status(200).json(payload);
  } catch (err) {
    console.error('[api/markets]', err);
    res.status(200).json({
      error: 'Markets bundle failed',
      details: String(err?.message || err),
    });
  }
});

/** Large-cap names for the header ticker (Yahoo chart API). */
const TICKER_SYMBOLS = [
  ['AAPL', 'Apple'],
  ['MSFT', 'Microsoft'],
  ['GOOGL', 'Alphabet'],
  ['AMZN', 'Amazon'],
  ['NVDA', 'NVIDIA'],
  ['META', 'Meta'],
  ['TSLA', 'Tesla'],
  ['JPM', 'JPMorgan'],
  ['V', 'Visa'],
  ['UNH', 'UnitedHealth'],
  ['XOM', 'Exxon'],
  ['WMT', 'Walmart'],
  ['AVGO', 'Broadcom'],
  ['LLY', 'Eli Lilly'],
  ['COST', 'Costco'],
  ['FITB', 'Fifth Third'],
  ['MA', 'Mastercard'],
  ['HD', 'Home Depot'],
];

async function buildTickerBundle() {
  try {
    const fetchedAt = new Date().toISOString();
    const items = await Promise.all(
      TICKER_SYMBOLS.map(async ([symbol, label]) => {
        try {
          const [q, closes] = await Promise.all([
            fetchYahooQuote(symbol),
            fetchYahooDailyCloses(symbol).catch(() => []),
          ]);
          return {
            symbol,
            label,
            price: q.price,
            changePct: q.changePct,
            weeklyVolatilityPct: computeWeeklyVolatilityFromCloses(closes),
          };
        } catch (e) {
          return { symbol, label, error: e.message };
        }
      })
    );
    items.sort((a, b) => a.symbol.localeCompare(b.symbol));
    const withVol = items.filter(
      (it) => it.weeklyVolatilityPct != null && !it.error
    );
    const topWeeklyVolatility = [...withVol]
      .sort((a, b) => b.weeklyVolatilityPct - a.weeklyVolatilityPct)
      .slice(0, 5)
      .map((it) => ({
        symbol: it.symbol,
        label: it.label,
        price: it.price,
        changePct: it.changePct,
        weeklyVolatilityPct: it.weeklyVolatilityPct,
      }));
    return { fetchedAt, items, topWeeklyVolatility };
  } catch (e) {
    console.error('[buildTickerBundle]', e);
    return { error: 'Ticker bundle failed', details: String(e?.message || e) };
  }
}

const tickerCache = makeCache(90 * 1000);

app.get('/api/ticker', async (req, res) => {
  try {
    const refresh =
      req.query?.refresh === '1' || req.query?.refresh === 'true' || req.query?.refresh === 'yes';
    if (refresh) {
      tickerCache.value = null;
      tickerCache.at = 0;
    }
    const payload = await withMarketsCache(tickerCache, () => buildTickerBundle());
    res.status(200).json(payload);
  } catch (err) {
    console.error('[api/ticker]', err);
    res.status(200).json({
      error: 'Ticker bundle failed',
      details: String(err?.message || err),
    });
  }
});

/** TheSportsDB v1 — https://www.thesportsdb.com/api.php (free key `123` or set THESPORTSDB_API_KEY). */
const THESPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json';

const SPORTS_LEAGUES = [
  { key: 'nba', id: '4387', name: 'NBA' },
  { key: 'nfl', id: '4391', name: 'NFL' },
  { key: 'mlb', id: '4424', name: 'MLB' },
  { key: 'nhl', id: '4380', name: 'NHL' },
  { key: 'epl', id: '4328', name: 'Premier League' },
];

function easternDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function easternTimeHhMmSsFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === 'hour')?.value;
  const mm = parts.find((p) => p.type === 'minute')?.value;
  const ss = parts.find((p) => p.type === 'second')?.value;
  if (!hh || !mm || !ss) return null;
  return `${hh}:${mm}:${ss}`;
}

async function sportsDbFetch(apiKey, pathQuery) {
  const url = `${THESPORTSDB_BASE}/${apiKey}/${pathQuery}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': YAHOO_UA },
  });
  if (!res.ok) throw new Error(`TheSportsDB HTTP ${res.status}`);
  return res.json();
}

function normalizeSportsEvent(e, leagueFallback = null) {
  if (!e || typeof e !== 'object') return null;
  const fromApi = e.strLeague && String(e.strLeague).trim();
  const league = fromApi || (leagueFallback && String(leagueFallback).trim()) || null;
  const timestamp = e.strTimestamp || null;
  const derivedTimeLocal = easternTimeHhMmSsFromIso(timestamp);
  return {
    id: e.idEvent,
    event: e.strEvent,
    home: e.strHomeTeam,
    away: e.strAwayTeam,
    homeScore: e.intHomeScore,
    awayScore: e.intAwayScore,
    homeBadge: e.strHomeTeamBadge || e.strHomeBadge || null,
    awayBadge: e.strAwayTeamBadge || e.strAwayBadge || null,
    date: e.dateEvent,
    /** Local calendar date at the venue (when present); use with finished games for “concluded on” display. */
    dateLocal: e.dateEventLocal || null,
    // Prefer TheSportsDB's venue-local time when available (e.g. basketball often differs in meaning from strTime).
    timeLocal: derivedTimeLocal || e.strTimeLocal || e.strTime,
    /** ISO-like UTC start time from API (used client-side for upcoming vs latest). */
    timestamp,
    league,
    season: e.strSeason,
    status: e.strStatus,
    venue: e.strVenue,
  };
}

function firstEventFromLeagueSchedule(j) {
  if (!j) return null;
  const ev = j.events;
  if (Array.isArray(ev) && ev.length) return ev[0];
  if (ev && typeof ev === 'object') return ev;
  return null;
}

function eventsFromDayJson(j) {
  if (!j) return [];
  const raw = j.events;
  return Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
}

function espnDateLabelToYmd(dateLabel) {
  // The ESPN scoreboard `dates` parameter expects YYYYMMDD.
  const s = String(dateLabel || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replaceAll('-', '');
  return s.replaceAll('-', '');
}

function espnEventStartTimeLocal(startIso) {
  // Convert ISO timestamp to Eastern HH:MM:00.
  const d = new Date(startIso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === 'hour')?.value;
  const mm = parts.find((p) => p.type === 'minute')?.value;
  if (!hh || !mm) return null;
  return `${hh}:${mm}:00`;
}

function normalizeEspnNbaEvent(espnEvent, dateLabel) {
  const comp = espnEvent?.competitions?.[0];
  if (!comp) return null;

  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const homeComp = competitors.find((c) => c?.homeAway === 'home') || competitors[0];
  const awayComp = competitors.find((c) => c?.homeAway === 'away') || competitors[1] || competitors[0];

  const home = homeComp?.team?.displayName || null;
  const away = awayComp?.team?.displayName || null;
  if (!home || !away) return null;

  const statusType = comp?.status?.type || {};
  const completed = statusType?.completed === true;
  const state = String(statusType?.state || '').toLowerCase();
  const statusName = String(statusType?.name || '');

  let status = 'Scheduled';
  let homeScore = null;
  let awayScore = null;

  if (completed) {
    status = 'Final';
    homeScore = homeComp?.score ?? null;
    awayScore = awayComp?.score ?? null;
  } else if (state.includes('in')) {
    status = 'In Progress';
    homeScore = homeComp?.score ?? null;
    awayScore = awayComp?.score ?? null;
  } else if (/SCHEDULED/i.test(statusName) || state.includes('pre')) {
    status = 'Scheduled';
  } else if (/POST/i.test(statusName) || state.includes('post')) {
    status = 'Final';
    homeScore = homeComp?.score ?? null;
    awayScore = awayComp?.score ?? null;
  }

  // ESPN returns `date` in an ISO string (typically UTC). We also store an Eastern-local-ish display string for the UI.
  const startIso = comp?.date;
  const timestamp = startIso ? String(startIso) : null;

  const timeLocal = startIso ? espnEventStartTimeLocal(startIso) : null;

  // For this UI, `dateLocal` is used to display "Ended <date>" for finished games. ESPN doesn't provide an end timestamp,
  // so we treat the scoreboard date as the concluded calendar date.
  const date = dateLabel;
  const dateLocal = dateLabel;

  const venue = comp?.venue?.name || null;

  return {
    id: espnEvent?.id ?? `${dateLabel}:${home}:${away}`,
    event: `${away} vs ${home}`,
    home,
    away,
    homeScore,
    awayScore,
    homeBadge: null,
    awayBadge: null,
    date,
    dateLocal,
    timeLocal,
    timestamp,
    league: 'NBA',
    season: null,
    status,
    venue,
  };
}

const __serverDir = path.dirname(fileURLToPath(import.meta.url));
const TEAM_BADGE_CACHE_VERSION = 2;
const TEAM_BADGE_CACHE_FILE = path.join(__serverDir, '.team-badge-cache.json');

/** @type {Map<string, string>} */
const nbaTeamBadgeCache = new Map();
const nbaTeamBadgeInflight = new Map();

try {
  if (fs.existsSync(TEAM_BADGE_CACHE_FILE)) {
    const raw = fs.readFileSync(TEAM_BADGE_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version === TEAM_BADGE_CACHE_VERSION && parsed?.byKey && typeof parsed.byKey === 'object') {
      for (const [k, v] of Object.entries(parsed.byKey)) {
        if (typeof v === 'string' && v.trim()) nbaTeamBadgeCache.set(k, v);
      }
    }
  }
} catch (e) {
  console.warn('[sports] team badge cache load failed:', String(e?.message || e));
}

function persistTeamBadgeCache() {
  try {
    const byKey = Object.fromEntries(nbaTeamBadgeCache.entries());
    fs.writeFileSync(TEAM_BADGE_CACHE_FILE, JSON.stringify({ version: TEAM_BADGE_CACHE_VERSION, byKey }, null, 2));
  } catch (e) {
    console.warn('[sports] team badge cache write failed:', String(e?.message || e));
  }
}

async function fetchTeamBadgeFromTheSportsDb(apiKey, teamName) {
  const k = String(teamName || '').trim().toLowerCase();
  if (!k) return null;
  if (nbaTeamBadgeCache.has(k)) return nbaTeamBadgeCache.get(k) || null;
  if (nbaTeamBadgeInflight.has(k)) return nbaTeamBadgeInflight.get(k);

  const p = (async () => {
    const res = await sportsDbFetch(apiKey, `searchteams.php?t=${encodeURIComponent(teamName)}`).catch((err) => {
      console.warn('[sports] team logo fetch failed:', teamName, err?.message || err);
      return null;
    });
    const teams = Array.isArray(res?.teams) ? res.teams : [];
    const badge = teams[0]?.strBadge || teams[0]?.strLogo || null;
    if (badge) {
      nbaTeamBadgeCache.set(k, badge);
      persistTeamBadgeCache();
    }
    return badge;
  })();

  nbaTeamBadgeInflight.set(k, p);
  try {
    return await p;
  } finally {
    nbaTeamBadgeInflight.delete(k);
  }
}

async function fetchEspnNbaEventsForDate(apiKey, dateLabel) {
  const ymd = espnDateLabelToYmd(dateLabel);
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${encodeURIComponent(ymd)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': YAHOO_UA },
  });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const j = await res.json();
  const events = Array.isArray(j?.events) ? j.events : [];
  const normalized = events.map((ev) => normalizeEspnNbaEvent(ev, dateLabel)).filter(Boolean);
  // Attach TheSportsDB team badges so the UI stays consistent.
  return Promise.all(
    normalized.map(async (e) => {
      const [homeBadge, awayBadge] = await Promise.all([
        fetchTeamBadgeFromTheSportsDb(apiKey, e.home),
        fetchTeamBadgeFromTheSportsDb(apiKey, e.away),
      ]);
      return { ...e, homeBadge, awayBadge };
    })
  );
}

function normalizeEspnMlbEvent(espnEvent, dateLabel) {
  const comp = espnEvent?.competitions?.[0];
  if (!comp) return null;

  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const homeComp = competitors.find((c) => c?.homeAway === 'home') || competitors[0];
  const awayComp =
    competitors.find((c) => c?.homeAway === 'away') || competitors[1] || competitors[0] || null;

  const home = homeComp?.team?.displayName || null;
  const away = awayComp?.team?.displayName || null;
  if (!home || !away) return null;

  const statusType = comp?.status?.type || {};
  const completed = statusType?.completed === true;
  const state = String(statusType?.state || '').toLowerCase();

  let status = 'Scheduled';
  let homeScore = null;
  let awayScore = null;

  if (completed) {
    status = 'Final';
    homeScore = homeComp?.score ?? null;
    awayScore = awayComp?.score ?? null;
  } else if (state.includes('in')) {
    status = 'In Progress';
    homeScore = homeComp?.score ?? null;
    awayScore = awayComp?.score ?? null;
  } else {
    status = 'Scheduled';
  }

  const startIso = comp?.date;
  const timestamp = startIso ? String(startIso) : null;
  const timeLocal = startIso ? espnEventStartTimeLocal(startIso) : null;

  return {
    id: espnEvent?.id ?? `${dateLabel}:${home}:${away}`,
    event: `${away} vs ${home}`,
    home,
    away,
    homeScore,
    awayScore,
    homeBadge: null,
    awayBadge: null,
    date: dateLabel,
    dateLocal: dateLabel,
    timeLocal,
    timestamp,
    league: 'MLB',
    season: null,
    status,
    venue: comp?.venue?.name || null,
  };
}

async function fetchEspnMlbEventsForDate(apiKey, dateLabel) {
  const ymd = espnDateLabelToYmd(dateLabel);
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${encodeURIComponent(ymd)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': YAHOO_UA },
  });
  if (!res.ok) throw new Error(`ESPN MLB HTTP ${res.status}`);
  const j = await res.json();
  const events = Array.isArray(j?.events) ? j.events : [];

  const normalized = events.map((ev) => normalizeEspnMlbEvent(ev, dateLabel)).filter(Boolean);
  return Promise.all(
    normalized.map(async (e) => {
      const [homeBadge, awayBadge] = await Promise.all([
        fetchTeamBadgeFromTheSportsDb(apiKey, e.home),
        fetchTeamBadgeFromTheSportsDb(apiKey, e.away),
      ]);
      return { ...e, homeBadge, awayBadge };
    })
  );
}

function eventDedupeKey(e) {
  const id = e?.idEvent;
  if (id != null && id !== '') return `id:${id}`;
  return `f:${e?.strEvent}|${e?.dateEvent}|${e?.strHomeTeam}|${e?.strAwayTeam}`;
}

function crossTeamDedupeKey(e) {
  const league = e?.league || '';
  const date = e?.date || '';
  const h = e?.home || '';
  const a = e?.away || '';
  if (!league || !date || !h || !a) return null;
  const pair = [h, a].sort((x, y) => String(x).localeCompare(String(y)));
  return `f:${league}|${date}|${pair[0]}|${pair[1]}`;
}

/**
 * Global eventsday + per-league eventsday. League-scoped responses often omit `strLeague`; we pass the known
 * league name so UI grouping (NBA vs Other) matches. Later rows enrich earlier duplicates with league when missing.
 */
function mergeTodayEventsFromFeeds(globalJson, leagueDayPairs) {
  /** @type {Map<string, ReturnType<typeof normalizeSportsEvent>>} */
  const items = new Map();

  function addRaw(e, leagueFallback) {
    const n = normalizeSportsEvent(e, leagueFallback);
    if (!n) return;
    const k = eventDedupeKey(e);
    const prev = items.get(k);
    if (!prev) {
      items.set(k, n);
      return;
    }
    if ((!prev.league || !String(prev.league).trim()) && n.league) {
      items.set(k, { ...prev, league: n.league });
    }
  }

  for (const e of eventsFromDayJson(globalJson)) {
    addRaw(e, null);
  }
  for (const { L, json } of leagueDayPairs) {
    if (!json) continue;
    for (const e of eventsFromDayJson(json)) {
      addRaw(e, L.name);
    }
  }

  return [...items.values()];
}

async function fetchEventsDayForLeague(apiKey, dateLabel, L) {
  const d = encodeURIComponent(dateLabel);
  // TheSportsDB often returns events:null for eventsday.php?l={numeric id} (e.g. NBA 4387) but works with l=NBA.
  const byName = await sportsDbFetch(apiKey, `eventsday.php?d=${d}&l=${encodeURIComponent(L.name)}`).catch((err) => {
    console.warn(`[sports] eventsday league ${L.key} (name):`, err?.message || err);
    return null;
  });
  if (eventsFromDayJson(byName).length > 0) return byName;
  const byId = await sportsDbFetch(apiKey, `eventsday.php?d=${d}&l=${L.id}`).catch((err) => {
    console.warn(`[sports] eventsday league ${L.key} (id):`, err?.message || err);
    return null;
  });
  return eventsFromDayJson(byId).length > 0 ? byId : byName;
}

async function buildSportsBundle() {
  const apiKey = process.env.THESPORTSDB_API_KEY || '123';
  const fetchedAt = new Date().toISOString();
  const dateLabel = easternDateString();

  try {
    let globalDay = null;
    try {
      globalDay = await sportsDbFetch(apiKey, `eventsday.php?d=${encodeURIComponent(dateLabel)}`);
    } catch (err) {
      // TheSportsDB rate-limits (429) sometimes; don't fail the whole bundle.
      const msg = String(err?.message || err || '');
      if (msg.includes('429')) {
        console.warn('[sports] TheSportsDB global eventsday rate-limited; returning partial bundle');
      } else {
        throw err;
      }
    }

    const leagueDayPairs = await Promise.all(
      SPORTS_LEAGUES.map(async (L) => ({
        L,
        json: await fetchEventsDayForLeague(apiKey, dateLabel, L),
      }))
    );

    const leaguePayloads = await Promise.all(
      SPORTS_LEAGUES.map((L) =>
        sportsDbFetch(apiKey, `eventsnextleague.php?id=${L.id}`)
          .then((j) => ({ league: L, j }))
          .catch((err) => ({ league: L, error: String(err?.message || err) }))
      )
    );

    const todayEventsFromSportsdb = mergeTodayEventsFromFeeds(globalDay, leagueDayPairs);

    // Cross-reference NBA with ESPN scoreboard because TheSportsDB sometimes misses specific matchups for the day.
    const espnNbaEvents = await fetchEspnNbaEventsForDate(apiKey, dateLabel).catch((err) => {
      console.warn('[sports] ESPN NBA fetch failed:', err?.message || err);
      return [];
    });

    /** @type {Map<string, ReturnType<typeof normalizeSportsEvent>>} */
    const deduped = new Map();

    for (const e of todayEventsFromSportsdb) {
      const k = crossTeamDedupeKey(e);
      if (!deduped.has(k)) deduped.set(k, e);
    }
    // Prefer ESPN fields (start time/status/scores) when both sources have the same game.
    // Keep any existing badges from TheSportsDB/cached logos when ESPN doesn't have one.
    for (const e of espnNbaEvents) {
      const k = crossTeamDedupeKey(e);
      const prev = deduped.get(k);
      if (!prev) {
        deduped.set(k, e);
        continue;
      }
      deduped.set(k, {
        ...prev,
        ...e,
        homeBadge: e.homeBadge || prev.homeBadge,
        awayBadge: e.awayBadge || prev.awayBadge,
      });
    }

    // Cross-reference MLB with ESPN so live baseball scores are present.
    const espnMlbEvents = await fetchEspnMlbEventsForDate(apiKey, dateLabel).catch((err) => {
      console.warn('[sports] ESPN MLB fetch failed:', err?.message || err);
      return [];
    });

    for (const e of espnMlbEvents) {
      const k = crossTeamDedupeKey(e);
      const prev = deduped.get(k);
      if (!prev) {
        deduped.set(k, e);
        continue;
      }
      deduped.set(k, {
        ...prev,
        ...e,
        homeBadge: e.homeBadge || prev.homeBadge,
        awayBadge: e.awayBadge || prev.awayBadge,
      });
    }

    const todayEvents = [...deduped.values()].sort((a, b) => {
      const byLeague = String(a.league || '').localeCompare(String(b.league || ''));
      if (byLeague !== 0) return byLeague;
      return String(a.timeLocal || '').localeCompare(String(b.timeLocal || ''));
    });

    const upcomingByLeague = leaguePayloads.map((row) => {
      if (row.error) {
        return { key: row.league.key, name: row.league.name, error: row.error };
      }
      const raw = firstEventFromLeagueSchedule(row.j);
      return {
        key: row.league.key,
        name: row.league.name,
        nextEvent: normalizeSportsEvent(raw, row.league.name),
      };
    });

    return {
      fetchedAt,
      dateLabel,
      source: 'thesportsdb+espn-nba+espn-mlb',
      todayEvents,
      upcomingByLeague,
    };
  } catch (e) {
    console.error('[buildSportsBundle]', e);
    return {
      error: 'Sports bundle failed',
      details: String(e?.message || e),
    };
  }
}

// Live scores change quickly; keep this bundle relatively fresh.
const sportsCache = makeCache(2 * 60 * 1000);

app.get('/api/sports', async (req, res) => {
  try {
    const refresh =
      req.query?.refresh === '1' || req.query?.refresh === 'true' || req.query?.refresh === 'yes';
    if (refresh) {
      sportsCache.value = null;
      sportsCache.at = 0;
    }
    const payload = await withMarketsCache(sportsCache, () => buildSportsBundle());
    res.status(200).json(payload);
  } catch (err) {
    console.error('[api/sports]', err);
    res.status(200).json({
      error: 'Sports bundle failed',
      details: String(err?.message || err),
    });
  }
});

function parseChessComMoveOfDay(data) {
  if (data?.error) return data;
  const line = typeof data?.pgn === 'string' ? data.pgn : '';
  const moveText = line
    .split(/\r?\n\r?\n/)
    .slice(-1)[0]
    .replace(/\[[^\]]+\]/g, '')
    .trim();
  const moveTokens = moveText
    .replace(/\r?\n/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  const suggested = moveTokens.length > 0 ? moveTokens[0] : null;
  return {
    source: 'chesscom',
    title: data?.title ?? 'Chess Move of the Day',
    url: data?.url ?? 'https://www.chess.com/daily-chess-puzzle',
    image: data?.image ?? null,
    fen: data?.fen ?? null,
    pgn: data?.pgn ?? null,
    suggestedMove: suggested,
    solutionSan: moveTokens.length ? moveTokens : null,
    published: data?.publish_time ?? null,
  };
}

function uciToSanFromFen(fen, uci) {
  const move = String(uci || '').trim().toLowerCase();
  const match = move.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) return null;
  const game = new Chess(fen);
  const result = game.move({
    from: match[1],
    to: match[2],
    promotion: match[3] || undefined,
  });
  return result?.san ?? null;
}

function uciLineToSanLine(fen, uciMoves) {
  const startFen = String(fen || '').trim();
  if (!startFen) return null;
  if (!Array.isArray(uciMoves) || uciMoves.length === 0) return null;

  const game = new Chess(startFen);
  const san = [];

  for (const uci of uciMoves) {
    const move = String(uci || '').trim().toLowerCase();
    const match = move.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!match) return null;
    const result = game.move({
      from: match[1],
      to: match[2],
      promotion: match[3] || undefined,
    });
    if (!result?.san) return null;
    san.push(result.san);
  }

  return san;
}

function buildFenAtInitialPly(pgn, initialPly) {
  const fullGame = new Chess();
  fullGame.loadPgn(String(pgn || ''));
  const history = fullGame.history();
  const baseGame = new Chess();
  const ply = Number.isInteger(initialPly) ? initialPly : 0;
  for (let i = 0; i < ply && i < history.length; i += 1) {
    const ok = baseGame.move(history[i], { sloppy: true });
    if (!ok) throw new Error('Could not reconstruct puzzle position');
  }
  return baseGame.fen();
}

function canPlayUciOnFen(fen, uci) {
  const move = String(uci || '').trim().toLowerCase();
  const match = move.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) return false;
  try {
    const game = new Chess(fen);
    const result = game.move({
      from: match[1],
      to: match[2],
      promotion: match[3] || undefined,
    });
    return !!result;
  } catch {
    return false;
  }
}

async function fetchLichessMoveOfDay() {
  const data = await proxyFetch('https://lichess.org/api/puzzle/daily', 'Lichess daily puzzle fetch failed');
  if (data?.error) throw new Error(data.error);
  const pgn = data?.game?.pgn;
  const initialPly = data?.puzzle?.initialPly;
  const firstUciMove = data?.puzzle?.solution?.[0];
  const candidatePlies = [initialPly, initialPly + 1, initialPly - 1, initialPly + 2].filter((v) =>
    Number.isInteger(v)
  );
  let fen = null;
  for (const ply of candidatePlies) {
    try {
      const candidateFen = buildFenAtInitialPly(pgn, ply);
      if (canPlayUciOnFen(candidateFen, firstUciMove)) {
        fen = candidateFen;
        break;
      }
    } catch {
      // Try the next candidate if this ply cannot be reconstructed.
    }
  }
  if (!fen) throw new Error('Could not reconstruct a valid Lichess puzzle position');
  const solutionUci = Array.isArray(data?.puzzle?.solution) ? data.puzzle.solution : [];
  const solutionSan = uciLineToSanLine(fen, solutionUci);
  const suggestedMove = solutionSan?.[0] ?? uciToSanFromFen(fen, firstUciMove);
  if (!suggestedMove) throw new Error('Could not normalize Lichess solution move');
  return {
    source: 'lichess',
    title: 'Lichess Daily Puzzle',
    url: 'https://lichess.org/training/daily',
    image: null,
    fen,
    pgn,
    suggestedMove,
    solutionSan: solutionSan?.length ? solutionSan : null,
    published: null,
  };
}

async function fetchChessComMoveOfDay() {
  const data = await proxyFetch('https://api.chess.com/pub/puzzle', 'Chess puzzle fetch failed');
  const parsed = parseChessComMoveOfDay(data);
  if (parsed?.error) throw new Error(parsed.error);
  return parsed;
}

// Chess move of the day (Lichess daily puzzle with Chess.com fallback)
app.get('/api/chess/move-of-day', async (req, res) => {
  try {
    const payload = await withCache(chessCache, async () => {
      try {
        return await fetchLichessMoveOfDay();
      } catch (lichessErr) {
        console.warn('Lichess daily puzzle unavailable, falling back to Chess.com:', lichessErr.message);
        return fetchChessComMoveOfDay();
      }
    });
    res.json(payload);
  } catch (err) {
    res.json({ error: 'Chess move fetch failed', details: err.message });
  }
});

// Zip -> lat/lon (OpenWeather Geocoding)
app.get('/api/geocode/zip/:zip', async (req, res) => {
  try {
    const zip = String(req.params.zip || '').trim();
    if (!isValidZip(zip)) return res.json({ error: 'Invalid zip code' });
    const key = process.env.OPENWEATHER_API_KEY?.trim();
    if (!key) return res.json({ error: 'OPENWEATHER_API_KEY not set' });

    const cached = geocodeZipCache.get(zip);
    const now = Date.now();
    if (cached?.payload && now - cached.at < GEOCODE_ZIP_CACHE_MS) return res.json(cached.payload);

    if (!cached?.inflight) {
      const inflight = (async () => {
        const url = `https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(
          zip
        )},US&appid=${encodeURIComponent(key)}`;
        const payload = await proxyFetch(url, 'Zip geocode failed');
        geocodeZipCache.set(zip, { at: Date.now(), payload, inflight: null });
        return payload;
      })().finally(() => {
        const next = geocodeZipCache.get(zip);
        if (next?.inflight) geocodeZipCache.set(zip, { ...next, inflight: null });
      });
      geocodeZipCache.set(zip, { at: now, payload: null, inflight });
    }

    const payload = await geocodeZipCache.get(zip).inflight;

    if (payload?.error) return res.json(payload);
    if (payload?.cod === '404' || payload?.cod === 404) return res.json({ error: 'Zip not found' });
    const lat = Number(payload?.lat);
    const lon = Number(payload?.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return res.json({ error: 'Zip not found' });
    res.json({ zip, lat, lon, name: payload?.name ?? null });
  } catch (err) {
    res.json({ error: 'Zip geocode failed', details: err.message });
  }
});

const AAA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const AAA_TIMEOUT_MS = 10000;
const GAS_ALL_CACHE_MS = 15 * 60 * 1000; // align with client refresh

async function fetchAaaHtml(url) {
  const resFetch = await fetch(url, {
    signal: AbortSignal.timeout(AAA_TIMEOUT_MS),
    headers: { 'User-Agent': AAA_UA },
  });
  if (!resFetch.ok) throw new Error(`AAA HTTP ${resFetch.status}`);
  return resFetch.text();
}

function looksLikeBotBlock(html) {
  const s = String(html || '');
  if (!s) return false;
  const h = s.toLowerCase();
  return (
    h.includes('access denied') ||
    h.includes('captcha') ||
    h.includes('cf-turnstile') ||
    h.includes('cloudflare') ||
    h.includes('attention required') ||
    h.includes('verify you are human') ||
    h.includes('bot detection') ||
    h.includes('unusual traffic')
  );
}

function hasAnyNumericPrice(rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    for (const k of ['regular', 'midGrade', 'premium', 'diesel']) {
      const v = r[k];
      if (v == null) continue;
      const n = Number.parseFloat(String(v).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(n) && n > 0) return true;
    }
  }
  return false;
}


function parseGasTableFromHtml(html) {
  if (looksLikeBotBlock(html)) {
    return { error: 'AAA blocked automated requests', details: 'Upstream returned a bot-check page.' };
  }
  const $ = cheerio.load(html);
  const rowLabels = ['current', 'yesterday', 'weekAgo', 'monthAgo', 'yearAgo'];
  const colKeys = ['regular', 'midGrade', 'premium', 'diesel'];
  const rows = [];
  const baseSelector = 'main > div:nth-child(3) > div:nth-child(3) > table > tbody > tr';
  const fallbackLabels = ['Current Avg.', 'Yesterday Avg.', 'Week Ago Avg.', 'Month Ago Avg.', 'Year Ago Avg.'];

  for (let r = 0; r < 5; r++) {
    const row = { label: rowLabels[r], regular: null, midGrade: null, premium: null, diesel: null };
    for (let c = 0; c < 4; c++) {
      let cell = $(`${baseSelector}:nth-child(${r + 1}) > td:nth-child(${c + 2})`).text().trim();
      if (!cell) {
        $('table tbody tr').each((_, tr) => {
          const tds = $(tr).find('td');
          if ($(tds[0]).text().includes(fallbackLabels[r]) && tds.length > c + 1) {
            cell = $(tds[c + 1]).text().trim();
            return false;
          }
        });
      }
      const match = cell?.match(/\$?([\d.]+)/);
      row[colKeys[c]] = match ? match[1] : null;
    }
    rows.push(row);
  }
  if (!hasAnyNumericPrice(rows)) {
    return {
      error: 'AAA gas prices unavailable',
      details: 'Could not extract prices (AAA page layout changed or upstream blocked this server).',
    };
  }
  return { rows };
}

/** Charlotte metro table from NC state page HTML (same URL as state-level scrape). */
function parseCharlotteFromNcHtml(html) {
  if (looksLikeBotBlock(html)) {
    return { error: 'AAA blocked automated requests', details: 'Upstream returned a bot-check page.' };
  }
  const $ = cheerio.load(html);
  const rowLabels = ['current', 'yesterday', 'weekAgo', 'monthAgo', 'yearAgo'];
  const colKeys = ['regular', 'midGrade', 'premium', 'diesel'];
  const rows = [];
  let charlotteTable = null;

  $('.accordion-prices h3, .metros-js h3, [class*="accordion"] h3, main h3').each((_, h3) => {
    const text = $(h3).text();
    if (text.includes('Charlotte-Gastonia-Rock Hill')) {
      const $panel = $(h3).next('div');
      const $tbody = $panel.find('table tbody');
      if ($tbody.length && $tbody.find('tr').length >= 5) {
        charlotteTable = $tbody.closest('table');
        return false;
      }
    }
  });

  if (!charlotteTable || charlotteTable.length === 0) {
    return { error: 'Charlotte gas table not found' };
  }

  const trs = charlotteTable.find('tbody tr');
  for (let r = 0; r < 5 && r < trs.length; r++) {
    const row = { label: rowLabels[r], regular: null, midGrade: null, premium: null, diesel: null };
    const tds = $(trs[r]).find('td');
    for (let c = 0; c < 4 && c + 1 < tds.length; c++) {
      const cell = $(tds[c + 1]).text().trim();
      const match = cell.match(/\$?([\d.]+)/);
      row[colKeys[c]] = match ? match[1] : null;
    }
    rows.push(row);
  }
  if (!hasAnyNumericPrice(rows)) {
    return {
      error: 'AAA Charlotte gas prices unavailable',
      details: 'Could not extract prices (AAA page layout changed or upstream blocked this server).',
    };
  }
  return { rows };
}

async function scrapeGasPrices(url) {
  const html = await fetchAaaHtml(url);
  return parseGasTableFromHtml(html);
}

let gasAllCache = { at: 0, payload: null };
let gasAllInflight = null;

async function buildGasAllBundle() {
  const [nationalHtml, ncHtml, scHtml] = await Promise.all([
    fetchAaaHtml('https://gasprices.aaa.com/'),
    fetchAaaHtml('https://gasprices.aaa.com/?state=NC'),
    fetchAaaHtml('https://gasprices.aaa.com/?state=SC'),
  ]);
  return {
    gas: parseGasTableFromHtml(nationalHtml),
    gasNc: parseGasTableFromHtml(ncHtml),
    gasSc: parseGasTableFromHtml(scHtml),
    gasCharlotte: parseCharlotteFromNcHtml(ncHtml),
  };
}

// All gas regions in one response: 3 AAA pages (NC reused for Charlotte), cached
app.get('/api/gas/all', async (req, res) => {
  try {
    const now = Date.now();
    if (gasAllCache.payload && now - gasAllCache.at < GAS_ALL_CACHE_MS) {
      return res.json(gasAllCache.payload);
    }
    if (!gasAllInflight) {
      gasAllInflight = buildGasAllBundle()
        .then((payload) => {
          gasAllCache = { at: Date.now(), payload };
          return payload;
        })
        .finally(() => {
          gasAllInflight = null;
        });
    }
    const payload = await gasAllInflight;
    res.json(payload);
  } catch (err) {
    console.error('AAA gas/all failed', err.message);
    res.json({ error: 'AAA gas bundle failed', details: err.message });
  }
});

// Gas prices - National
app.get('/api/gas', async (req, res) => {
  try {
    const data = await scrapeGasPrices('https://gasprices.aaa.com/');
    res.json(data);
  } catch (err) {
    console.error('AAA national gas scrape failed', err.message);
    res.json({ error: 'AAA gas scrape failed', details: err.message });
  }
});

// Gas prices - North Carolina
app.get('/api/gas/nc', async (req, res) => {
  try {
    const data = await scrapeGasPrices('https://gasprices.aaa.com/?state=NC');
    res.json(data);
  } catch (err) {
    console.error('AAA NC gas scrape failed', err.message);
    res.json({ error: 'AAA NC gas scrape failed', details: err.message });
  }
});

// Gas prices - South Carolina
app.get('/api/gas/sc', async (req, res) => {
  try {
    const data = await scrapeGasPrices('https://gasprices.aaa.com/?state=SC');
    res.json(data);
  } catch (err) {
    console.error('AAA SC gas scrape failed', err.message);
    res.json({ error: 'AAA SC gas scrape failed', details: err.message });
  }
});

// Gas prices - Charlotte-Gastonia-Rock Hill (NC only)
app.get('/api/gas/charlotte', async (req, res) => {
  try {
    const html = await fetchAaaHtml('https://gasprices.aaa.com/?state=NC');
    const data = parseCharlotteFromNcHtml(html);
    res.json(data);
  } catch (err) {
    console.error('AAA Charlotte gas scrape failed', err.message);
    res.json({ error: 'AAA Charlotte gas scrape failed', details: err.message });
  }
});

// News (NewsAPI - past 12 hours)
app.get('/api/news', async (req, res) => {
  const key = process.env.NEWS_API_KEY;
  if (!key) return res.json({ error: 'NEWS_API_KEY not set' });
  const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const url = `https://newsapi.org/v2/top-headlines?country=us&pageSize=20&from=${from}&apiKey=${key}`;
  const data = await proxyFetch(url, 'News fetch failed');
  res.json(data);
});

// International news
app.get('/api/news/international', async (req, res) => {
  const key = process.env.NEWS_API_KEY;
  if (!key) return res.json({ error: 'NEWS_API_KEY not set' });
  const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=20&from=${from}&apiKey=${key}`;
  const data = await proxyFetch(url, 'International news fetch failed');
  res.json(data);
});

const CHARLOTTE_QUERY = 'Charlotte,US';
const CHARLOTTE_TZ = 'America/New_York';
const CHARLOTTE_COORDS = { lat: 35.2271, lon: -80.8431 };

function dateKeyInTimeZone(tsSec, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(tsSec * 1000));
}

function todayKeyInTimeZone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function toLocalHourInTimeZone(tsSec, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(tsSec * 1000));
  const h = parts.find((p) => p.type === 'hour')?.value;
  const n = Number(h);
  return Number.isNaN(n) ? null : n;
}

// Weather - Charlotte, NC (current + 3h forecast for today’s range & next 24h)
app.get('/api/weather', async (req, res) => {
  try {
    const key = process.env.OPENWEATHER_API_KEY?.trim();
    if (!key) return res.json({ error: 'OPENWEATHER_API_KEY not set' });

    const payload = await withCache(weatherCache, async () => {
      const base = 'https://api.openweathermap.org/data/2.5';
      const q = encodeURIComponent(CHARLOTTE_QUERY);

      const current = await proxyFetch(
        `${base}/weather?q=${q}&units=imperial&appid=${key}`,
        'Weather current failed'
      );
      if (current?.error) return current;
      if (current?.cod === 401 || current?.cod === 403) {
        return {
          error:
            current?.message ||
            'OpenWeather rejected the API key (check key and activation at openweathermap.org).',
        };
      }

      const forecastRes = await proxyFetch(
        `${base}/forecast?q=${q}&units=imperial&appid=${key}`,
        'Weather forecast failed'
      );
      const list =
        forecastRes?.error || !Array.isArray(forecastRes?.list) ? [] : forecastRes.list;

      const tKey = todayKeyInTimeZone(CHARLOTTE_TZ);
      const todaySlots = list.filter((item) => dateKeyInTimeZone(item.dt, CHARLOTTE_TZ) === tKey);

      const tempsHigh = [];
      const tempsLow = [];
      if (typeof current?.main?.temp_max === 'number') tempsHigh.push(current.main.temp_max);
      if (typeof current?.main?.temp_min === 'number') tempsLow.push(current.main.temp_min);
      for (const i of todaySlots) {
        if (typeof i.main?.temp === 'number') {
          tempsHigh.push(i.main.temp);
          tempsLow.push(i.main.temp);
        }
      }
      const todayRange =
        tempsHigh.length && tempsLow.length
          ? {
              high: Math.round(Math.max(...tempsHigh)),
              low: Math.round(Math.min(...tempsLow)),
            }
          : null;

      const next24h = list.slice(0, 8).map((item) => ({
        dt: item.dt,
        temp: typeof item.main?.temp === 'number' ? Math.round(item.main.temp) : null,
        icon: item.weather?.[0]?.icon,
        description: item.weather?.[0]?.description,
        pop: item.pop != null ? Math.round(item.pop * 100) : null,
      }));

      // Commute + next-2-hours precip summary (Open-Meteo; no key)
      let commute = null;
      try {
        const lat = Number(current?.coord?.lat ?? CHARLOTTE_COORDS.lat);
        const lon = Number(current?.coord?.lon ?? CHARLOTTE_COORDS.lon);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          const omUrl =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${encodeURIComponent(lat)}` +
            `&longitude=${encodeURIComponent(lon)}` +
            `&hourly=precipitation_probability,precipitation` +
            `&timezone=${encodeURIComponent(CHARLOTTE_TZ)}` +
            `&forecast_days=2`;
          const om = await proxyFetch(omUrl, 'Open-Meteo fetch failed');
          const times = Array.isArray(om?.hourly?.time) ? om.hourly.time : [];
          const pop = Array.isArray(om?.hourly?.precipitation_probability)
            ? om.hourly.precipitation_probability
            : [];
          const precip = Array.isArray(om?.hourly?.precipitation) ? om.hourly.precipitation : [];

          const nowMs = Date.now();
          const points = times
            .map((t, idx) => {
              const ms = Date.parse(t);
              if (Number.isNaN(ms)) return null;
              return {
                ms,
                pop: pop[idx] != null ? Number(pop[idx]) : null,
                precip: precip[idx] != null ? Number(precip[idx]) : null,
              };
            })
            .filter(Boolean)
            .filter((p) => p.ms >= nowMs - 60 * 60 * 1000); // include current hour if slightly behind

          function maxPopBetween(startHour, endHour) {
            const todayKey = todayKeyInTimeZone(CHARLOTTE_TZ);
            const vals = points
              .map((p) => {
                const tsSec = Math.floor(p.ms / 1000);
                const dayKey = dateKeyInTimeZone(tsSec, CHARLOTTE_TZ);
                const hr = toLocalHourInTimeZone(tsSec, CHARLOTTE_TZ);
                if (dayKey !== todayKey) return null;
                if (hr == null) return null;
                if (hr < startHour || hr >= endHour) return null;
                if (p.pop == null || Number.isNaN(p.pop)) return null;
                return p.pop;
              })
              .filter((v) => v != null);
            if (!vals.length) return null;
            return Math.round(Math.max(...vals));
          }

          const next2h = points
            .filter((p) => p.ms <= nowMs + 2 * 60 * 60 * 1000)
            .slice(0, 3);
          const next2hMaxPop = next2h.length
            ? Math.round(
                Math.max(
                  ...next2h
                    .map((p) => (p.pop == null || Number.isNaN(p.pop) ? null : p.pop))
                    .filter((v) => v != null)
                )
              )
            : null;
          const next2hPrecipMm = next2h.reduce((sum, p) => {
            const v = p.precip;
            return sum + (v == null || Number.isNaN(v) ? 0 : v);
          }, 0);

          commute = {
            next2h: {
              maxPop: Number.isFinite(next2hMaxPop) ? next2hMaxPop : null,
              precipIn: Number.isFinite(next2hPrecipMm) ? Number((next2hPrecipMm / 25.4).toFixed(2)) : null,
            },
            am: { label: '7–9am', maxPop: maxPopBetween(7, 9) },
            pm: { label: '4–6pm', maxPop: maxPopBetween(16, 18) },
            radarUrl: 'https://www.weather.com/weather/radar/interactive/l/Charlotte+NC',
          };
        }
      } catch {
        commute = null;
      }

      return {
        current,
        todayRange,
        next24h,
        commute,
        timeZone: CHARLOTTE_TZ,
      };
    });

    res.json(payload);
  } catch (err) {
    res.json({ error: 'Weather fetch failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Cole Report API proxy running on http://localhost:${PORT}`);
  console.log(
    'Routes include GET /api/health, GET /api/rates, GET /api/markets, GET /api/ticker, GET /api/sports — restart after git pull if routes 404.'
  );
});
