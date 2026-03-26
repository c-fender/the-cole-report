import { useState } from 'react';
import './SportsPanel.css';

const SOURCE_URL = 'https://www.thesportsdb.com/';

/** Prefer tiny previews when TheSportsDB returns a base media URL. */
function badgeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const t = url.trim();
  if (!t) return null;
  if (/\/(tiny|small|medium|large)$/i.test(t)) return t;
  return `${t.replace(/\/$/, '')}/tiny`;
}

function TeamBadgeImg({ src, alt }) {
  const [failed, setFailed] = useState(false);
  const u = badgeUrl(src);
  if (!u || failed) return null;
  return (
    <img
      src={u}
      alt={alt}
      className="sports-team-badge"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * TheSportsDB "next league event" is often the next row in their schedule — that can be a game that
 * already finished (with scores). We classify so the UI doesn't say "upcoming" for finals.
 */
function classifyEvent(ev) {
  if (!ev) return 'upcoming';
  const s = String(ev.status || '').toLowerCase();
  if (/not started|scheduled|tbd|time tbd|postponed/.test(s)) return 'upcoming';
  if (/finished|final|ft\b|after overtime|walkoff|complete|ended|full time/.test(s)) return 'final';
  // "live/ongoing" statuses vary by sport in TheSportsDB (ex: baseball uses `IN1`..`IN9`).
  if (
    /live|in play|in progress|halftime|\binning\b|\bin\d+\b|\bp\d+\b|\b1h\b|\b2h\b|1st quarter|2nd quarter|3rd quarter|4th quarter|q1|q2|q3|q4/.test(
      s
    )
  ) {
    return 'live';
  }
  const hs = ev.homeScore;
  const as = ev.awayScore;
  if (hs != null && hs !== '' && as != null && as !== '') {
    return 'final';
  }
  return 'upcoming';
}

function EventKindPill({ ev }) {
  const k = classifyEvent(ev);
  if (k === 'live') {
    return (
      <span className="sports-event-pill sports-event-pill--live" title="Game in progress">
        Live
      </span>
    );
  }
  if (k === 'final') {
    return (
      <span className="sports-event-pill sports-event-pill--final" title="Final score — game completed">
        Final
      </span>
    );
  }
  return (
    <span className="sports-event-pill sports-event-pill--upcoming" title="Not started yet">
      Upcoming
    </span>
  );
}

function shouldShowStatusText(ev) {
  // Pill already communicates the game state (Upcoming/Live/Final).
  // Avoid showing redundant raw status values like "FT", "NS", "IN7", etc.
  return false;
}

function MatchupLine({ ev }) {
  if (!ev) return <span>—</span>;
  const hs = ev.homeScore;
  const as = ev.awayScore;
  const hasScore = hs != null && hs !== '' && as != null && as !== '';
  const away = ev.away || 'Away';
  const home = ev.home || 'Home';
  const concluded = showConcludedDate(ev);
  const concludedLabel = concluded ? formatCalendarDate(concludedDateForEvent(ev)) : '';

  if (!ev.home && !ev.away) {
    return <span>{ev.event || '—'}</span>;
  }

  return (
    <div className="sports-matchup">
      <TeamBadgeImg src={ev.awayBadge} alt={`${away} logo`} />
      <div className="sports-matchup-maincol">
        <span className="sports-matchup-names">
          {hasScore ? (
            <>
              <span className="sports-name">{away}</span>
              <span className="sports-score">{String(as)}</span>
              <span className="sports-at">@</span>
              <span className="sports-name">{home}</span>
              <span className="sports-score">{String(hs)}</span>
            </>
          ) : (
            <>
              <span className="sports-name">{away}</span>
              <span className="sports-at">@</span>
              <span className="sports-name">{home}</span>
            </>
          )}
        </span>
        {concluded && concludedLabel ? (
          <span className="sports-matchup-concluded" title="Date concluded (venue local when available)">
            Ended {concludedLabel}
          </span>
        ) : null}
      </div>
      <TeamBadgeImg src={ev.homeBadge} alt={`${home} logo`} />
    </div>
  );
}

function formatTime(t) {
  if (t == null || t === '') return '';
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  let h = Number(m[1]);
  const min = m[2];
  const ap = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

function formatTimeFromTimestamp(ev) {
  const ts = ev?.timestamp;
  if (typeof ts !== 'string' || !ts.trim()) return '';
  const raw = ts.trim();
  // If the API provides a naive ISO string (no `Z` / offset), treat it as UTC.
  // This prevents showing times like `2:00 a.m.` when the intended meaning is UTC.
  const needsUtcSuffix = !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  const d = needsUtcSuffix ? new Date(`${raw}Z`) : new Date(raw);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === 'hour')?.value;
  const mm = parts.find((p) => p.type === 'minute')?.value;
  if (!hh || !mm) return '';
  return formatTime(`${hh}:${mm}:00`);
}

/** `YYYY-MM-DD` → locale medium date (calendar components only, no TZ shift). */
function formatCalendarDate(yyyyMmDd) {
  if (yyyyMmDd == null || typeof yyyyMmDd !== 'string') return '';
  const m = yyyyMmDd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(yyyyMmDd).trim();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * Convert a wall-clock datetime in America/New_York into a UTC epoch ms.
 * Used as a fallback when TheSportsDB doesn't provide `strTimestamp`.
 */
function easternWallClockToMs(yyyyMmDd, hh, mm, ss) {
  const d = String(yyyyMmDd || '').trim();
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const H = Number(hh);
  const M = Number(mm);
  const S = Number(ss);
  if (![year, month, day, H, M, S].every((n) => Number.isFinite(n))) return null;

  const desiredWallMs = Date.UTC(year, month - 1, day, H, M, S);
  let guessMs = desiredWallMs;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  for (let i = 0; i < 3; i += 1) {
    const parts = dtf.formatToParts(new Date(guessMs));
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const nyY = Number(get('year'));
    const nyM = Number(get('month'));
    const nyD = Number(get('day'));
    const nyH = Number(get('hour'));
    const nyMin = Number(get('minute'));
    const nyS = Number(get('second'));
    if (![nyY, nyM, nyD, nyH, nyMin, nyS].every((n) => Number.isFinite(n))) break;

    const nyWallMs = Date.UTC(nyY, nyM - 1, nyD, nyH, nyMin, nyS);
    const diff = desiredWallMs - nyWallMs;
    if (!Number.isFinite(diff) || diff === 0) break;
    guessMs += diff;
  }

  return Number.isFinite(guessMs) ? guessMs : null;
}

function concludedDateForEvent(ev) {
  const local = ev?.dateLocal && String(ev.dateLocal).trim();
  const primary = ev?.date && String(ev.date).trim();
  return local || primary || '';
}

/** Finished box scores only — not in-progress games that happen to have a score line. */
function showConcludedDate(ev) {
  if (classifyEvent(ev) === 'live') return false;
  const hs = ev.homeScore;
  const as = ev.awayScore;
  return hs != null && hs !== '' && as != null && as !== '';
}

/** Prefer `strTimestamp` (UTC). Fallback: interpret `date` + `timeLocal` as America/New_York wall time. */
function eventStartMs(ev) {
  const ts = ev?.timestamp;
  if (typeof ts === 'string' && ts.trim()) {
    const s = ts.trim();
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
      const ms = Date.parse(s);
      return Number.isFinite(ms) ? ms : null;
    }
    const ms = Date.parse(`${s}Z`);
    return Number.isFinite(ms) ? ms : null;
  }
  const d = ev?.date;
  const t = ev?.timeLocal;
  if (typeof d !== 'string' || typeof t !== 'string') return null;
  const ds = d.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds) || !m) return null;
  const hh = String(m[1]).padStart(2, '0');
  const mm = m[2];
  const ss = m[3] != null ? String(m[3]).padStart(2, '0') : '00';
  const ms = easternWallClockToMs(ds, hh, mm, ss);
  return Number.isFinite(ms) ? ms : null;
}

