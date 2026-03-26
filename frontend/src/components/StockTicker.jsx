import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import './StockTicker.css';

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
  if (p == null || Number.isNaN(Number(p))) return '';
  const v = Number(p);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export default function StockTicker({ apiBase, onNavigateToStocks }) {
  const [data, setData] = useState(null);
  const rowRef = useRef(null);
  const pendingAnimationTimeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${apiBase}/ticker`);
        const j = await r.json();
        if (!cancelled && j?.items?.length) {
          const row = rowRef.current;
          if (row?.getAnimations) {
            const anim = row.getAnimations()[0];
            if (anim != null && Number.isFinite(anim.currentTime)) {
              pendingAnimationTimeRef.current = anim.currentTime;
            }
          }
          setData(j);
        } else if (!cancelled && j?.error) setData(j);
      } catch {
        if (!cancelled) setData({ error: true });
      }
    }
    load();
    const id = setInterval(load, 90 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiBase]);

  useLayoutEffect(() => {
    const t = pendingAnimationTimeRef.current;
    if (t == null || !rowRef.current) return;
    pendingAnimationTimeRef.current = null;
    const row = rowRef.current;
    const anim = row.getAnimations?.()?.[0];
    if (anim != null && Number.isFinite(t)) {
      anim.currentTime = t;
    }
  }, [data]);

  const items = data?.items;
  if (!items?.length) {
    if (data?.error) return null;
    return <div className="stock-ticker stock-ticker--skeleton" aria-hidden />;
  }

  const segment = (suffix) => (
    <div className="stock-ticker-segment" key={suffix} aria-hidden={suffix === 'b'}>
      {items.map((it, i) => (
        <span key={`${suffix}-${it.symbol}-${i}`} className="stock-ticker-item">
          <span className="stock-ticker-line">
            <span className="stock-ticker-label">{it.label}</span>
            <span className="stock-ticker-symbol">{it.symbol}</span>
            {it.error ? (
              <span className="stock-ticker-muted">—</span>
            ) : (
              <>
                <span className="stock-ticker-price">{formatUsd(it.price)}</span>
                <span
                  className={`stock-ticker-chg ${it.changePct > 0 ? 'is-up' : it.changePct < 0 ? 'is-down' : ''}`}
                >
                  {formatPct(it.changePct)}
                </span>
              </>
            )}
          </span>
          <span className="stock-ticker-sep" aria-hidden>
            ·
          </span>
        </span>
      ))}
    </div>
  );

  const interactive = Boolean(onNavigateToStocks);

  return (
    <div
      className={`stock-ticker${interactive ? ' stock-ticker--interactive' : ''}`}
      role={interactive ? 'button' : 'region'}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? 'Stock quotes — open full watchlist' : 'Stock ticker'}
      title={interactive ? 'Open Stocks watchlist' : undefined}
      onClick={interactive ? () => onNavigateToStocks() : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigateToStocks();
              }
            }
          : undefined
      }
    >
      <div className="stock-ticker-viewport">
        <div ref={rowRef} className="stock-ticker-row">
          {segment('a')}
          {segment('b')}
        </div>
      </div>
    </div>
  );
}
