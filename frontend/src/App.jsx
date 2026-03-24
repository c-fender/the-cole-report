import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import './App.css';
import GasCard from './components/GasCard';
import MetricCard from './components/MetricCard';
import NewsSection from './components/NewsSection';
import WeatherCard from './components/WeatherCard';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function App() {
  const [activeTab, setActiveTab] = useState('Gas');
  const [metrics, setMetrics] = useState({
    gas: null,
    gasNc: null,
    gasSc: null,
    gasCharlotte: null,
    brent: null,
    treasury: null,
    weather: null,
  });
  const [news, setNews] = useState({ domestic: null, international: null });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    const apiBase = import.meta.env.VITE_API_URL || '';
    const base = apiBase ? `${apiBase}/api` : '/api';
    try {
      const [gas, gasNc, gasSc, gasCharlotte, brent, treasury, weather, domestic, international] = await Promise.all([
        fetch(`${base}/gas`).then((r) => r.json()),
        fetch(`${base}/gas/nc`).then((r) => r.json()),
        fetch(`${base}/gas/sc`).then((r) => r.json()),
        fetch(`${base}/gas/charlotte`).then((r) => r.json()),
        fetch(`${base}/brent`).then((r) => r.json()),
        fetch(`${base}/treasury`).then((r) => r.json()),
        fetch(`${base}/weather`).then((r) => r.json()),
        fetch(`${base}/news`).then((r) => r.json()),
        fetch(`${base}/news/international`).then((r) => r.json()),
      ]);
      setMetrics({ gas, gasNc, gasSc, gasCharlotte, brent, treasury, weather });
      setNews({ domestic, international });
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
              title="National Average Gas Prices"
              sourceUrl="https://gasprices.aaa.com/"
              defaultExpanded
            />
            <GasCard
              data={metrics.gasNc}
              title="North Carolina Average Gas Prices"
              sourceUrl="https://gasprices.aaa.com/?state=NC"
              defaultExpanded
            />
            <GasCard
              data={metrics.gasSc}
              title="South Carolina Average Gas Prices"
              sourceUrl="https://gasprices.aaa.com/?state=SC"
              defaultExpanded
            />
            <GasCard
              data={metrics.gasCharlotte}
              title="Charlotte-Gastonia-Rock Hill (NC Only) Average Gas Prices"
              sourceUrl="https://gasprices.aaa.com/?state=NC"
              defaultExpanded
            />
          </section>
        )}
        {activeTab === 'Oil' && (
          <section className="tab-content">
            <MetricCard
              title="Crude Oil ($/bbl)"
              data={metrics.brent}
              parse={(d) => {
                if (d?.Note || d?.['Error Message']) return null;
                const arr = d?.data ?? Object.values(d).find(Array.isArray);
                if (!arr?.length) return null;
                const latest = arr[0];
                const val = latest?.value ?? latest?.[1];
                return val != null ? `$${Number(val).toFixed(2)}` : null;
              }}
            />
          </section>
        )}
        {activeTab === 'Treasury' && (
          <section className="tab-content">
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
        <section className="news-section">
          <NewsSection title="Domestic" articles={news.domestic} />
          <NewsSection title="International" articles={news.international} />
        </section>
      </main>
    </div>
  );
}

export default App;