function compareByStartAsc(a, b) {
  const sa = eventStartMs(a);
  const sb = eventStartMs(b);
  if (sa != null && sb != null) return sa - sb;
  if (sa != null) return -1;
  if (sb != null) return 1;
  return String(a.timeLocal || '').localeCompare(String(b.timeLocal || ''));
}

function compareByStartDesc(a, b) {
  const sa = eventStartMs(a);
  const sb = eventStartMs(b);
  if (sa != null && sb != null) return sb - sa;
  if (sa != null) return -1;
  if (sb != null) return 1;
  return String(b.timeLocal || '').localeCompare(String(a.timeLocal || ''));
}

/**
 * Upcoming = not started yet and kickoff after now. Latest = finals, live, scored, or start time in the past.
 */
function bucketForEvent(ev, nowMs) {
  const kind = classifyEvent(ev);
  if (kind === 'final' || kind === 'live') return 'latest';

  const hs = ev.homeScore;
  const as = ev.awayScore;
  if (hs != null && hs !== '' && as != null && as !== '') return 'latest';

  const startMs = eventStartMs(ev);
  if (startMs != null && Number.isFinite(startMs)) {
    if (startMs > nowMs) return 'upcoming';
    return 'latest';
  }

  return kind === 'upcoming' ? 'upcoming' : 'latest';
}

