// Ember Path UI helpers. Pure functions (no DOM) so they can be unit tested with node --test.
import { MAX_SEED, SIZE, KOMI, result } from './rules.js';

/** In the UI, the person is always player 0 and the computer player 1. */
export const HUMAN = 0;
export const COMPUTER = 1;

/** The computer "thinks" for a random 400-700 ms so its move is easy to follow. */
export const THINK_MIN_MS = 400;
export const THINK_MAX_MS = 700;

const MAX_SEED_DIGITS = String(MAX_SEED).length;
const SEED_RANGE = `a whole number from 0 to ${MAX_SEED}`;

/**
 * Parse what the player typed into the seed box.
 * Accepts digits only (surrounding spaces are ignored). Never throws.
 * @param {unknown} text
 * @returns {{ ok: true, seed: number } | { ok: false, error: string }}
 */
export function parseSeed(text) {
  if (typeof text !== 'string') return { ok: false, error: `Enter a seed: ${SEED_RANGE}.` };
  const t = text.trim();
  if (t === '') return { ok: false, error: `Enter a seed: ${SEED_RANGE}.` };
  if (!/^[0-9]+$/.test(t)) {
    let why = 'Use digits 0-9 only.';
    if (/^[-\u2212]/.test(t)) why = "Seeds can't be negative.";
    else if (/^[0-9]*[.,][0-9]*$/.test(t)) why = 'Use a whole number, without a decimal point or commas.';
    else if (/\s/.test(t)) why = 'Remove the spaces inside the number.';
    return { ok: false, error: `${why} A seed is ${SEED_RANGE}.` };
  }
  const digits = t.replace(/^0+(?=[0-9])/, '');
  if (digits.length > MAX_SEED_DIGITS || Number(digits) > MAX_SEED) {
    return { ok: false, error: `That number is too big. The largest seed is ${MAX_SEED}.` };
  }
  return { ok: true, seed: Number(digits) };
}

/**
 * Seed for the computer's rng on a given turn, derived from the board seed and the
 * number of moves played, so replaying a seed with the same moves replays the computer too.
 * @param {number} seed
 * @param {number} ply moves played so far
 * @returns {number} integer in [0, MAX_SEED]
 */
export function aiSeedFor(seed, ply) {
  return (Math.imul(ply + 1, 0x9e3779b9) ^ seed) >>> 0;
}

/**
 * Thinking delay for a uniform random number in [0, 1).
 * @param {number} u
 */
export function thinkDelay(u) {
  const x = typeof u === 'number' && u >= 0 && u < 1 ? u : 0.5;
  return THINK_MIN_MS + Math.floor(x * (THINK_MAX_MS - THINK_MIN_MS + 1));
}

/**
 * Game phase. Uses state.phase when the rules provide it; otherwise derives it.
 * 'pick-start': the second player chooses where the spark starts (any open cell).
 * @param {any} state
 * @returns {'pick-start' | 'play' | 'over'}
 */
export function phaseOf(state) {
  if (state.phase === 'over' || state.over) return 'over';
  if (state.phase === 'pick-start' || !state.spark) return 'pick-start';
  return 'play';
}

/** The player who picks the start and gets the head start (whoever doesn't move first). */
export function secondPlayer(state) {
  return /** @type {0|1} */ (1 - state.firstPlayer);
}

/**
 * Who may act now, by the rules rather than by trusting state.toMove alone:
 * - 'pick-start': only the real second player (the one who is not state.firstPlayer) may pick,
 *   and only if toMove agrees; a state where they disagree has been tampered with, so nobody acts.
 * - 'play': the player to move.  - 'over': nobody.
 * @param {any} state
 * @returns {0 | 1 | null}
 */
export function actorOf(state) {
  if (!state || typeof state !== 'object') return null;
  const phase = phaseOf(state);
  if (phase === 'over') return null;
  if (state.firstPlayer !== 0 && state.firstPlayer !== 1) return null;
  if (state.toMove !== 0 && state.toMove !== 1) return null;
  if (phase === 'pick-start') {
    const picker = secondPlayer(state);
    return state.toMove === picker ? picker : null;
  }
  return state.toMove;
}

