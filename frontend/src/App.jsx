import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import './App.css';
import GasCard from './components/GasCard';
import MetricCard from './components/MetricCard';
import WeatherCard from './components/WeatherCard';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const OIL_SOURCE_URL = 'https://markets.businessinsider.com/commodities/oil-price?op=1';
const TREASURY_REF_URL = 'https://www.cnbc.com/us-treasurys/';

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
  });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    const apiBase = import.meta.env.VITE_API_URL || '';
    const base = apiBase ? `${apiBase}/api` : '/api';
    try {
      const [gasAll, brent, wti, treasury, weather] = await Promise.all([
        fetch(`${base}/gas/all`).then((r) => r.json()),
        fetch(`${base}/brent`).then((r) => r.json()),
        fetch(`${base}/wti`).then((r) => r.json()),
        fetch(`${base}/treasury`).then((r) => r.json()),
        fetch(`${base}/weather`).then((r) => r.json()),
      ]);
      const gasErr = gasAll?.error ? { error: gasAll.error, details: gasAll.details } : null;
      setMetrics({
        gas: gasErr ?? gasAll?.gas ?? { error: 'Gas data missing' },
        gasNc: gasErr ?? gasAll?.gasNc ?? { error: 'Gas data missing' },
        gasSc: gasErr ?? gasAll?.gasSc ?? { error: 'Gas data missing' },
        gasCharlotte: gasErr ?? gasAll?.gasCharlotte ?? { error: 'Gas data missing' },
        brent,
        wti,
        treasury,
        weather,
      });
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <div className="app">
      <Header
        lastRefresh={lastRefresh}
        onRefresh={fetchData}
        loading={loading}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <main className="main">
        {activeTab === 'Gas' && (
          <section className="gas-section">
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
            <WeatherCard data={metrics.weather} />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
