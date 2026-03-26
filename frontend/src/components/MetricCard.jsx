import './MetricCard.css';

/** Optional `sourceLink.href` — title becomes a same-style link (underline on hover). */
export default function MetricCard({ title, data, parse, change, details, sourceLink }) {
  const rawError = data?.error ?? data?.['Error Message'] ?? data?.Note ?? data?.Information;
  const error = typeof rawError === 'string' && rawError.toLowerCase().includes('rate limit')
    ? 'Rate limited'
    : rawError;
  const value = !error && data ? parse(data) : null;

  const titleEl =
    sourceLink?.href ? (
      <a
        href={sourceLink.href}
        target="_blank"
        rel="noopener noreferrer"
        className="metric-title metric-title-link"
        title="Open source data"
      >
        {title}
      </a>
    ) : (
      <span className="metric-title">{title}</span>
    );

  return (
    <article className="metric-card">
      <div className="metric-header">{titleEl}</div>
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
            const trend = item.trend;
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
                  ) : trend && plain != null ? (
                    <span className={`metric-detail-trend metric-detail-trend--${trend}`}>
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
