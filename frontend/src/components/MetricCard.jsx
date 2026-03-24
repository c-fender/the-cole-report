import './MetricCard.css';

export default function MetricCard({ title, data, parse }) {
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
          <span className="value">{value}</span>
        ) : (
          <span className="loading">—</span>
        )}
      </div>
    </article>
  );
}
