// Ember Path rules engine. Pure functions over deeply frozen state objects.
// No DOM, no I/O, no Math.random: everything is derived from the seed and the moves.

/** Board side length (D2). */
export const SIZE = 6;
/** Fixed start cell, 0-based (D2: "row 2, col 2 (0-based)"). */
export const START = Object.freeze({ r: 2, c: 2 });
/** Lowest and highest coal value. */
export const MIN_VALUE = 1;
export const MAX_VALUE = 5;
/**
 * A move goes 1 to MAX_STEP cells in a straight orthogonal line. Every cell on the
 * path must be clear: for a 2- or 3-step move the cells passed over AND the landing
 * cell must all be unburned and on the board.
 */
export const MAX_STEP = 3;
/** "Last spark" bonus for whoever made the final move. */
export const LAST_MOVE_BONUS = 3;
/** Largest accepted seed (seeds are unsigned 32-bit integers). */
export const MAX_SEED = 0xffffffff;

/** Directions in the order legalMoves lists them. */
export const DIRECTIONS = Object.freeze([
  Object.freeze({ name: 'up', dr: -1, dc: 0 }),
  Object.freeze({ name: 'right', dr: 0, dc: 1 }),
  Object.freeze({ name: 'down', dr: 1, dc: 0 }),
  Object.freeze({ name: 'left', dr: 0, dc: -1 }),
]);

/** Thrown when a well-formed move is not legal in the given state (including after game over). */
export class IllegalMoveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

/**
 * Throw unless `seed` is an integer in [0, MAX_SEED].
 * @param {unknown} seed
 * @returns {number}
 */
export function validateSeed(seed) {
  if (typeof seed !== 'number') {
    throw new TypeError(`seed must be a number, got ${typeof seed}`);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`seed must be an integer from 0 to ${MAX_SEED}, got ${seed}`);
  }
  return seed;
}

/**
 * mulberry32 PRNG. Returns a function producing floats in [0, 1).
 * @param {number} seed integer in [0, MAX_SEED]
 * @returns {() => number}
 */
export function createRng(seed) {
  let a = validateSeed(seed) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Board values for a seed: SIZE*SIZE integers 1-5, row-major.
 * @param {number} seed
 * @returns {ReadonlyArray<number>}
 */
export function generateBoard(seed) {
  const rng = createRng(seed);
  const values = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    values.push(MIN_VALUE + Math.floor(rng() * (MAX_VALUE - MIN_VALUE + 1)));
  }
  return Object.freeze(values);
}

/** @param {number} r @param {number} c */
export function indexOf(r, c) {
  return r * SIZE + c;
}

/** @param {number} r @param {number} c */
export function onBoard(r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

/**
 * @typedef {0 | 1} Player
 * @typedef {{ r: number, c: number }} Cell
 * @typedef {{ r: number, c: number, dir: 'up'|'right'|'down'|'left', dist: 1|2|3, value: number }} Move
 * @typedef {{ player: Player, from: Cell, to: Cell, value: number }} HistoryEntry
 * @typedef {{
 *   seed: number,
 *   size: number,
 *   values: ReadonlyArray<number>,
 *   burned: ReadonlyArray<boolean>,
 *   spark: Cell,
 *   firstPlayer: Player,
 *   toMove: Player,
 *   scores: ReadonlyArray<number>,
 *   history: ReadonlyArray<HistoryEntry>,
 *   over: boolean,
 *   bonus: null | { player: Player, points: number },
 * }} GameState
 * @typedef {{ over: true, scores: ReadonlyArray<number>, winner: Player | null, draw: boolean }} GameResult
 */

/**
 * Start a new game.
 * @param {number} seed integer in [0, 4294967295]
 * @param {{ firstPlayer?: 0 | 1 }} [opts] player 0 and 1 are labels; the UI decides which is human.
 * @returns {GameState}
 */
export function createGame(seed, opts) {
  validateSeed(seed);
  let firstPlayer = 0;
  if (opts !== undefined) {
    if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
      throw new TypeError('opts must be an object if given');
    }
    if (opts.firstPlayer !== undefined) {
      if (opts.firstPlayer !== 0 && opts.firstPlayer !== 1) {
        throw new RangeError(`opts.firstPlayer must be 0 or 1, got ${String(opts.firstPlayer)}`);
      }
      firstPlayer = opts.firstPlayer;
    }
  }
  const values = generateBoard(seed);
  const burned = new Array(SIZE * SIZE).fill(false);
  burned[indexOf(START.r, START.c)] = true;
  return freezeState({
    seed,
    size: SIZE,
    values,
    burned,
    spark: { r: START.r, c: START.c },
    firstPlayer,
    toMove: firstPlayer,
    scores: [0, 0],
    history: [],
    over: false,
    bonus: null,
  });
}

/**
 * Throw TypeError unless `state` looks like a GameState this module produced
 * (it may have been copied or JSON round-tripped).
 * @param {unknown} state
 * @returns {GameState}
 */
export function assertState(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('state must be a game state object');
  }
  const s = /** @type {any} */ (state);
  const n = SIZE * SIZE;
  const bad = (why) => {
    throw new TypeError(`invalid game state: ${why}`);
  };
  if (s.size !== SIZE) bad('size');
  if (!Array.isArray(s.values) || s.values.length !== n) bad('values');
  for (const v of s.values) if (!Number.isInteger(v) || v < MIN_VALUE || v > MAX_VALUE) bad('values');
  if (!Array.isArray(s.burned) || s.burned.length !== n) bad('burned');
  for (const b of s.burned) if (typeof b !== 'boolean') bad('burned');
  if (!s.spark || !onBoard(s.spark.r, s.spark.c)) bad('spark');
  if (!s.burned[indexOf(s.spark.r, s.spark.c)]) bad('spark cell must be burned');
  if (s.toMove !== 0 && s.toMove !== 1) bad('toMove');
  if (!Array.isArray(s.scores) || s.scores.length !== 2) bad('scores');
  for (const x of s.scores) if (!Number.isInteger(x) || x < 0) bad('scores');
  if (typeof s.over !== 'boolean') bad('over');
  if (!Array.isArray(s.history)) bad('history');
  return s;
}