function splitUpcomingLatest(events, nowMs) {
  const upcoming = [];
  const latest = [];
  for (const ev of events) {
    if (bucketForEvent(ev, nowMs) === 'upcoming') upcoming.push(ev);
    else latest.push(ev);
  }
  upcoming.sort(compareByStartAsc);
  latest.sort(compareByStartDesc);
  return { upcoming, latest };
}

function groupEventsByLeague(events) {
  const m = new Map();
  for (const ev of events) {
    const key = (ev.league && String(ev.league).trim()) || 'Other';
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(ev);
  }
  return m;
}

/** Same game as backend `eventDedupeKey` — merge daily feed + league "next" without duplicates. */
function eventIdentity(ev) {
  if (!ev || typeof ev !== 'object') return '';
  // Cross-source dedupe: TheSportsDB and ESPN use different IDs for the same game.
  // Using date+home+away is stable enough for this UI and prevents duplicates.
  const home = ev.home || '';
  const away = ev.away || '';
  const date = ev.date || '';
  if (date && home && away) return `f:${date}|${home}|${away}`;
  const id = ev.id;
  if (id != null && id !== '') return `id:${id}`;
  return '';
}

function mergeLeagueEvents(todayEvents, nextEvent) {
  const merged = new Map();
  for (const ev of todayEvents) {
    const k = eventIdentity(ev);
    if (k) merged.set(k, ev);
  }
  if (nextEvent) {
    const k = eventIdentity(nextEvent);
    if (k && !merged.has(k)) merged.set(k, nextEvent);
  }
  return [...merged.values()];
}

/** Pull today's games for a major-league label; removes the bucket from the map when matched. */
function takeTodayEventsForTarget(map, targetName) {
  const target = String(targetName || '')
    .trim()
    .toLowerCase();
  if (!target) return [];

  for (const [k, arr] of map) {
    if (k.toLowerCase() === target) {
      map.delete(k);
      return arr;
    }
  }
  for (const [k, arr] of map) {
    const kl = k.toLowerCase();
    if (kl.includes(target) || target.includes(kl)) {
      map.delete(k);
      return arr;
    }
  }
  return [];
}

/**
 * One section per league: major-league rows first, then any other leagues that only appear in today's feed.
 */
function buildLeagueSections(upcoming, todayEvents, nowMs) {
  const map = groupEventsByLeague(todayEvents);
  const sections = [];
  const cutoffMs = nowMs + 7 * 24 * 60 * 60 * 1000;

  function shouldShowMajorLeague(row) {
    // If we don't have a "next" event for the league, hide the category entirely.
    if (!row?.nextEvent) return false;

    // If the next event is an upcoming kickoff, only show when it starts within the next week.
    if (classifyEvent(row.nextEvent) === 'upcoming') {
      const startMs = eventStartMs(row.nextEvent);
      if (startMs != null && Number.isFinite(startMs)) {
        return startMs <= cutoffMs;
      }
      // If we can't parse a start time, err on the side of showing the league.
      return true;
    }

    // For live/final, treat the league as ongoing.
    return true;
  }

  for (const row of upcoming) {
    if (!shouldShowMajorLeague(row)) continue;
    const today = takeTodayEventsForTarget(map, row.name);
    const merged = mergeLeagueEvents(today, row.nextEvent);
    const { upcoming: upcomingEvents, latest: latestEvents } = splitUpcomingLatest(merged, nowMs);
    sections.push({
      sectionKey: row.key,
      displayName: row.name,
      upcomingEvents,
      latestEvents,
      upcomingRow: row,
    });
  }

  const rest = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [leagueName, events] of rest) {
    // These are "extra" leagues from today's feed; if they have any rows today,
    // they're effectively ongoing for this UI.
    if (!Array.isArray(events) || events.length === 0) continue;
    const { upcoming: upcomingEvents, latest: latestEvents } = splitUpcomingLatest(events, nowMs);
    sections.push({
      sectionKey: `extra-${leagueName}`,
      displayName: leagueName,
      upcomingEvents,
      latestEvents,
      upcomingRow: null,
    });
  }

  return sections;
}

