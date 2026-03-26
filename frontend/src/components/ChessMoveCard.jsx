import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import './ChessMoveCard.css';

function MoveCorrectIcon() {
  return (
    <span className="chess-move-check" aria-hidden="true" title="Correct">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M20 6L9 17l-5-5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

const dateFmt = { month: 'short', day: 'numeric', year: 'numeric' };

/** Puzzle publish time if present (e.g. Chess.com); otherwise today’s date (e.g. Lichess daily). */
function formatDisplayDate(unixSec) {
  if (unixSec != null && unixSec !== '') {
    const dt = new Date(Number(unixSec) * 1000);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString('en-US', dateFmt);
    }
  }
  return new Date().toLocaleDateString('en-US', dateFmt);
}

/** Build alternate spellings so moves are case-insensitive and +/#/?/! are optional. */
function buildSanInputVariants(raw) {
  const base = String(raw || '').trim();
  if (!base) return [];
  const out = new Set();
  out.add(base);
  const noAnnot = base.replace(/[+#?!]/g, '');
  out.add(noAnnot);
  if (noAnnot.length && /^[kqrnb]/i.test(noAnnot[0])) {
    out.add(noAnnot[0].toUpperCase() + noAnnot.slice(1));
  }
  const lc = noAnnot.toLowerCase();
  if (lc === 'o-o' || lc === 'o-o-o') {
    out.add(lc === 'o-o' ? 'O-O' : 'O-O-O');
    out.add(lc);
  }
  return [...out];
}

/** First successful parse of the user's move (sloppy), or null. */
function tryParseUserMove(fen, inputStr) {
  if (!fen || !inputStr) return null;
  for (const v of buildSanInputVariants(inputStr)) {
    try {
      const g = new Chess(fen);
      const m = g.move(v, { sloppy: true });
      if (m) return { move: m, fenAfterUser: g.fen() };
    } catch {
      // try next variant
    }
  }
  return null;
}

/** True if the user's text move matches the expected SAN on this position. */
function moveMatchesExpected(fen, inputStr, expectedSan) {
  if (!fen || !expectedSan) return false;
  try {
    const parsed = tryParseUserMove(fen, inputStr);
    if (!parsed) return false;
    const b = new Chess(fen);
    const ref = b.move(String(expectedSan).trim(), { sloppy: true });
    if (!ref) return false;
    const played = parsed.move;
    return (
      played.from === ref.from &&
      played.to === ref.to &&
      (played.promotion || '') === (ref.promotion || '')
    );
  } catch {
    return false;
  }
}

export default function ChessMoveCard({ data }) {
  const error = data?.error;
  const title = data?.title || 'Chess Move of the Day';
  const source = data?.source === 'lichess' ? 'lichess' : 'chesscom';
  const sourceLabel = source === 'lichess' ? 'Lichess' : 'chess.com';
  const url =
    data?.url ||
    (source === 'lichess'
      ? 'https://lichess.org/training/daily'
      : 'https://www.chess.com/daily-chess-puzzle');
  const displayDate = formatDisplayDate(data?.published);
  const fen = data?.fen || null;

  const solutionLine = useMemo(() => {
    const raw = data?.solutionSan;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    if (data?.suggestedMove) return [data.suggestedMove];
    return [];
  }, [data?.solutionSan, data?.suggestedMove]);

  const userMoveCount = useMemo(
    () => Math.ceil(solutionLine.length / 2),
    [solutionLine.length]
  );

  const [position, setPosition] = useState(fen || 'start');
  /** Completed user-move index (0 = none solved yet; equals userMoveCount when done). */
  const [completedUserSteps, setCompletedUserSteps] = useState(0);
  const [currentGuess, setCurrentGuess] = useState('');
  const [wrongAttempt, setWrongAttempt] = useState(false);
  /** Locked display of each solved user move SAN (as entered/confirmed). */
  const [solvedLabels, setSolvedLabels] = useState([]);
  /** After a correct guess, waiting before the opponent reply is shown on the board. */
  const [awaitingOpponent, setAwaitingOpponent] = useState(false);
  const opponentDelayTimerRef = useRef(null);

  function clearPendingTimeoutOnly() {
    if (opponentDelayTimerRef.current) {
      clearTimeout(opponentDelayTimerRef.current);
      opponentDelayTimerRef.current = null;
    }
  }

  function clearOpponentTimer() {
    clearPendingTimeoutOnly();
    setAwaitingOpponent(false);
  }

  useEffect(() => {
    clearOpponentTimer();
    setPosition(fen || 'start');
    setCompletedUserSteps(0);
    setCurrentGuess('');
    setWrongAttempt(false);
    setSolvedLabels([]);
  }, [fen, solutionLine]);

  useEffect(() => () => clearOpponentTimer(), []);

  const sideToMove = useMemo(() => {
    if (!position || position === 'start') return '--';
    const parts = position.split(' ');
    return parts[1] === 'b' ? 'Black' : 'White';
  }, [position]);

  function resetPosition() {
    clearOpponentTimer();
    setPosition(fen || 'start');
    setCompletedUserSteps(0);
    setCurrentGuess('');
    setWrongAttempt(false);
    setSolvedLabels([]);
  }

  const OPPONENT_REPLY_DELAY_MS = 500;

  /** After the user’s move is known: optional delayed opponent reply, then advance step. */
  function finishStepAfterUserMove(fenAfterUser, userSanPlayed, oppSan) {
    setWrongAttempt(false);
    setCurrentGuess('');
    if (oppSan) {
      clearPendingTimeoutOnly();
      setPosition(fenAfterUser);
      setAwaitingOpponent(true);
      setSolvedLabels((prev) => [...prev, userSanPlayed]);
      opponentDelayTimerRef.current = setTimeout(() => {
        opponentDelayTimerRef.current = null;
        try {
          const g2 = new Chess(fenAfterUser);
          const o = g2.move(String(oppSan).trim(), { sloppy: true });
          if (!o) {
            setAwaitingOpponent(false);
            return;
          }
          setPosition(g2.fen());
          setCompletedUserSteps((s) => s + 1);
        } catch {
          // ignore
        }
        setAwaitingOpponent(false);
      }, OPPONENT_REPLY_DELAY_MS);
    } else {
      setPosition(fenAfterUser);
      setSolvedLabels((prev) => [...prev, userSanPlayed]);
      setCompletedUserSteps((s) => s + 1);
    }
  }

  function onCheckGuess(e) {
    e.preventDefault();
    if (!fen || completedUserSteps >= userMoveCount || awaitingOpponent) return;

    const expectedSan = solutionLine[completedUserSteps * 2];
    if (!expectedSan) return;

    if (!moveMatchesExpected(position, currentGuess, expectedSan)) {
      setWrongAttempt(true);
      return;
    }

    const parsed = tryParseUserMove(position, currentGuess);
    if (!parsed) {
      setWrongAttempt(true);
      return;
    }

    const { fenAfterUser, move: played } = parsed;
    const userSanPlayed = played.san;
    const oppSan = solutionLine[completedUserSteps * 2 + 1];
    finishStepAfterUserMove(fenAfterUser, userSanPlayed, oppSan);
  }

  function onRevealMove() {
    if (!fen || completedUserSteps >= userMoveCount || awaitingOpponent) return;
    const expectedSan = solutionLine[completedUserSteps * 2];
    if (!expectedSan) return;
    try {
      const g = new Chess(position);
      const played = g.move(String(expectedSan).trim(), { sloppy: true });
      if (!played) return;
      const fenAfterUser = g.fen();
      const oppSan = solutionLine[completedUserSteps * 2 + 1];
      finishStepAfterUserMove(fenAfterUser, played.san, oppSan);
    } catch {
      // ignore
    }
  }

  const solved = completedUserSteps >= userMoveCount && userMoveCount > 0;

  return (
    <article className="chess-card">
      <div className="chess-head">
        <span className="chess-title">
          {displayDate} - {title}
        </span>
        <a href={url} target="_blank" rel="noopener noreferrer">
          Show on {sourceLabel}
        </a>
      </div>

      {error ? (
        <div className="chess-error">{String(error)}</div>
      ) : (
        <>
          <div className="chess-board-wrap">
            <Chessboard
              id="chess-move-of-day"
              position={position}
              arePiecesDraggable={false}
              boardWidth={360}
              customDarkSquareStyle={{ backgroundColor: '#1f2937' }}
              customLightSquareStyle={{ backgroundColor: '#4b5563' }}
            />
          </div>

          <div className="chess-main">
            <span className="chess-label">Your move</span>
            <code className="chess-move">
              {solved ? solutionLine.join(' ') : '???'}
            </code>
            <button className="chess-btn" type="button" onClick={resetPosition}>
              Reset
            </button>
          </div>

          {solutionLine.length === 0 ? (
            <div className="chess-result chess-result-wrong">No puzzle line available.</div>
          ) : (
            <>
              {solvedLabels.map((san, i) => (
                <div key={`locked-${i}`} className="chess-move-row chess-move-row-solved">
                  <input
                    className="chess-guess-input chess-guess-input-locked"
                    disabled
                    value={san}
                    readOnly
                    aria-label="Completed move"
                  />
                  <MoveCorrectIcon />
                </div>
              ))}

              {!solved && (
                <form className="chess-guess-form chess-move-row" onSubmit={onCheckGuess}>
                  <input
                    className="chess-guess-input"
                    type="text"
                    placeholder="Enter your move"
                    value={currentGuess}
                    disabled={awaitingOpponent}
                    onChange={(e) => {
                      setCurrentGuess(e.target.value);
                      setWrongAttempt(false);
                    }}
                    aria-label="Guess the next move"
                  />
                  <button className="chess-btn" type="submit" disabled={awaitingOpponent}>
                    Check
                  </button>
                  <button
                    className="chess-btn chess-btn-muted"
                    type="button"
                    onClick={onRevealMove}
                    disabled={awaitingOpponent}
                  >
                    Reveal move
                  </button>
                </form>
              )}

              {solved && (
                <div className="chess-result chess-result-correct">Puzzle complete!</div>
              )}
              {wrongAttempt && !solved && !awaitingOpponent && (
                <div className="chess-result chess-result-wrong">Not quite — try again.</div>
              )}
            </>
          )}

          <div className="chess-meta">
            <span>To move: {sideToMove}</span>
            {data?.fen && <span className="chess-sep">·</span>}
            {data?.fen && <span className="chess-fen">FEN: {data.fen}</span>}
          </div>
        </>
      )}
    </article>
  );
}
