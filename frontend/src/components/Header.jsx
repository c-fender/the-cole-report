import { useState, useEffect, useRef } from 'react';
import StockTicker from './StockTicker';
import './Header.css';

const ENERGY_SUBTABS = [
  { id: 'Gas', label: 'Gas' },
  { id: 'Oil', label: 'Oil' },
];

const FINANCE_SUBTABS = [
  { id: 'FinanceOverview', label: 'Overview' },
  { id: 'FinanceStocks', label: 'Stocks' },
];

const OTHER_TABS = ['Weather', 'Sports', 'Chess'];

function isEnergyTab(tab) {
  return tab === 'Gas' || tab === 'Oil';
}

function isFinanceTab(tab) {
  return tab === 'FinanceOverview' || tab === 'FinanceStocks';
}

export default function Header({
  lastRefresh,
  onRefresh,
  loading,
  activeTab,
  onTabChange,
  apiBase,
}) {
  const timeStr = lastRefresh
    ? lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '--';

  const [energyOpen, setEnergyOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const energyRef = useRef(null);
  const financeRef = useRef(null);

  useEffect(() => {
    if (!isEnergyTab(activeTab)) setEnergyOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!isFinanceTab(activeTab)) setFinanceOpen(false);
  }, [activeTab]);

  useEffect(() => {
    function handlePointerDown(e) {
      if (energyRef.current && !energyRef.current.contains(e.target)) {
        setEnergyOpen(false);
      }
      if (financeRef.current && !financeRef.current.contains(e.target)) {
        setFinanceOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setEnergyOpen(false);
        setFinanceOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const energyActive = isEnergyTab(activeTab);
  const financeActive = isFinanceTab(activeTab);

  return (
    <header className="header">
      <div className="header-top">
        <div className="header-left">
          <img src="/Headshot.JPEG" alt="Cole Report" className="logo" />
          <div className="brand">
            <h1>The Cole Report</h1>
            <span className="subtitle">market metrics</span>
          </div>
        </div>
        <div className="header-right">
          <span className="refresh-info">
            Last refresh: <code>{timeStr}</code>
          </span>
          <button
            className="btn-refresh"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh now"
          >
            {loading ? '…' : '↻'}
          </button>
        </div>
      </div>
      {apiBase ? (
        <StockTicker
          apiBase={apiBase}
          onNavigateToStocks={() => {
            onTabChange('FinanceStocks');
            setFinanceOpen(false);
          }}
        />
      ) : null}
      <nav className="header-tabs" aria-label="Main">
        <div
          className={`tab-group ${energyActive ? 'tab-group-active' : ''} ${energyOpen ? 'tab-group-open' : ''}`}
          ref={energyRef}
        >
          <button
            type="button"
            className={`tab-btn tab-btn-energy ${energyActive ? 'tab-btn-active' : ''} ${energyOpen ? 'tab-btn-energy-open' : ''}`}
            aria-expanded={energyOpen}
            aria-haspopup="true"
            aria-controls="energy-menu"
            id="energy-trigger"
            onClick={() => setEnergyOpen((o) => !o)}
          >
            Energy
            <span className="tab-btn-chevron" aria-hidden>
              {energyOpen ? '▴' : '▾'}
            </span>
          </button>
          {energyOpen && (
            <div
              className="tab-dropdown"
              id="energy-menu"
              role="menu"
              aria-labelledby="energy-trigger"
            >
              {ENERGY_SUBTABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className={`tab-dropdown-item ${activeTab === id ? 'tab-dropdown-item-active' : ''}`}
                  onClick={() => {
                    onTabChange(id);
                    setEnergyOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className={`tab-group ${financeActive ? 'tab-group-active' : ''} ${financeOpen ? 'tab-group-open' : ''}`}
          ref={financeRef}
        >
          <button
            type="button"
            className={`tab-btn tab-btn-energy ${financeActive ? 'tab-btn-active' : ''} ${financeOpen ? 'tab-btn-energy-open' : ''}`}
            aria-expanded={financeOpen}
            aria-haspopup="true"
            aria-controls="finance-menu"
            id="finance-trigger"
            onClick={() => setFinanceOpen((o) => !o)}
          >
            Finance
            <span className="tab-btn-chevron" aria-hidden>
              {financeOpen ? '▴' : '▾'}
            </span>
          </button>
          {financeOpen && (
            <div
              className="tab-dropdown"
              id="finance-menu"
              role="menu"
              aria-labelledby="finance-trigger"
            >
              {FINANCE_SUBTABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className={`tab-dropdown-item ${activeTab === id ? 'tab-dropdown-item-active' : ''}`}
                  onClick={() => {
                    onTabChange(id);
                    setFinanceOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {OTHER_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`tab-btn ${activeTab === tab ? 'tab-btn-active' : ''}`}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
    </header>
  );
}
