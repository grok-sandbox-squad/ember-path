// Ember Path computer opponent (D3, D9). Pure: reads a frozen GameState, returns an action.
// Randomness only ever comes from the rng you pass in, so play is reproducible.
import { SIZE, MAX_STEP, assertState, legalMoves } from './rules.js';

/** Supported difficulty names. */
export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);
/** Display names. The middle level is "Normal" (never "Medium"). */
export const DIFFICULTY_LABELS = Object.freeze({ easy: 'Easy', normal: 'Normal', hard: 'Hard' });

/**
 * Hard's search budgets, in nodes. A node budget (not a clock) keeps Hard deterministic on
 * every device (see tests/ai.test.js and the PR notes for timings).
 * HARD_NODE_BUDGET is per spark move. HARD_PICK_NODE_BUDGET is the total for the start pick,
 * split evenly over the 36 cells (16,000 each); the D9 balance numbers depend on it.
 */
export const HARD_NODE_BUDGET = 60000;
export const HARD_PICK_NODE_BUDGET = 36 * 16000;

/**
 * Pick the computer's action: a start pick in 'pick-start', a spark move in 'play'.
 * @param {import('./rules.js').GameState} state
 * @param {'easy' | 'normal' | 'hard'} difficulty case-insensitive, so 'Normal' works too
 * @param {() => number} rng returns floats in [0, 1), e.g. createRng(seed) from rules.js
 * @param {{ maxNodes?: number, maxTimeMs?: number, now?: () => number }} [opts]
 *   Hard only. maxNodes overrides HARD_NODE_BUDGET (moves) or HARD_PICK_NODE_BUDGET (start pick, total). maxTimeMs adds an
 *   optional wall-clock cap (off by default because it makes results depend on device speed).
 * @returns {import('./rules.js').Action | null} one of legalMoves(state), or null if the game is over.
 *   Pass it to step(state, action) (or pickStart / applyMove for the matching phase).
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
  const budget = readOpts(opts, state.phase === 'pick-start' ? HARD_PICK_NODE_BUDGET : HARD_NODE_BUDGET);
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

  if (state.phase === 'pick-start') {
    if (level === 'easy') return easyPick(state, moves, pick);
    if (level === 'normal') return normalPick(state, moves);
    return hardPick(state, moves, budget);
  }
  if (level === 'easy') return chooseEasy(moves, pick, draw);
  if (level === 'normal') return chooseNormal(state, moves, pick);
  return hardMove(state, moves, budget);
}

function readOpts(opts, defaultNodes) {
  const out = { maxNodes: defaultNodes, deadline: Infinity, now: null };
  if (opts === undefined) return out;
  if (opts === null || typeof opts !== 'object') throw new TypeError('opts must be an object if given');
  if (opts.maxNodes !== undefined) {
    if (!Number.isInteger(opts.maxNodes) || opts.maxNodes < 1) {
      throw new RangeError('opts.maxNodes must be a positive integer');
    }
    out.maxNodes = opts.maxNodes;
  }
  if (opts.maxTimeMs !== undefined) {
    if (typeof opts.maxTimeMs !== 'number' || !(opts.maxTimeMs > 0)) {
      throw new RangeError('opts.maxTimeMs must be a positive number');
    }
    out.now = typeof opts.now === 'function' ? opts.now : () => performance.now();
    out.deadline = out.now() + opts.maxTimeMs;
  }
  return out;
}

// Easy: random legal move, but about half the time it takes one of the highest-value moves.
function chooseEasy(moves, pick, draw) {
  if (draw() < 0.5) {
    const best = Math.max(...moves.map((m) => m.value));
    return pick(moves.filter((m) => m.value === best));
  }
  return pick(moves);
}

// Normal: greedy. Highest immediate gain; ties: smallest best reply for the opponent,
// then fewest opponent replies, then rng.
function chooseNormal(state, moves, pick) {
  const b = toBoard(state);
  let bestKey = null;
  let best = [];
  for (const m of moves) {
    const to = m.r * SIZE + m.c;
    b[to] = 0;
    const replies = gen(b, to);
    let oppBest = 0;
    for (const x of replies) if (b[x] > oppBest) oppBest = b[x];
    b[to] = m.value;
    const key = [m.value, -oppBest, -replies.length];
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

// Cheap start-pick score: lower is better for the picker. The first player's best immediate
// move from that cell, then how many moves they have, then the total they could reach.
function pickKey(b, cell) {
  const saved = b[cell];
  b[cell] = 0;
  const ms = gen(b, cell);
  let best = 0;
  let sum = 0;
  for (const x of ms) {
    if (b[x] > best) best = b[x];
    sum += b[x];
  }
  b[cell] = saved;
  return [best, ms.length, sum];
}

function rankPicks(state, picks) {
  const b = toBoard(state);
  const scored = picks.map((p, i) => ({ p, key: pickKey(b, p.r * SIZE + p.c), i }));
  // ascending key, then row-major order: fully deterministic
  scored.sort((x, y) => compareKeys(x.key, y.key) || x.i - y.i);
  return scored.map((x) => x.p);
}

// Normal start pick: the best cell by the cheap score (deterministic, no rng).
function normalPick(state, picks) {
  return rankPicks(state, picks)[0];
}

// Easy start pick: uniformly random among the better half of cells by the cheap score.
function easyPick(state, picks, pick) {
  const ranked = rankPicks(state, picks);
  return pick(ranked.slice(0, Math.ceil(ranked.length / 2)));
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Hard: negamax alpha-beta on score difference with iterative deepening and a node budget.
// Komi is a constant offset, so it does not change which move maximises the score difference.
const OUT_OF_BUDGET = Symbol('out of budget');

function hardMove(state, moves, budget) {
  if (moves.length === 1) return moves[0];
  const b = toBoard(state);
  const pos = state.spark.r * SIZE + state.spark.c;
  return searchFrom(b, pos, moves, budget).move;
}

// Start pick: search every cell independently with an equal share of the budget, and take
// the cell where the first player's best (minimax) score difference is lowest. Ties go to the
// earlier cell in row-major order. The first player always has at least 3 moves after a pick.
function hardPick(state, picks, budget) {
  const per = Math.max(1, Math.floor(budget.maxNodes / picks.length));
  let best = picks[0];
  let bestValue = Infinity;
  for (const p of picks) {
    const b = toBoard(state);
    const cell = p.r * SIZE + p.c;
    b[cell] = 0;
    const moves = gen(b, cell).map((to) => ({ r: (to / SIZE) | 0, c: to % SIZE, value: b[to] }));
    const { score } = searchFrom(b, cell, moves, { ...budget, maxNodes: per });
    if (score < bestValue) {
      bestValue = score;
      best = p;
    }
  }
  return best;
}

/**
 * Iterative-deepening alpha-beta from `pos` (side to move) over root `moves` ({ r, c, value }).
 * Returns the chosen move and its score (side to move's future score difference; exact when
 * the search reached the end of the game, otherwise depth-limited with a 0 leaf estimate).
 */
