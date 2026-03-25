import './WeatherCard.css';
import RadarWidget from './RadarWidget';

function formatSlotTime(dtSec, timeZone) {
  if (dtSec == null) return '—';
  return new Date(dtSec * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timeZone || 'America/New_York',
  });
}

export default function WeatherCard({ data, apiBase }) {
  const error = data?.error;
  const current = data?.current ?? (data?.main && !data?.next24h ? data : null);
  const tz = data?.timeZone || 'America/New_York';
  const temp = current?.main?.temp;
  const desc = current?.weather?.[0]?.description;
  const icon = current?.weather?.[0]?.icon;
  const feels = current?.main?.feels_like;
  const humidity = current?.main?.humidity;
  const wind = current?.wind?.speed;
  const todayRange = data?.todayRange;
  const next24h = Array.isArray(data?.next24h) ? data.next24h : [];
  const commute = data?.commute;
  const defaultLat = current?.coord?.lat ?? null;
  const defaultLon = current?.coord?.lon ?? null;

  return (
    <article className="weather-card">
      <div className="weather-header">
        <span className="weather-title">Charlotte Weather</span>
        <span className="weather-tz">({tz === 'America/New_York' ? 'ET' : tz})</span>
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
            {(feels != null || humidity != null || wind != null) && (
              <div className="weather-meta-line">
                {feels != null && <span>Feels like {Math.round(feels)}°F</span>}
                {feels != null && (humidity != null || wind != null) && (
                  <span className="weather-meta-sep">·</span>
                )}
                {humidity != null && <span>{humidity}% humidity</span>}
                {humidity != null && wind != null && <span className="weather-meta-sep">·</span>}
                {wind != null && <span>Wind {Math.round(wind)} mph</span>}
              </div>
            )}
            {todayRange && (
              <div className="weather-today-range">
                Today:{' '}
                <span className="weather-hi">H {todayRange.high}°</span>
                {' / '}
                <span className="weather-lo">L {todayRange.low}°</span>
              </div>
            )}

            {commute && (
              <div className="weather-commute">
                <div className="weather-forecast-label">Commute</div>
                <div className="weather-commute-row">
                  <span className="weather-commute-item">
                    Next 2h:{' '}
                    <strong>
                      {commute?.next2h?.maxPop != null ? `${commute.next2h.maxPop}%` : '--'}
                    </strong>{' '}
                    rain
                    {commute?.next2h?.precipIn != null ? ` (${commute.next2h.precipIn} in)` : ''}
                  </span>
                  <span className="weather-meta-sep">·</span>
                  <span className="weather-commute-item">
                    AM ({commute?.am?.label ?? '7–9am'}):{' '}
                    <strong>{commute?.am?.maxPop != null ? `${commute.am.maxPop}%` : '--'}</strong>
                  </span>
                  <span className="weather-meta-sep">·</span>
                  <span className="weather-commute-item">
                    PM ({commute?.pm?.label ?? '4–6pm'}):{' '}
                    <strong>{commute?.pm?.maxPop != null ? `${commute.pm.maxPop}%` : '--'}</strong>
                  </span>
                </div>
                {commute?.radarUrl && (
                  <a
                    className="weather-radar-link"
                    href={commute.radarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Radar
                  </a>
                )}
              </div>
            )}

            {next24h.length > 0 && (
              <div className="weather-forecast-block">
                <div className="weather-forecast-label">Next 24 hours</div>
                <div className="weather-forecast-row">
                  {next24h.map((slot, idx) => (
                    <div key={`${slot.dt}-${idx}`} className="weather-slot">
                      <span className="weather-slot-time">{formatSlotTime(slot.dt, tz)}</span>
                      {slot.icon && (
                        <img
                          src={`https://openweathermap.org/img/wn/${slot.icon}.png`}
                          alt=""
                          className="weather-slot-icon"
                        />
                      )}
                      <span className="weather-slot-temp">{slot.temp != null ? `${slot.temp}°` : '—'}</span>
                      {slot.pop != null && slot.pop > 0 && (
                        <span className="weather-slot-pop">{slot.pop}%</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <RadarWidget
              apiBase={apiBase}
              defaultLat={defaultLat}
              defaultLon={defaultLon}
              expectedPop={commute?.next2h?.maxPop ?? null}
            />
          </>
        ) : (
          <span className="loading">—</span>
        )}
      </div>
    </article>
  );
}