function movesFrom(values, burned, r0, c0) {
  const moves = [];
  for (const d of DIRECTIONS) {
    for (let dist = 1; dist <= MAX_STEP; dist++) {
      const r = r0 + d.dr * dist;
      const c = c0 + d.dc * dist;
      if (!onBoard(r, c)) break;
      const i = indexOf(r, c);
      if (burned[i]) break; // cannot land on or pass through a burned cell
      moves.push(Object.freeze({ r, c, dir: d.name, dist, value: values[i] }));
    }
  }
  return moves;
}

/**
 * All legal moves for the player to move. Empty when the game is over.
 * A move is legal when it goes 1-3 cells straight up, down, left or right, stays on
 * the board, and every cell along the path (passed-over cells and the landing cell)
 * is unburned. Diagonal moves do not exist.
 * Order: up, right, down, left; within a direction, distance 1, 2, 3.
 * @param {GameState} state
 * @returns {ReadonlyArray<Move>}
 */
export function legalMoves(state) {
  assertState(state);
  if (state.over) return Object.freeze([]);
  return Object.freeze(movesFrom(state.values, state.burned, state.spark.r, state.spark.c));
}

/**
 * Is `move` legal? Never throws: a malformed state or move just returns false.
 * @param {unknown} state
 * @param {unknown} move
 * @returns {boolean}
 */
export function isLegalMove(state, move) {
  try {
    assertState(state);
  } catch {
    return false;
  }
  if (!move || typeof move !== 'object') return false;
  const m = /** @type {any} */ (move);
  if (!onBoard(m.r, m.c)) return false;
  return legalMoves(state).some((x) => x.r === m.r && x.c === m.c);
}

/**
 * Play a move and return the new state. The input state is never modified.
 * Only `move.r` and `move.c` (the landing cell) are read; other fields are ignored.
 * @param {GameState} state
 * @param {{ r: number, c: number }} move
 * @returns {GameState}
 * @throws {TypeError} malformed state or move
 * @throws {RangeError} landing cell off the board
 * @throws {IllegalMoveError} game over, or the cell is not reachable this turn
 */
export function applyMove(state, move) {
  assertState(state);
  if (move === null || typeof move !== 'object') {
    throw new TypeError('move must be an object like { r, c }');
  }
  const { r, c } = /** @type {any} */ (move);
  if (typeof r !== 'number' || typeof c !== 'number') {
    throw new TypeError('move.r and move.c must be numbers');
  }
  if (!Number.isInteger(r) || !Number.isInteger(c)) {
    throw new TypeError('move.r and move.c must be integers');
  }
  if (!onBoard(r, c)) {
    throw new RangeError(`move (${r}, ${c}) is off the ${SIZE}x${SIZE} board`);
  }
  if (state.over) {
    throw new IllegalMoveError('the game is over');
  }
  const legal = movesFrom(state.values, state.burned, state.spark.r, state.spark.c).find(
    (x) => x.r === r && x.c === c,
  );
  if (!legal) {
    throw new IllegalMoveError(
      `(${r}, ${c}) is not reachable from (${state.spark.r}, ${state.spark.c}): ` +
        `moves go 1-${MAX_STEP} cells straight up, down, left or right, never through or onto a burned cell`,
    );
  }
  const player = state.toMove;
  const burned = state.burned.slice();
  burned[indexOf(r, c)] = true;
  const scores = state.scores.slice();
  scores[player] += legal.value;
  const history = state.history.slice();
  history.push({ player, from: { r: state.spark.r, c: state.spark.c }, to: { r, c }, value: legal.value });
  const next = /** @type {Player} */ (1 - player);
  const over = movesFrom(state.values, burned, r, c).length === 0;
  let bonus = null;
  if (over) {
    scores[player] += LAST_MOVE_BONUS;
    bonus = { player, points: LAST_MOVE_BONUS };
  }
  return freezeState({
    seed: state.seed,
    size: SIZE,
    values: state.values,
    burned,
    spark: { r, c },
    firstPlayer: state.firstPlayer,
    toMove: next,
    scores,
    history,
    over,
    bonus,
  });
}

/**
 * True when the player to move has no legal move.
 * @param {GameState} state
 */
export function isOver(state) {
  assertState(state);
  return state.over;
}

/**
 * Final result, or null while the game is still running.
 * @param {GameState} state
 * @returns {GameResult | null}
 */
export function result(state) {
  assertState(state);
  if (!state.over) return null;
  const [a, b] = state.scores;
  const winner = a === b ? null : a > b ? 0 : 1;
  return Object.freeze({ over: true, scores: state.scores, winner, draw: winner === null });
}

/**
 * Rebuild a game from its seed and the landing cells played (for "replay seed" and undo).
 * @param {number} seed
 * @param {ReadonlyArray<{ r: number, c: number }>} moves
 * @param {{ firstPlayer?: 0 | 1 }} [opts]
 * @returns {GameState}
 */
export function replay(seed, moves, opts) {
  if (!Array.isArray(moves)) throw new TypeError('moves must be an array');
  let s = createGame(seed, opts);
  for (const m of moves) s = applyMove(s, m);
  return s;
}

function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const k of Object.keys(x)) deepFreeze(x[k]);
  }
  return x;
}

function freezeState(s) {
  return deepFreeze(s);
}