/** May the person tap a cell to pick the start right now? */
export function humanMayPick(state) {
  return phaseOf(state) === 'pick-start' && state.firstPlayer !== HUMAN && actorOf(state) === HUMAN;
}

/**
 * May the person act (tap a cell) right now? False whenever the computer is thinking,
 * whatever the state says, so the board and the turn label can't disagree.
 * @param {any} state
 * @param {boolean} thinking
 */
export function humanCanAct(state, thinking) {
  if (thinking) return false;
  const actor = actorOf(state);
  if (actor !== HUMAN) return false;
  return phaseOf(state) !== 'pick-start' || humanMayPick(state);
}

/**
 * The turn label above the board. It is derived from the same inputs as the board
 * (humanCanAct), so it says "Your …" only when the board really accepts a tap.
 * @param {any} state
 * @param {boolean} thinking
 * @returns {{ who: 'human' | 'computer' | 'none', text: string }}
 */
export function turnView(state, thinking) {
  const phase = phaseOf(state);
  if (phase === 'over') return { who: 'none', text: '' };
  if (humanCanAct(state, thinking)) {
    return { who: 'human', text: phase === 'pick-start' ? 'Your pick: tap any cell' : 'Your turn' };
  }
  if (thinking || actorOf(state) === COMPUTER) {
    const text = phase === 'pick-start' ? 'Computer is picking the start…' : 'Computer is thinking…';
    return { who: 'computer', text: thinking ? text : "Computer's turn" };
  }
  return { who: 'none', text: '' }; // tampered state: nobody may act
}

/**
 * Short status line at the start of a game.
 * @param {any} state
 * @param {string} levelLabel e.g. "Normal"
 */
export function introText(state, levelLabel) {
  const head = formatPoints(KOMI);
  return secondPlayer(state) === HUMAN
    ? `New ${levelLabel} game. Tap any cell to start the spark there. It scores nothing, but you get ${head} points.`
    : `New ${levelLabel} game. The computer picks the start and gets ${head} points.`;
}

/** What to say when the person taps the board during a start pick that isn't theirs. */
export const NOT_YOUR_PICK = "Only the second player picks the start, and here that's the computer.";

