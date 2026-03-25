import { useMemo, useState } from 'react';
import './GasBuddySearch.css';

function isValidZip(zip) {
  return /^\d{5}$/.test(zip);
}

export default function GasBuddySearch() {
  const [zip, setZip] = useState('');
  const [error, setError] = useState(null);
  const [lastSearchedZip, setLastSearchedZip] = useState(null);

  const canSearch = useMemo(() => isValidZip(zip.trim()), [zip]);
  const sourceUrl = lastSearchedZip
    ? `https://www.gasbuddy.com/home?search=${encodeURIComponent(
        lastSearchedZip
      )}&fuel=1&method=all&maxAge=0`
    : null;

  async function onSubmit(e) {
    e.preventDefault();
    const z = zip.trim();
    setLastSearchedZip(z);
    setError(null);

    if (!isValidZip(z)) {
      setError('Enter a valid 5-digit US zip code.');
      return;
    }

    window.open(
      `https://www.gasbuddy.com/home?search=${encodeURIComponent(
        z
      )}&fuel=1&method=all&maxAge=0`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  return (
    <section className="gb-widget">
      <div className="gb-head">
        <span className="gb-title">Search by Zip Code</span>
        <span className="gb-subtitle">GasBuddy (opens in new tab)</span>
      </div>

      <form className="gb-form" onSubmit={onSubmit}>
        <input
          className="gb-input"
          inputMode="numeric"
          placeholder="Enter zip code (e.g., 28202)"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          maxLength={5}
          aria-label="Zip code"
        />
        <button className="gb-btn" type="submit" disabled={!canSearch}>
          Open
        </button>
      </form>

      {error && (
        <div className="gb-error">
          <span>{error}</span>
          {sourceUrl && (
            <a className="gb-fallback" href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Open GasBuddy
            </a>
          )}
        </div>
      )}
    </section>
  );
}

