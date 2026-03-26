import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import './App.css';
import GasCard from './components/GasCard';
import MetricCard from './components/MetricCard';
import WeatherCard from './components/WeatherCard';
import GasBuddySearch from './components/GasBuddySearch';
import ChessMoveCard from './components/ChessMoveCard';
import FinanceStocksPanel from './components/FinanceStocksPanel';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const OIL_SOURCE_URL = 'https://markets.businessinsider.com/commodities/oil-price?op=1';
/** FRED series pages for the Rates row (aligned with /api/rates keys). */
const RATES_CARD_SOURCE_URLS = {
  sofr: 'https://fred.stlouisfed.org/series/SOFR',
  fedFunds: 'https://fred.stlouisfed.org/series/DFF',
  dgs10: 'https://fred.stlouisfed.org/series/DGS10',
  dgs2: 'https://fred.stlouisfed.org/series/DGS2',
};

const RATES_CARDS = [
  ['sofr', 'SOFR (daily %)'],
  ['fedFunds', 'Fed funds effective (%)'],
  ['dgs10', '10Y Treasury (%)'],
  ['dgs2', '2Y Treasury (%)'],
];

/** Yahoo / CoinGecko pages aligned with backend symbols. */
const FINANCE_CARD_SOURCE_URLS = {
  gold: 'https://finance.yahoo.com/quote/GC=F',
  silver: 'https://finance.yahoo.com/quote/SI=F',
  platinum: 'https://finance.yahoo.com/quote/PL=F',
  dow: 'https://finance.yahoo.com/quote/%5EDJI',
  nasdaq: 'https://finance.yahoo.com/quote/%5EIXIC',
  sp500: 'https://finance.yahoo.com/quote/%5EGSPC',
  bitcoin: 'https://www.coingecko.com/en/coins/bitcoin',
  ethereum: 'https://www.coingecko.com/en/coins/ethereum',
  xrp: 'https://www.coingecko.com/en/coins/xrp',
};

const STORAGE_KEY = 'cole-report-cache-v2';
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

function formatAsOfDate(dateStr) {
  if (!dateStr) return '--';
  const dt = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(dt.getTime())
    ? dateStr
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** When the markets bundle was built on the server (ISO from API → local date + time). */
function formatIsoTimestampLocal(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Today’s date in the user’s local calendar (for “as of” headers). */
function formatLocalToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return formatAsOfDate(`${y}-${m}-${day}`);
}

/** Keeps the displayed “today” in sync (tab focus, periodic tick, midnight rollover). */
function useTodayFormatted() {
  const [label, setLabel] = useState(() => formatLocalToday());
  useEffect(() => {
    const tick = () => setLabel(formatLocalToday());
    tick();
    const id = setInterval(tick, 60 * 1000);
    window.addEventListener('focus', tick);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return label;
}

function formatUsdPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n));
}

/** Avoid `VITE_API_URL=http://host:3001/api` turning into `.../api/api/...`. */
function normalizeApiBaseUrl(raw) {
  if (typeof raw !== 'string') return '';
  const t = raw.trim().replace(/\/+$/, '');
  if (t.endsWith('/api')) return t.slice(0, -4);
  return t;
}

function marketsHtml404Message(text) {
  if (!text || typeof text !== 'string') return null;
  if (text.includes('Cannot GET') && /\/api\/markets/.test(text)) {
    return {
      error: 'Markets API not found on this server',
      details:
        'Nothing is handling GET /api/markets. Stop whatever is on port 3001 (or your VITE_API_URL port), then start this repo’s backend: cd backend && npm run dev — so the latest server.js is loaded.',
    };
  }
  return null;
}

