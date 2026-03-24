import './WeatherCard.css';

export default function WeatherCard({ data }) {
  const error = data?.error;
  const temp = data?.main?.temp;
  const desc = data?.weather?.[0]?.description;
  const city = data?.name;
  const icon = data?.weather?.[0]?.icon;

  return (
    <article className="weather-card">
      <div className="weather-header">
        <span className="weather-title">Charlotte Weather</span>
      </div>
      <div className="weather-body">
        {error ? (
          <span className="error">{error}</span>
        ) : temp != null ? (
          <>
            <div className="weather-temp">
              {icon && (
                <img
                  src={`https://openweathermap.org/img/wn/${icon}@2x.png`}
                  alt=""
                  className="weather-icon"
                />
              )}
              <span className="value">{Math.round(temp)}°F</span>
            </div>
            {desc && <span className="weather-desc">{desc}</span>}
          </>
        ) : (
          <span className="loading">—</span>
        )}
      </div>
    </article>
  );
}