function searchFrom(b, pos, moves, { maxNodes, deadline, now }) {
  let nodes = 0;
  let hitDepthLimit = false;

  function negamax(p, depth, alpha, beta) {
    if (++nodes > maxNodes) throw OUT_OF_BUDGET;
    if (now !== null && (nodes & 1023) === 0 && now() > deadline) throw OUT_OF_BUDGET;
    const ms = gen(b, p);
    if (ms.length === 0) return 0; // no end bonus (D9)
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
  let order = moves.slice().sort((x, y) => y.value - x.value);
  let bestMove = order[0];
  let bestScore = 0;
  let empties = 0;
  for (let i = 0; i < b.length; i++) if (b[i] > 0) empties++;
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
      // which is searched first, at this depth. (A cut-off skips inner restores, so the
      // board is not reused after this.)
      if (iterBest !== null && iterBest !== order[0]) {
        bestMove = iterBest;
        bestScore = iterScore;
      }
      break;
    }
    bestMove = iterBest;
    bestScore = iterScore;
    // Next iteration: previous best first, then the rest by this iteration's score.
    scored.sort((x, y) => y[1] - x[1]);
    order = scored.map((x) => x[0]);
    if (!hitDepthLimit) break; // searched to the end of the game: exact
  }
  return { move: bestMove, score: bestScore };
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
