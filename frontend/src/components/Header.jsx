import './Header.css';

const TABS = ['Gas', 'Oil', 'Treasury', 'Weather'];

export default function Header({ lastRefresh, onRefresh, loading, activeTab, onTabChange }) {
  const timeStr = lastRefresh
    ? lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '--';

  return (
    <header className="header">
      <div className="header-top">
        <div className="header-left">
          <img src="/Headshot.JPEG" alt="Cole Report" className="logo" />
          <div className="brand">
            <h1>The Cole Report</h1>
            <span className="subtitle">market metrics & headlines</span>
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
      <nav className="header-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
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
