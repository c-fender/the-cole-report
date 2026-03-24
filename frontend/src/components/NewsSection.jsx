import './NewsSection.css';

function parseArticles(data) {
  if (!data?.articles || Array.isArray(data.articles) === false) return [];
  return data.articles.filter((a) => a?.title && a?.url);
}

export default function NewsSection({ title, articles }) {
  const list = parseArticles(articles);
  const error = articles?.error;

  return (
    <section className="news-section">
      <h2 className="news-heading">{title}</h2>
      <ul className="news-list">
        {error ? (
          <li className="error">{error}</li>
        ) : list.length === 0 ? (
          <li className="empty">No headlines in the past 12 hours</li>
        ) : (
          list.slice(0, 10).map((article, i) => (
            <li key={i}>
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                {article.title}
              </a>
              {article.source?.name && (
                <span className="source">{article.source.name}</span>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
