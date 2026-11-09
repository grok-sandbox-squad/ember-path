// Ember Path computer opponent (D3). Pure: reads a frozen GameState, returns a move.
// Randomness only ever comes from the rng you pass in, so play is reproducible.
import { SIZE, MAX_STEP, LAST_MOVE_BONUS, assertState, legalMoves } from './rules.js';

/** Supported difficulty names. */
export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);
/** Display names. The middle level is "Normal" (never "Medium"). */
export const DIFFICULTY_LABELS = Object.freeze({ easy: 'Easy', normal: 'Normal', hard: 'Hard' });

/**
 * Default Hard search budget in nodes. A node budget (not a clock) keeps Hard
 * deterministic on every device; it was sized so the slowest early position
 * takes well under 300 ms on Node 20 (see tests/ai.test.js and the PR notes).
 */
export const HARD_NODE_BUDGET = 60000;

/**
 * Pick the computer's move.
 * @param {import('./rules.js').GameState} state
 * @param {'easy' | 'normal' | 'hard'} difficulty case-insensitive, so 'Normal' works too
 * @param {() => number} rng returns floats in [0, 1), e.g. createRng(seed) from rules.js
 * @param {{ maxNodes?: number, maxTimeMs?: number, now?: () => number }} [opts]
 *   Hard only. maxNodes overrides HARD_NODE_BUDGET. maxTimeMs adds an optional wall-clock
 *   cap (off by default because it makes results depend on device speed).
 * @returns {import('./rules.js').Move | null} one of legalMoves(state), or null if the game is over
 * @throws {TypeError} bad state, non-string difficulty, rng not a function
 * @throws {RangeError} unknown difficulty, rng output outside [0, 1), bad opts
 */
export function chooseMove(state, difficulty, rng, opts) {
  assertState(state);
  if (typeof difficulty !== 'string') {
    throw new TypeError(`difficulty must be a string, got ${typeof difficulty}`);
  }
  const level = difficulty.toLowerCase();
  if (!DIFFICULTIES.includes(level)) {
    throw new RangeError(`unknown difficulty "${difficulty}"; use Easy, Normal or Hard`);
  }
  if (typeof rng !== 'function') {
    throw new TypeError('rng must be a function returning numbers in [0, 1)');
  }
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  const draw = () => {
    const x = rng();
    if (typeof x !== 'number' || !(x >= 0 && x < 1)) {
      throw new RangeError(`rng must return a number in [0, 1), got ${String(x)}`);
    }
    return x;
  };
  const pick = (list) => list[Math.floor(draw() * list.length)];

  if (level === 'easy') return chooseEasy(moves, pick, draw);
  if (level === 'normal') return chooseNormal(state, moves, pick);
  return chooseHard(state, moves, opts);
}

// Easy: random legal move, but about half the time it takes one of the highest-value moves.
function chooseEasy(moves, pick, draw) {
  if (draw() < 0.5) {
    const best = Math.max(...moves.map((m) => m.value));
    return pick(moves.filter((m) => m.value === best));
  }
  return pick(moves);
}

