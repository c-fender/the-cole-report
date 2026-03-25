import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import './ChessMoveCard.css';

function formatPublished(unixSec) {
  if (!unixSec) return '--';
  const dt = new Date(Number(unixSec) * 1000);
  if (Number.isNaN(dt.getTime())) return '--';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ChessMoveCard({ data }) {
  const error = data?.error;
  const title = data?.title || 'Chess Move of the Day';
  const move = data?.suggestedMove;
  const url = data?.url || 'https://www.chess.com/daily-chess-puzzle';
  const published = formatPublished(data?.published);
  const fen = data?.fen || null;
  const [position, setPosition] = useState(fen || 'start');
  const [moveShown, setMoveShown] = useState(false);
  const [guess, setGuess] = useState('');
  const [guessStatus, setGuessStatus] = useState(null); // 'correct' | 'wrong' | null

  useEffect(() => {
    setPosition(fen || 'start');
    setMoveShown(false);
    setGuess('');
    setGuessStatus(null);
  }, [fen, move]);

  const sideToMove = useMemo(() => {
    if (!fen) return '--';
    const parts = fen.split(' ');
    return parts[1] === 'b' ? 'Black' : 'White';
  }, [fen]);

  function normalizeMove(input) {
    if (!input) return '';
    return String(input)
      .trim()
      .replace(/\s+/g, '')
      .replace(/[+#?!]/g, '')
      .toLowerCase();
  }

  function showSuggestedMove() {
    if (!fen || !move) return;
    try {
      const game = new Chess(fen);
      const ok = game.move(move, { sloppy: true });
      if (!ok) return;
      setPosition(game.fen());
      setMoveShown(true);
    } catch {
      // Ignore parse failures and keep original position
    }
  }

  function resetPosition() {
    setPosition(fen || 'start');
    setMoveShown(false);
    setGuess('');
    setGuessStatus(null);
  }

  function onCheckGuess(e) {
    e.preventDefault();
    if (!move) return;
    const actual = normalizeMove(move);
    const proposed = normalizeMove(guess);
    if (!proposed) {
      setGuessStatus('wrong');
      return;
    }
    if (proposed === actual) {
      setGuessStatus('correct');
      showSuggestedMove();
    } else {
      setGuessStatus('wrong');
    }
  }

  return (
    <article className="chess-card">
      <div className="chess-head">
        <span className="chess-title">{published} - {title}</span>
        <a href={url} target="_blank" rel="noopener noreferrer">
          Show on chess.com
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
            <span className="chess-label">Suggested Move</span>
            <code className="chess-move">
              {moveShown || guessStatus === 'correct' ? move || '--' : '???'}
            </code>
            <button className="chess-btn" type="button" onClick={resetPosition}>
              Reset
            </button>
          </div>

          <form className="chess-guess-form" onSubmit={onCheckGuess}>
            <input
              className="chess-guess-input"
              type="text"
              placeholder="Enter your move"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              disabled={guessStatus === 'correct'}
              aria-label="Guess the suggested move"
            />
            <button className="chess-btn" type="submit" disabled={guessStatus === 'correct'}>
              Check
            </button>
          </form>

          {guessStatus === 'correct' && (
            <div className="chess-result chess-result-correct">✅ Correct — nice move.</div>
          )}
          {guessStatus === 'wrong' && (
            <div className="chess-result chess-result-wrong">❌ Not quite — try again.</div>
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

