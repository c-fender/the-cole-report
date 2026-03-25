import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import './App.css';
import GasCard from './components/GasCard';
import MetricCard from './components/MetricCard';
import WeatherCard from './components/WeatherCard';
import GasBuddySearch from './components/GasBuddySearch';
import ChessMoveCard from './components/ChessMoveCard';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const OIL_SOURCE_URL = 'https://markets.businessinsider.com/commodities/oil-price?op=1';
const TREASURY_REF_URL = 'https://www.cnbc.com/us-treasurys/';
const STORAGE_KEY = 'cole-report-cache-v1';
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

function formatAsOfDate(dateStr) {
  if (!dateStr) return '--';
  const dt = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(dt.getTime())
    ? dateStr
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), metrics }));
  } catch {
    // ignore storage failures
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('Gas');
  const [metrics, setMetrics] = useState({
    gas: null,
    gasNc: null,
    gasSc: null,
    gasCharlotte: null,
    brent: null,
    wti: null,
    treasury: null,
    weather: null,
    chess: null,
  });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const coldStartNotedRef = useRef(false);

  const apiBase = import.meta.env.VITE_API_URL || '';
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

  const fetchTreasury = useCallback(async () => {
    const treasury = await fetch(`${base}/treasury`).then((r) => r.json());
    return { treasury };
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
    async (tab, { showLoading = false } = {}) => {
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
        else if (tab === 'Treasury') partial = await fetchTreasury();
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
    [fetchGasAll, fetchOil, fetchTreasury, fetchWeather, fetchChess]
  );

  const refreshNow = useCallback(() => fetchActiveTab(activeTab, { showLoading: true }), [
    activeTab,
    fetchActiveTab,
  ]);

  const prefetchOtherTabs = useCallback(async () => {
    // Don't block render; best-effort background fill.
    const tabs = ['Gas', 'Oil', 'Treasury', 'Weather', 'Chess'].filter((t) => t !== activeTab);
    for (const t of tabs) {
      // only fetch if we don't have the main data yet
      const hasData =
        (t === 'Gas' && metrics.gas && metrics.gasNc && metrics.gasSc && metrics.gasCharlotte) ||
        (t === 'Oil' && metrics.brent && metrics.wti) ||
        (t === 'Treasury' && metrics.treasury) ||
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
        {activeTab === 'Treasury' && (
          <section className="tab-content">
            <div className="oil-header">
              <span>Full curve &amp; context (market data delayed)</span>
              <a href={TREASURY_REF_URL} target="_blank" rel="noopener noreferrer">
                CNBC US Treasurys
              </a>
            </div>
            <MetricCard
              title="US 10Y Treasury (%)"
              data={metrics.treasury}
              parse={(d) => {
                if (d?.Note || d?.['Error Message']) return null;
                const arr = d?.data ?? Object.values(d).find(Array.isArray);
                if (!arr?.length) return null;
                const latest = arr[0];
                const val = latest?.value ?? latest?.[1];
                return val != null ? `${Number(val).toFixed(2)}%` : null;
              }}
            />
          </section>
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