/** Never rejects — returns `{ error, details? }` on failure so Finance can show a real message. */
async function fetchMarketsBundleSafe(apiBase, { refresh = false } = {}) {
  const url = `${apiBase}/markets${refresh ? '?refresh=1' : ''}`;
  try {
    const r = await fetch(url);
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      const hint = marketsHtml404Message(text);
      if (hint) return hint;
      return {
        error: 'Invalid response from markets API',
        details: text ? text.slice(0, 200) : `HTTP ${r.status}`,
      };
    }
    if (!r.ok) {
      return {
        error: data?.error || 'Markets request failed',
        details: data?.details || `HTTP ${r.status}`,
      };
    }
    return data;
  } catch (e) {
    return {
      error: e?.message || 'Network error',
      details:
        'Check that the API server is running and /api/markets is reachable (same host as the app in production).',
    };
  }
}

function marketQuoteDetails(d) {
  if (!d || d.error) return undefined;
  if (d.change24hPct != null) {
    const v = d.change24hPct;
    const trend = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    return [{ label: '24h', value: `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, trend }];
  }
  if (d.changePct != null) {
    const v = d.changePct;
    const trend = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    return [{ label: 'vs prev close', value: `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, trend }];
  }
  return undefined;
}

function getOilDoD(brentData) {
  const arr = brentData?.data;
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const latest = Number(arr[0]?.value);
  const prev = Number(arr[1]?.value);
  if (Number.isNaN(latest) || Number.isNaN(prev)) return null;
  const diff = latest - prev;
  if (diff === 0) return null;
  return {
    dir: diff > 0 ? 'up' : 'down',
    amt: Math.abs(diff).toFixed(2),
  };
}

function getSeriesValue(seriesData, idx = 0) {
  const arr = seriesData?.data;
  if (!Array.isArray(arr) || arr.length <= idx) return null;
  const val = Number(arr[idx]?.value);
  return Number.isNaN(val) ? null : val;
}

function getSeriesChange(seriesData, lookbackIdx) {
  const latest = getSeriesValue(seriesData, 0);
  const prior = getSeriesValue(seriesData, lookbackIdx);
  if (latest == null || prior == null) return null;
  const diff = latest - prior;
  if (diff === 0) return null;
  return { dir: diff > 0 ? 'up' : 'down', amt: Math.abs(diff).toFixed(2) };
}

function loadCached() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.at !== 'number' || !parsed.metrics) return null;
    if (Date.now() - parsed.at > CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCached(metrics) {
  try {
    const m = { ...metrics };
    // Don’t persist a markets-only failure — it would re-show the banner on every load until expiry.
    if (m.markets?.error && !m.markets?.fetchedAt) m.markets = null;
    if (m.rates?.error && !m.rates?.fetchedAt) m.rates = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), metrics: m }));
  } catch {
    // ignore storage failures
  }
}