// Normal: greedy. Highest immediate gain (landing value, +3 if the move ends the game).
// Ties: smallest best reply for the opponent, then fewest opponent replies, then rng.
function chooseNormal(state, moves, pick) {
  const b = toBoard(state);
  let bestKey = null;
  let best = [];
  for (const m of moves) {
    const to = m.r * SIZE + m.c;
    b[to] = 0;
    const replies = gen(b, to);
    let oppBest = 0;
    for (const x of replies) {
      const v = b[x];
      b[x] = 0;
      const g = v + (gen(b, x).length === 0 ? LAST_MOVE_BONUS : 0);
      b[x] = v;
      if (g > oppBest) oppBest = g;
    }
    b[to] = m.value;
    const key = [m.value + (replies.length === 0 ? LAST_MOVE_BONUS : 0), -oppBest, -replies.length];
    const cmp = bestKey === null ? 1 : compareKeys(key, bestKey);
    if (cmp > 0) {
      bestKey = key;
      best = [m];
    } else if (cmp === 0) {
      best.push(m);
    }
  }
  return pick(best);
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Hard: negamax alpha-beta on score difference with iterative deepening and a node budget.
const OUT_OF_BUDGET = Symbol('out of budget');

function chooseHard(state, moves, opts) {
  let maxNodes = HARD_NODE_BUDGET;
  let deadline = Infinity;
  let now = null;
  if (opts !== undefined) {
    if (opts === null || typeof opts !== 'object') throw new TypeError('opts must be an object if given');
    if (opts.maxNodes !== undefined) {
      if (!Number.isInteger(opts.maxNodes) || opts.maxNodes < 1) {
        throw new RangeError('opts.maxNodes must be a positive integer');
      }
      maxNodes = opts.maxNodes;
    }
    if (opts.maxTimeMs !== undefined) {
      if (typeof opts.maxTimeMs !== 'number' || !(opts.maxTimeMs > 0)) {
        throw new RangeError('opts.maxTimeMs must be a positive number');
      }
      now = typeof opts.now === 'function' ? opts.now : () => performance.now();
      deadline = now() + opts.maxTimeMs;
    }
  }
  if (moves.length === 1) return moves[0];

  const b = toBoard(state);
  let nodes = 0;
  let hitDepthLimit = false;

  function negamax(pos, depth, alpha, beta) {
    if (++nodes > maxNodes) throw OUT_OF_BUDGET;
    if (now !== null && (nodes & 1023) === 0 && now() > deadline) throw OUT_OF_BUDGET;
    const ms = gen(b, pos);
    if (ms.length === 0) return -LAST_MOVE_BONUS; // opponent made the last move
    if (depth === 0) {
      hitDepthLimit = true;
      return 0;
    }
    ms.sort((x, y) => b[y] - b[x]);
    let best = -Infinity;
    for (const to of ms) {
      const v = b[to];
      b[to] = 0;
      // score = v - child, so alpha < score < beta  <=>  v - beta < child < v - alpha
      const score = v - negamax(to, depth - 1, v - beta, v - alpha);
      b[to] = v;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Root order: highest value first; stable on legalMoves order for ties.
  let order = moves.map((m) => m).sort((x, y) => y.value - x.value);
  let bestMove = order[0];
  const empties = b.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
  for (let depth = 1; depth <= empties; depth++) {
    hitDepthLimit = false;
    let iterBest = null;
    let iterScore = -Infinity;
    const scored = [];
    try {
      let alpha = -Infinity;
      for (const m of order) {
        const to = m.r * SIZE + m.c;
        b[to] = 0;
        let score;
        try {
          score = m.value - negamax(to, depth - 1, -Infinity, m.value - alpha);
        } finally {
          b[to] = m.value;
        }
        scored.push([m, score]);
        if (score > iterScore) {
          iterScore = score;
          iterBest = m;
        }
        if (score > alpha) alpha = score;
      }
    } catch (e) {
      if (e !== OUT_OF_BUDGET) throw e;
      // Partial iteration: trust it only if it already beat the previous best move,
      // which is searched first, at this depth.
      if (iterBest !== null && iterBest !== order[0] && iterScore > -Infinity) bestMove = iterBest;
      break;
    }
    bestMove = iterBest;
    // Next iteration: previous best first, then the rest by this iteration's score.
    scored.sort((x, y) => y[1] - x[1]);
    order = scored.map((x) => x[0]);
    if (!hitDepthLimit) break; // searched to the end of the game: exact
  }
  return bestMove;
}

// Internal board: cell value, or 0 if burned.
function toBoard(state) {
  const b = new Int8Array(SIZE * SIZE);
  for (let i = 0; i < b.length; i++) b[i] = state.burned[i] ? 0 : state.values[i];
  return b;
}

const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

function gen(b, pos) {
  const r0 = (pos / SIZE) | 0;
  const c0 = pos % SIZE;
  const out = [];
  for (let d = 0; d < 4; d++) {
    for (let k = 1; k <= MAX_STEP; k++) {
      const r = r0 + DR[d] * k;
      const c = c0 + DC[d] * k;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) break;
      const i = r * SIZE + c;
      if (b[i] === 0) break;
      out.push(i);
    }
  }
  return out;
}
