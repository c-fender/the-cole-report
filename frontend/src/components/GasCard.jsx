import React from 'react';
import './GasCard.css';

const ROW_LABELS = {
  current: 'Current Avg.',
  yesterday: 'Yesterday Avg.',
  weekAgo: 'Week Ago Avg.',
  monthAgo: 'Month Ago Avg.',
  yearAgo: 'Year Ago Avg.',
};

const COLS = ['regular', 'midGrade', 'premium', 'diesel'];
const COL_HEADERS = ['Regular', 'Mid-Grade', 'Premium', 'Diesel'];

function formatPrice(val) {
  return val != null ? `$${Number(val).toFixed(3)}` : '—';
}

function getDoDIndicator(currentRow, yesterdayRow, col) {
  const curr = parseFloat(currentRow?.[col]);
  const prev = parseFloat(yesterdayRow?.[col]);
  if (isNaN(curr) || isNaN(prev)) return null;
  const change = curr - prev;
  if (change === 0) return { dir: '—', amt: '0.000' };
  const amt = Math.abs(change).toFixed(3);
  return change > 0 ? { dir: '↑', amt } : { dir: '↓', amt };
}

export default function GasCard({ data, title, sourceUrl }) {
  const error = data?.error;
  const rows = data?.rows || [];
  const url = sourceUrl || 'https://gasprices.aaa.com/';
  const displayTitle = title || 'National Average Gas Prices';
  const currentRow = rows.find((r) => r.label === 'current');
  const yesterdayRow = rows.find((r) => r.label === 'yesterday');

  if (error) {
    return (
      <article className="gas-card gas-card-full">
        <div className="gas-header">
          <span className="gas-title">
            {displayTitle} (
            <a href={url} target="_blank" rel="noopener noreferrer" className="gas-source-link">
              <em>Source</em>
            </a>
            )
          </span>
        </div>
        <div className="gas-body error">{error}</div>
      </article>
    );
  }

  return (
    <article className="gas-card gas-card-full">
      <div className="gas-header">
        <span className="gas-title">
          {displayTitle} (
          <a href={url} target="_blank" rel="noopener noreferrer" className="gas-source-link">
            <em>Source</em>
          </a>
          )
        </span>
      </div>
      <div className="gas-table-wrap">
        <table className="gas-table gas-table-with-dod">
          <thead>
            <tr>
              <th className="gas-col-label"></th>
              {COL_HEADERS.map((h) => (
                <React.Fragment key={h}>
                  <th className="gas-col-fuel">{h}</th>
                  <th className="gas-col-dod"></th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.label === 'current' ? 'gas-row-current' : ''}>
                <td className="gas-row-label">{ROW_LABELS[row.label] || row.label}</td>
                {COLS.map((col) => {
                  const isCurrent = row.label === 'current';
                  const dod = isCurrent ? getDoDIndicator(currentRow, yesterdayRow, col) : null;
                  return (
                    <React.Fragment key={col}>
                      <td className="gas-price-cell">{formatPrice(row[col])}</td>
                      <td className="gas-dod-cell">
                        {dod != null && dod.dir !== '—' ? (
                          <span className={`gas-dod gas-dod-${dod.dir === '↑' ? 'up' : 'down'}`}>
                            {dod.dir} ${dod.amt} DoD
                          </span>
                        ) : null}
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
