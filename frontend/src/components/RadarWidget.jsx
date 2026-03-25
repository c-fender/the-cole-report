import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './RadarWidget.css';

function isValidZip(zip) {
  return /^\d{5}$/.test(zip);
}

async function fetchRainViewerFrame() {
  const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  const j = await r.json();
  const host = j?.host;
  const frames = Array.isArray(j?.radar?.past) ? j.radar.past : [];
  const last = frames.length ? frames[frames.length - 1] : null;
  if (!host || !last?.path) return null;
  return { host, path: last.path, generated: j?.generated ?? null };
}

export default function RadarWidget({ apiBase, defaultLat, defaultLon, expectedPop }) {
  const [zip, setZip] = useState('');
  const [center, setCenter] = useState(
    defaultLat != null && defaultLon != null ? { lat: defaultLat, lon: defaultLon } : null
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [frame, setFrame] = useState(null);

  const canSearch = useMemo(() => isValidZip(zip.trim()), [zip]);
  const frameTimeLabel = useMemo(() => {
    if (!frame?.generated) return null;
    const d = new Date(Number(frame.generated) * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }, [frame]);
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const osmRef = useRef(null);
  const radarRef = useRef(null);
  const markerRef = useRef(null);

  async function ensureFrame() {
    if (frame) return frame;
    const fr = await fetchRainViewerFrame();
    if (!fr) throw new Error('Radar frame unavailable');
    setFrame(fr);
    return fr;
  }

  // Init/destroy map
  useEffect(() => {
    if (!center || !mapElRef.current) return undefined;
    if (mapRef.current) return undefined;

    const map = L.map(mapElRef.current, {
      zoomControl: true,
      attributionControl: false,
      minZoom: 1,
      maxZoom: 7, // RainViewer max
    });
    mapRef.current = map;

    osmRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    map.setView([center.lat, center.lon], 7);

    markerRef.current = L.circleMarker([center.lat, center.lon], {
      radius: 6,
      color: '#58a6ff',
      weight: 2,
      fillColor: '#58a6ff',
      fillOpacity: 0.15,
    }).addTo(map);

    return () => {
      try {
        map.remove();
      } catch {
        // ignore double-destroy edge cases
      }
      mapRef.current = null;
      osmRef.current = null;
      radarRef.current = null;
      markerRef.current = null;
    };
  }, [center]);

  // Update radar overlay whenever frame changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frame) return;

    const color = 2; // Universal Blue
    const options = '1_0';
    const url = `${frame.host}${frame.path}/256/{z}/{x}/{y}/${color}/${options}.png`;

    if (radarRef.current) {
      radarRef.current.setUrl(url);
    } else {
      radarRef.current = L.tileLayer(url, { opacity: 0.9, zIndex: 10 }).addTo(map);
    }
  }, [frame]);

  // Recenter map + marker when center changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    map.setView([center.lat, center.lon], Math.min(map.getZoom() || 7, 7), { animate: true });
    if (markerRef.current) markerRef.current.setLatLng([center.lat, center.lon]);
  }, [center]);

  async function onSubmit(e) {
    e.preventDefault();
    const z = zip.trim();
    setErr(null);
    if (!isValidZip(z)) {
      setErr('Enter a valid 5-digit US zip code.');
      return;
    }
    setLoading(true);
    try {
      await ensureFrame();
      const base = apiBase || '/api';
      const r = await fetch(`${base}/geocode/zip/${z}`);
      const j = await r.json();
      if (j?.error) throw new Error(j.error);
      setCenter({ lat: j.lat, lon: j.lon });
    } catch (e2) {
      setErr(String(e2?.message || 'Radar lookup failed'));
    } finally {
      setLoading(false);
    }
  }

  function onClear() {
    setZip('');
    setErr(null);
    // Hide the radar view until user hits Load/Go again.
    setCenter(null);
  }

  return (
    <section className="radar-widget">
      <div className="radar-head">
        <span className="radar-title">Radar</span>
        <span className="radar-sub">
          <em>(RainViewer)</em>
        </span>
      </div>

      <div className="radar-controls">
        <form className="radar-form" onSubmit={onSubmit}>
          <input
            className="radar-input"
            inputMode="numeric"
            placeholder="Zip (e.g., 28202)"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            maxLength={5}
            aria-label="Radar zip code"
          />
          <button className="radar-btn" type="submit" disabled={loading || !canSearch}>
            {loading ? '…' : 'Go'}
          </button>
        </form>
        <button className="radar-btn-secondary" type="button" onClick={onClear} disabled={loading}>
          Clear
        </button>
      </div>

      {err && <div className="radar-error">{err}</div>}

      {!err && expectedPop === 0 && (
        <div className="radar-hint">No precip expected soon — radar overlay may be empty.</div>
      )}

      {center ? (
        <div className="radar-map-wrap">
          <div ref={mapElRef} className="radar-map" />
          <div className="radar-legend">
            <div className="radar-legend-row">
              <span className="radar-swatch" />
              <span>Precipitation overlay</span>
            </div>
            <div className="radar-legend-meta">
              {expectedPop != null ? `Next 2h rain chance: ${expectedPop}%` : 'Rain chance: --'}
              {frameTimeLabel ? ` · Updated ~${frameTimeLabel}` : ''}
            </div>
          </div>
          <div className="radar-meta">
            <a
              href="https://www.rainviewer.com/weather-radar-map-live.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open interactive radar
            </a>
          </div>
        </div>
      ) : (
        <div className="radar-empty">Enter a zip code and hit Go to load radar.</div>
      )}
    </section>
  );
}

