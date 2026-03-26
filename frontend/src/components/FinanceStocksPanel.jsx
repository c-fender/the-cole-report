import { useState, useEffect } from 'react';
import './FinanceStocksPanel.css';

const TICKER_REFRESH_MS = 90 * 1000;

function yahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function formatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n));
}

function formatPct(p) {
  if (p == null || Number.isNaN(Number(p))) return '—';
  const v = Number(p);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function formatVol(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(2)}%`;
}

export default function FinanceStocksPanel({ apiBase, lastRefresh }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${apiBase}/ticker`);
        const j = await r.json();
        if (!cancelled && j?.items?.length) setData(j);
        else if (!cancelled && j?.error) setData(j);
      } catch {
        if (!cancelled) setData({ error: true });
      }
    }
    load();
    const id = setInterval(load, TICKER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiBase, lastRefresh]);

  if (data?.error && !data?.items?.length) {
    return (
      <div className="finance-stocks finance-stocks--error">
        <p>Could not load watchlist data. Check that the API is running.</p>
      </div>
    );
  }

  if (!data?.items?.length) {
    return (
      <div className="finance-stocks finance-stocks--loading" aria-busy="true">
        Loading watchlist…
      </div>
    );
  }

  const items = data.items;
  const topVol = Array.isArray(data.topWeeklyVolatility) ? data.topWeeklyVolatility : [];

  return (
    <section className="finance-stocks tab-content">
      <div className="finance-stocks-intro">
        <p>
          Same symbols as the header ticker. Prices and 5-day volatility refresh every 90 seconds (server
          cache). Weekly volatility is the sample standard deviation of the last five daily percentage
          moves (from six consecutive closes).
        </p>
        {data.fetchedAt ? (
          <p className="finance-stocks-meta">
            Last updated:{' '}
            <code>
              {new Date(data.fetchedAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </code>
          </p>
        ) : null}
      </div>

      <div className="finance-stocks-block">
        <h3 className="finance-stocks-heading">Top 5 — weekly volatility</h3>
        {topVol.length === 0 ? (
          <p className="finance-stocks-empty">Not enough history to rank volatility yet.</p>
        ) : (
          <div className="finance-stocks-table-wrap">
            <table className="finance-stocks-table">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Name</th>
                  <th scope="col">Price</th>
                  <th scope="col">Day %</th>
                  <th scope="col">5d vol (σ)</th>
                </tr>
              </thead>
              <tbody>
                {topVol.map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <a
                        href={yahooQuoteUrl(row.symbol)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="finance-stocks-link"
                      >
                        {row.symbol}
                      </a>
                    </td>
                    <td>{row.label}</td>
                    <td>{formatUsd(row.price)}</td>
                    <td
                      className={
                        row.changePct > 0 ? 'is-up' : row.changePct < 0 ? 'is-down' : ''
                      }
                    >
                      {formatPct(row.changePct)}
                    </td>
                    <td>{formatVol(row.weeklyVolatilityPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="finance-stocks-block">
        <h3 className="finance-stocks-heading">Full watchlist</h3>
        <div className="finance-stocks-table-wrap">
          <table className="finance-stocks-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Name</th>
                <th scope="col">Price</th>
                <th scope="col">Day %</th>
                <th scope="col">5d vol (σ)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.symbol}>
                  <td>
                    {row.error ? (
                      row.symbol
                    ) : (
                      <a
                        href={yahooQuoteUrl(row.symbol)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="finance-stocks-link"
                      >
                        {row.symbol}
                      </a>
                    )}
                  </td>
                  <td>{row.label}</td>
                  <td>{row.error ? <span className="finance-stocks-muted">—</span> : formatUsd(row.price)}</td>
                  <td
                    className={
                      row.error
                        ? ''
                        : row.changePct > 0
                          ? 'is-up'
                          : row.changePct < 0
                            ? 'is-down'
                            : ''
                    }
                  >
                    {row.error ? <span className="finance-stocks-muted">—</span> : formatPct(row.changePct)}
                  </td>
                  <td>
                    {row.weeklyVolatilityPct != null && !row.error
                      ? formatVol(row.weeklyVolatilityPct)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