export default function SportsPanel({ data }) {
  if (data?.error && !data?.fetchedAt) {
    return (
      <section className="sports-panel tab-content">
        <div className="sports-banner error">
          Sports data unavailable: {String(data.error)}
          {data.details ? <span className="sports-banner-detail"> — {String(data.details)}</span> : null}
        </div>
        <p className="sports-hint">
          The backend proxies{' '}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            TheSportsDB
          </a>
          . Set <code>THESPORTSDB_API_KEY</code> in <code>backend/.env</code> if you use a premium key; the free
          test key <code>123</code> works without signup.
        </p>
      </section>
    );
  }

  if (data == null) {
    return (
      <section className="sports-panel tab-content">
        <p className="sports-loading">Loading sports…</p>
      </section>
    );
  }

  const today = Array.isArray(data.todayEvents) ? data.todayEvents : [];
  const upcoming = Array.isArray(data.upcomingByLeague) ? data.upcomingByLeague : [];
  const nowMs = Date.now();
  const leagueSections = buildLeagueSections(upcoming, today, nowMs);

  return (
    <section className="sports-panel tab-content">
      <div className="sports-header">
        <p className="sports-intro">
          Schedules and scores from{' '}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            TheSportsDB
          </a>{' '}
          (crowdsourced). Daily list uses the US Eastern calendar date <code>{data.dateLabel}</code>.
        </p>
        {data.fetchedAt ? (
          <p className="sports-meta">
            Fetched:{' '}
            <code>
              {new Date(data.fetchedAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </code>
          </p>
        ) : null}
      </div>

      <div className="sports-section">
        <h3 className="sports-section-title">By league</h3>
        <p className="sports-hint subtle">
          Each league splits into &quot;Upcoming&quot; (kickoff after now) and &quot;Latest&quot; (final, live, or
          already started). Start times use the API&apos;s UTC timestamp when present. Extra leagues appear at the
          bottom.
        </p>
        {leagueSections.length === 0 ? (
          <p className="sports-empty">No league data loaded.</p>
        ) : (
          <div className="sports-league-stack">
            {leagueSections.map((sec) => (
              <details
                key={sec.sectionKey}
                className={`sports-league-collapse${sec.upcomingRow ? ' sports-league-collapse--major' : ''}`}
                open
              >
                <summary className="sports-league-summary">
                  <span className="sports-league-summary-name">{sec.displayName}</span>
                  <span className="sports-league-summary-meta">
                    <span className="sports-league-counts">
                      {sec.upcomingEvents.length} upcoming · {sec.latestEvents.length} latest
                    </span>
                  </span>
                </summary>
                <div className="sports-league-inner">
                  {sec.upcomingRow?.error ? (
                    <div className="sports-card-error sports-card-error--league">{sec.upcomingRow.error}</div>
                  ) : null}
                  <details className="sports-subsection" open>
                    <summary className="sports-subsection-summary">Upcoming</summary>
                    <div className="sports-subsection-body">
                      {sec.upcomingEvents.length === 0 ? (
                        <p className="sports-empty sports-empty--tight">No upcoming games (start after now).</p>
                      ) : (
                        <ul className="sports-list sports-list--nested">
                          {sec.upcomingEvents.map((ev) => (
                            <li
                              key={ev.id || `${ev.event}-${ev.date}-${ev.timeLocal}`}
                              className="sports-row sports-row--in-league"
                            >
                              <span className="sports-row-main">
                                <MatchupLine ev={ev} />
                              </span>
                              <span className="sports-row-meta">
                                <EventKindPill ev={ev} />
                                {shouldShowStatusText(ev) ? <span className="sports-status">{ev.status}</span> : null}
                                {formatTimeFromTimestamp(ev)
                                  ? ` ${formatTimeFromTimestamp(ev)}`
                                  : ev.timeLocal
                                    ? ` ${formatTime(ev.timeLocal)}`
                                    : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>

                  <details className="sports-subsection" open>
                    <summary className="sports-subsection-summary">Latest</summary>
                    <div className="sports-subsection-body">
                      {sec.latestEvents.length === 0 ? (
                        <p className="sports-empty sports-empty--tight">
                          No finished or in-progress games in this list.
                        </p>
                      ) : (
                        <ul className="sports-list sports-list--nested">
                          {sec.latestEvents.map((ev) => (
                            <li
                              key={ev.id || `${ev.event}-${ev.date}-${ev.timeLocal}`}
                              className="sports-row sports-row--in-league"
                            >
                              <span className="sports-row-main">
                                <MatchupLine ev={ev} />
                              </span>
                              <span className="sports-row-meta">
                                <EventKindPill ev={ev} />
                                {shouldShowStatusText(ev) ? <span className="sports-status">{ev.status}</span> : null}
                                {formatTimeFromTimestamp(ev)
                                  ? ` ${formatTimeFromTimestamp(ev)}`
                                  : ev.timeLocal
                                    ? ` ${formatTime(ev.timeLocal)}`
                                    : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