function App() {
  const todayLabel = useTodayFormatted();
  const [activeTab, setActiveTab] = useState('Gas');
  const [metrics, setMetrics] = useState({
    gas: null,
    gasNc: null,
    gasSc: null,
    gasCharlotte: null,
    brent: null,
    wti: null,
    rates: null,
    markets: null,
    weather: null,
    chess: null,
  });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const coldStartNotedRef = useRef(false);

  const apiBase = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || '');
  const base = apiBase ? `${apiBase}/api` : '/api';

  const fetchGasAll = useCallback(async () => {
    const gasAll = await fetch(`${base}/gas/all`).then((r) => r.json());
    const gasErr = gasAll?.error ? { error: gasAll.error, details: gasAll.details } : null;
    return {
      gas: gasErr ?? gasAll?.gas ?? { error: 'Gas data missing' },
      gasNc: gasErr ?? gasAll?.gasNc ?? { error: 'Gas data missing' },
      gasSc: gasErr ?? gasAll?.gasSc ?? { error: 'Gas data missing' },
      gasCharlotte: gasErr ?? gasAll?.gasCharlotte ?? { error: 'Gas data missing' },
    };
  }, [base]);

  const fetchOil = useCallback(async () => {
    const [brent, wti] = await Promise.all([
      fetch(`${base}/brent`).then((r) => r.json()),
      fetch(`${base}/wti`).then((r) => r.json()),
    ]);
    return { brent, wti };
  }, [base]);

  const fetchFinance = useCallback(async ({ bypassCache = false } = {}) => {
    const q = bypassCache ? '?refresh=1' : '';
    const [rates, markets] = await Promise.all([
      fetch(`${base}/rates${q}`)
        .then((r) => r.json())
        .catch(() => ({ error: 'Rates fetch failed' })),
      fetchMarketsBundleSafe(base, { refresh: bypassCache }),
    ]);
    return { rates, markets };
  }, [base]);

  const fetchWeather = useCallback(async () => {
    const weather = await fetch(`${base}/weather`).then((r) => r.json());
    return { weather };
  }, [base]);

  const fetchChess = useCallback(async () => {
    const chess = await fetch(`${base}/chess/move-of-day`).then((r) => r.json());
    return { chess };
  }, [base]);

  const fetchActiveTab = useCallback(
    async (tab, { showLoading = false, bypassCache = false } = {}) => {
      if (showLoading) setLoading(true);
      try {
        const cached = loadCached();
        if (!coldStartNotedRef.current && cached?.metrics) {
          coldStartNotedRef.current = true;
          console.info(
            '[Cole Report] Using cached values while the backend wakes up (Render free tier can take ~30–60s after inactivity).'
          );
        }

        let partial = null;
        if (tab === 'Gas') partial = await fetchGasAll();
        else if (tab === 'Oil') partial = await fetchOil();
        else if (tab === 'FinanceOverview') partial = await fetchFinance({ bypassCache });
        else if (tab === 'FinanceStocks') partial = {};
        else if (tab === 'Weather') partial = await fetchWeather();
        else if (tab === 'Chess') partial = await fetchChess();
        else partial = {};

        setMetrics((prev) => {
          const next = { ...prev, ...partial };
          saveCached(next);
          return next;
        });
        setLastRefresh(new Date());
      } catch (err) {
        console.error('Fetch error:', err);
      } finally {
        setLoading(false);
      }
    },
    [fetchGasAll, fetchOil, fetchFinance, fetchWeather, fetchChess]
  );

  const refreshNow = useCallback(
    () => fetchActiveTab(activeTab, { showLoading: true, bypassCache: true }),
    [activeTab, fetchActiveTab]
  );

  const prefetchOtherTabs = useCallback(async () => {
    // Don't block render; best-effort background fill.
    const tabs = ['Gas', 'Oil', 'FinanceOverview', 'Weather', 'Chess'].filter((t) => t !== activeTab);
    for (const t of tabs) {
      // only fetch if we don't have the main data yet
      const hasData =
        (t === 'Gas' && metrics.gas && metrics.gasNc && metrics.gasSc && metrics.gasCharlotte) ||
        (t === 'Oil' && metrics.brent && metrics.wti) ||
        (t === 'FinanceOverview' && metrics.rates?.fetchedAt && metrics.markets?.fetchedAt) ||
        (t === 'Weather' && metrics.weather) ||
        (t === 'Chess' && metrics.chess);
      if (!hasData) {
        // eslint-disable-next-line no-await-in-loop
        await fetchActiveTab(t, { showLoading: false });
      }
    }
  }, [activeTab, fetchActiveTab, metrics]);

  // Hydrate from localStorage immediately (fast paint).
  useEffect(() => {
    const cached = loadCached();
    if (cached?.metrics) {
      setMetrics((prev) => ({ ...prev, ...cached.metrics }));
      setLastRefresh(new Date(cached.at));
      setLoading(false);
    }
  }, []);

  // Fetch active tab on load and whenever tab changes.
  useEffect(() => {
    fetchActiveTab(activeTab, { showLoading: !loadCached() });
    const id = setInterval(() => fetchActiveTab(activeTab), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeTab, fetchActiveTab]);

  // Prefetch the rest shortly after initial paint.
  useEffect(() => {
    const id = setTimeout(() => {
      prefetchOtherTabs();
    }, 2500);
    return () => clearTimeout(id);
  }, [prefetchOtherTabs]);

  /*
    Previous behavior: fetch everything on load.
    Kept here as reference:
    const fetchData = useCallback(async () => { ... });
  */

  return (
    <div className="app">
      <Header
        lastRefresh={lastRefresh}
        onRefresh={refreshNow}
        loading={loading}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        apiBase={base}
      />
      <main className="main">
        {activeTab === 'Gas' && (
          <section className="gas-section">
            <GasBuddySearch />
            <GasCard
              data={metrics.gas}
              title="National"
              sourceUrl="https://gasprices.aaa.com/"
              defaultExpanded
            />
            <GasCard
              data={metrics.gasNc}
              title="North Carolina"
              sourceUrl="https://gasprices.aaa.com/?state=NC"
              defaultExpanded
            />
            <GasCard
              data={metrics.gasSc}
              title="South Carolina"
              sourceUrl="https://gasprices.aaa.com/?state=SC"
              defaultExpanded
            />
            <GasCard
              data={metrics.gasCharlotte}
              title="Charlotte-Gastonia-Rock Hill (NC Only)"
              sourceUrl="https://gasprices.aaa.com/?state=NC"
              defaultExpanded
            />
          </section>
        )}
        {activeTab === 'Oil' && (
          <section className="tab-content">
            <div className="oil-header">
              <span>
                As of:{' '}
                <code>
                  {formatAsOfDate(
                    metrics.brent?.data?.[0]?.date ?? metrics.brent?.data?.[0]?.period
                  )}
                </code>
              </span>
              <a href={OIL_SOURCE_URL} target="_blank" rel="noopener noreferrer">
                Real Time Tracker
              </a>
            </div>
            <div className="oil-panel">
              <MetricCard
                title="BRENT CRUDE ($/BBL)"
                data={metrics.brent}
                change={getOilDoD(metrics.brent)}
                details={[
                  { label: '1W Change', change: getSeriesChange(metrics.brent, 5) },
                  { label: '1M Change', change: getSeriesChange(metrics.brent, 21) },
                  { label: '1Y Change', change: getSeriesChange(metrics.brent, 252) },
                ]}
                parse={(d) => {
                  if (d?.Note || d?.['Error Message']) return null;
                  const arr = d?.data ?? Object.values(d).find(Array.isArray);
                  if (!arr?.length) return null;
                  const latest = arr[0];
                  const val = latest?.value ?? latest?.[1];
                  return val != null ? `$${Number(val).toFixed(2)}` : null;
                }}
              />
            </div>
            <MetricCard
              title="WTI CRUDE ($/BBL)"
              data={metrics.wti}
              change={getOilDoD(metrics.wti)}
              details={[
                { label: '1W Change', change: getSeriesChange(metrics.wti, 5) },
                { label: '1M Change', change: getSeriesChange(metrics.wti, 21) },
                { label: '1Y Change', change: getSeriesChange(metrics.wti, 252) },
              ]}
              parse={(d) => {
                if (d?.Note || d?.['Error Message']) return null;
                const arr = d?.data ?? Object.values(d).find(Array.isArray);
                if (!arr?.length) return null;
                const latest = arr[0];
                const val = latest?.value ?? latest?.[1];
                return val != null ? `$${Number(val).toFixed(2)}` : null;
              }}
            />
            <MetricCard
              title="BRENT-WTI SPREAD ($/BBL)"
              data={{
                value: (() => {
                  const brent = getSeriesValue(metrics.brent, 0);
                  const wti = getSeriesValue(metrics.wti, 0);
                  if (brent == null || wti == null) return null;
                  return (brent - wti).toFixed(2);
                })(),
              }}
              parse={(d) => (d?.value != null ? `$${Number(d.value).toFixed(2)}` : null)}
            />
          </section>
        )}
        {activeTab === 'FinanceOverview' && (
          <section className="tab-content">
            <div className="oil-header finance-header-meta">
              <span>
                Calendar as of: <code>{todayLabel}</code>
              </span>
              {metrics.markets?.fetchedAt ? (
                <span className="finance-quotes-refreshed">
                  Quotes refreshed: <code>{formatIsoTimestampLocal(metrics.markets.fetchedAt)}</code>
                </span>
              ) : null}
            </div>
            <p className="finance-asof-hint">
              Rate cards use FRED’s observation date. Metals, indices, and crypto are Yahoo / CoinGecko
              snapshots at the refresh time above.
            </p>
            {metrics.markets?.error && !metrics.markets?.fetchedAt ? (
              <div className="finance-markets-banner error">
                Markets data unavailable: {String(metrics.markets.error)}
                {metrics.markets.details ? (
                  <span className="finance-markets-error-detail"> — {String(metrics.markets.details)}</span>
                ) : null}
              </div>
            ) : null}
            {metrics.rates == null && metrics.markets == null ? (
              <div className="finance-markets-banner">Loading finance…</div>
            ) : (
              <div className="finance-markets">
                <div className="finance-market-section">
                  <h3 className="finance-market-section-title">Rates</h3>
                  <div className="finance-market-section-grid">
                    {RATES_CARDS.map(([key, title]) => (
                      <MetricCard
                        key={key}
                        title={title}
                        data={metrics.rates?.[key]}
                        sourceLink={{ href: RATES_CARD_SOURCE_URLS[key] }}
                        parse={(d) => {
                          if (d?.error) return null;
                          if (d?.rate == null || Number.isNaN(Number(d.rate))) return null;
                          return `${Number(d.rate).toFixed(2)}%`;
                        }}
                        details={
                          metrics.rates?.[key]?.date && !metrics.rates?.[key]?.error
                            ? [{ label: 'as of', value: String(metrics.rates[key].date) }]
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="finance-market-section">
                  <h3 className="finance-market-section-title">Precious metals</h3>
                  <div className="finance-market-section-grid">
                    {[
                      ['gold', 'Gold (COMEX)'],
                      ['silver', 'Silver (COMEX)'],
                      ['platinum', 'Platinum (NYMEX)'],
                    ].map(([key, title]) => (
                      <MetricCard
                        key={key}
                        title={title}
                        data={metrics.markets?.[key]}
                        sourceLink={{ href: FINANCE_CARD_SOURCE_URLS[key] }}
                        details={marketQuoteDetails(metrics.markets?.[key])}
                        parse={(d) => {
                          if (d?.error) return null;
                          return formatUsdPrice(d?.price);
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="finance-market-section">
                  <h3 className="finance-market-section-title">Indices</h3>
                  <div className="finance-market-section-grid">
                    {[
                      ['dow', 'Dow Jones'],
                      ['nasdaq', 'Nasdaq'],
                      ['sp500', 'S&P 500'],
                    ].map(([key, title]) => (
                      <MetricCard
                        key={key}
                        title={title}
                        data={metrics.markets?.[key]}
                        sourceLink={{ href: FINANCE_CARD_SOURCE_URLS[key] }}
                        details={marketQuoteDetails(metrics.markets?.[key])}
                        parse={(d) => {
                          if (d?.error) return null;
                          return formatUsdPrice(d?.price);
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="finance-market-section">
                  <h3 className="finance-market-section-title">Crypto</h3>
                  <div className="finance-market-section-grid">
                    {[
                      ['bitcoin', 'Bitcoin'],
                      ['ethereum', 'Ethereum'],
                      ['xrp', 'XRP'],
                    ].map(([key, title]) => (
                      <MetricCard
                        key={key}
                        title={title}
                        data={metrics.markets?.[key]}
                        sourceLink={{ href: FINANCE_CARD_SOURCE_URLS[key] }}
                        details={marketQuoteDetails(metrics.markets?.[key])}
                        parse={(d) => {
                          if (d?.error) return null;
                          return formatUsdPrice(d?.price);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
        {activeTab === 'FinanceStocks' && (
          <FinanceStocksPanel apiBase={base} lastRefresh={lastRefresh} />
        )}
        {activeTab === 'Weather' && (
          <section className="tab-content">
            <WeatherCard data={metrics.weather} apiBase={base} />
          </section>
        )}
        {activeTab === 'Chess' && (
          <section className="tab-content">
            <ChessMoveCard data={metrics.chess} />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
