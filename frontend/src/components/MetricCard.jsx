import './MetricCard.css';

export default function MetricCard({ title, data, parse, change, details }) {
  const rawError = data?.error ?? data?.['Error Message'] ?? data?.Note ?? data?.Information;
  const error = typeof rawError === 'string' && rawError.toLowerCase().includes('rate limit')
    ? 'Rate limited'
    : rawError;
  const value = !error && data ? parse(data) : null;

  return (
    <article className="metric-card">
      <div className="metric-header">
        <span className="metric-title">{title}</span>
      </div>
      <div className="metric-value">
        {error ? (
          <span className="error">{error}</span>
        ) : value ? (
          <>
            <span className="value">{value}</span>
            {change && (
              <span className={`metric-change metric-change-${change.dir === 'up' ? 'up' : 'down'}`}>
                ({change.dir === 'up' ? '↑' : '↓'} ${change.amt} DoD)
              </span>
            )}
          </>
        ) : (
          <span className="loading">—</span>
        )}
      </div>
      {Array.isArray(details) && details.length > 0 && (
        <div className="metric-details">
          {details.map((item) => {
            const ch = item.change;
            const plain = item.value;
            const detailText =
              ch != null
                ? `${ch.dir === 'up' ? '↑' : '↓'} $${ch.amt}`
                : plain != null
                  ? plain
                  : '--';
            return (
              <div key={item.label} className="metric-detail-row">
                <span className="metric-detail-label">{item.label}</span>
                <span className="metric-detail-value">
                  {ch != null ? (
                    <span
                      className={`metric-change metric-change-${ch.dir === 'up' ? 'up' : 'down'}`}
                    >
                      {detailText}
                    </span>
                  ) : (
                    detailText
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