/** Whole and half points, cleanly: 0 -> "0", 1.5 -> "1.5", 12.5 -> "12.5". */
export function formatPoints(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  const x = Math.round(n * 2) / 2;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

/** "row 3, column 4" (1-based for people). */
export function placeName(r, c) {
  return `row ${r + 1}, column ${c + 1}`;
}

export function playerName(player) {
  return player === HUMAN ? 'You' : 'Computer';
}

/**
 * Direction and distance of a history entry.
 * @param {{ from: { r: number, c: number }, to: { r: number, c: number } }} entry
 */
export function stepOf(entry) {
  const dr = entry.to.r - entry.from.r;
  const dc = entry.to.c - entry.from.c;
  const dist = Math.abs(dr) + Math.abs(dc);
  const dir = dr < 0 ? 'up' : dr > 0 ? 'down' : dc > 0 ? 'right' : 'left';
  return { dir, dist };
}

/**
 * One short sentence describing a move, e.g. "Computer moved left 2 and scored 4 points.""
 * @param {{ player: 0|1, from: {r:number,c:number}, to: {r:number,c:number}, value: number }} entry
 */
export function describeMove(entry) {
  const who = playerName(entry.player);
  if (!entry.from) return `${who} started the spark at ${placeName(entry.to.r, entry.to.c)}.`;
  const { dir, dist } = stepOf(entry);
  const pts = entry.value === 1 ? '1 point' : `${entry.value} points`;
  return `${who} moved ${dir} ${dist} and scored ${pts}.`;
}

/**
 * How a cell should look and be announced.
 * Accessible names start with the cell's visible number ("3 points, row 1, column 2, …"),
 * so the visible text is part of the name in the same order (WCAG 2.5.3) and a screen
 * reader user hears the value first, like a sighted player sees it. No parentheses.
 * Spark (◆) and burned (×) cells show a symbol, not a number; their names say what the
 * symbol means instead of reading the glyph out.
 * @param {import('./rules.js').GameState} state
 * @param {number} r
 * @param {number} c
 * @param {{ targets: Set<number>, humanToMove: boolean }} ctx  targets are r*SIZE+c of legal landings
 * @returns {{ kind: 'spark'|'burned'|'target'|'coal', text: string, label: string, lastFrom: boolean }}
 */
export function cellView(state, r, c, ctx) {
  const i = r * SIZE + c;
  const where = placeName(r, c);
  const v = state.values[i];
  const pts = v === 1 ? '1 point' : `${v} points`;
  if (phaseOf(state) === 'pick-start') {
    if (ctx.humanToMove && ctx.targets.has(i)) {
      return { kind: 'target', text: String(v), label: `${pts}, ${where}, start the spark here, not scored`, lastFrom: false };
    }
    return { kind: 'coal', text: String(v), label: `${pts}, ${where}`, lastFrom: false };
  }
  const last = state.history.length ? state.history[state.history.length - 1] : null;
  const lastFrom = !!last && !!last.from && last.from.r === r && last.from.c === c;
  const lastNote = lastFrom ? ', last move started here' : '';
  if (state.spark && state.spark.r === r && state.spark.c === c) {
    const mover = last && last.player === HUMAN ? 'you' : 'the computer';
    const by = !last ? '' : last.from ? `, ${mover} moved it here` : `, ${mover} picked this start`;
    return { kind: 'spark', text: '\u25C6', label: `Spark, ${where}${by}`, lastFrom: false };
  }
  if (state.burned[i]) {
    return { kind: 'burned', text: '\u00D7', label: `Burned out, ${where}${lastNote}`, lastFrom };
  }
  if (ctx.humanToMove && ctx.targets.has(i)) {
    return { kind: 'target', text: String(v), label: `${pts}, ${where}, move here${lastNote}`, lastFrom };
  }
  return { kind: 'coal', text: String(v), label: `${pts}, ${where}${lastNote}`, lastFrom };
}

/**
 * End-of-game summary from the person's point of view, or null if the game is still on.
 * Scores include the second player's head start (KOMI), so a draw can't happen;
 * 'draw' is still handled in case the rules ever allow one.
 * @param {import('./rules.js').GameState} state
 */
export function outcome(state) {
  const res = result(state);
  if (!res) return null;
  const kind = res.draw ? 'draw' : res.winner === HUMAN ? 'win' : 'lose';
  const title = kind === 'win' ? 'You win!' : kind === 'lose' ? 'The computer wins' : "It's a draw";
  const you = formatPoints(res.scores[HUMAN]);
  const cpu = formatPoints(res.scores[COMPUTER]);
  return {
    kind,
    title,
    scoreLine: `Final score: you ${you}, computer ${cpu}.`,
    headStartLine: headStartText(state),
    scores: res.scores,
  };
}

/** e.g. "The computer picked the start and began with 1.5 points." */
export function headStartText(state) {
  const sp = secondPlayer(state);
  const who = sp === HUMAN ? 'You' : 'The computer';
  return `${who} picked the start and began with ${formatPoints(KOMI)} points.`;
}


/**
 * Where to put keyboard focus after the board is redrawn.
 * Only intervene when focus is stuck on a board cell that is no longer playable,
 * or was lost to <body> after a cell that had focus stopped being tabbable.
 * Never steal focus from settings, the seed field, New game, etc., and never on a
 * fresh page load (focus on body with no prior board focus).
 *
 * @param {{
 *   focusOnBoard: boolean,
 *   focusOnPlayable: boolean,
 *   focusOnBody: boolean,
 *   boardHadFocus: boolean,
 *   hasPlayable: boolean,
 *   gameOver: boolean,
 *   hasResultHeading?: boolean,
 * }} s
 * @returns {'first-playable' | 'result' | 'new-game' | null}
 */
export function nextFocusTarget(s) {
  if (!s || typeof s !== 'object') return null;
  const stuckOnDeadCell = s.focusOnBoard && !s.focusOnPlayable;
  const lostToBody = s.focusOnBody && s.boardHadFocus;
  if (!stuckOnDeadCell && !lostToBody) return null;
  if (s.hasPlayable) return 'first-playable';
  if (s.gameOver) return s.hasResultHeading === false ? 'new-game' : 'result';
  return null; // computer thinking / locked board: leave focus alone
}

export { KOMI, MAX_SEED, SIZE };
