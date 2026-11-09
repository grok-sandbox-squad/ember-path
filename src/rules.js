// Ember Path rules engine (D1, D2, D8, D9). Pure functions over deeply frozen state objects.
// No DOM, no I/O, no Math.random: everything is derived from the seed and the actions played.

/** Board side length (D2). */
export const SIZE = 6;
/** Lowest and highest coal value. */
export const MIN_VALUE = 1;
export const MAX_VALUE = 5;
/**
 * A move goes 1 to MAX_STEP cells in a straight orthogonal line. Every cell on the
 * path must be clear: for a 2- or 3-step move the cells passed over AND the landing
 * cell must all be unburned and on the board (D8).
 */
export const MAX_STEP = 3;
/** Points the second player starts with (D9). Half a point, so a game can never be drawn. */
export const KOMI = 1.5;
/** Largest accepted seed (seeds are unsigned 32-bit integers). */
export const MAX_SEED = 0xffffffff;

/** Game phases, in order. */
export const PHASES = Object.freeze(['pick-start', 'play', 'over']);

/** Directions in the order legalMoves lists them. */
export const DIRECTIONS = Object.freeze([
  Object.freeze({ name: 'up', dr: -1, dc: 0 }),
  Object.freeze({ name: 'right', dr: 0, dc: 1 }),
  Object.freeze({ name: 'down', dr: 1, dc: 0 }),
  Object.freeze({ name: 'left', dr: 0, dc: -1 }),
]);

/** Thrown when a well-formed action is not allowed in the given state (wrong phase, unreachable cell, game over). */
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

/** @param {unknown} r @param {unknown} c */
export function onBoard(r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

/**
 * @typedef {0 | 1} Player
 * @typedef {'pick-start' | 'play' | 'over'} Phase
 * @typedef {{ r: number, c: number }} Cell
 * @typedef {{ type: 'pick', r: number, c: number, dir: null, dist: 0, value: 0 }} PickAction
 *   A start pick: the cell becomes the spark, burns, and scores nothing.
 * @typedef {{ type: 'move', r: number, c: number, dir: 'up'|'right'|'down'|'left', dist: 1|2|3, value: number }} MoveAction
 *   A spark move; `value` is what it scores.
 * @typedef {PickAction | MoveAction} Action
 * @typedef {{ type: 'pick' | 'move', player: Player, from: Cell | null, to: Cell, value: number }} HistoryEntry
 * @typedef {{
 *   seed: number,
 *   size: number,
 *   values: ReadonlyArray<number>,
 *   burned: ReadonlyArray<boolean>,
 *   spark: Cell | null,
 *   phase: Phase,
 *   over: boolean,
 *   firstPlayer: Player,
 *   toMove: Player,
 *   scores: ReadonlyArray<number>,
 *   history: ReadonlyArray<HistoryEntry>,
 * }} GameState
 *   `spark` is null only in 'pick-start'. `over` mirrors phase === 'over'.
 *   In 'pick-start', `toMove` is the second player (the one who picks).
 *   In 'over', `toMove` is the player left without a move.
 * @typedef {{ over: true, scores: ReadonlyArray<number>, winner: Player, draw: false }} GameResult
 */

/**
 * Start a new game in the 'pick-start' phase: nothing is burned, the second player
 * (the one who does not make the first spark move) picks the start cell, and starts with KOMI points.
 * @param {number} seed integer in [0, 4294967295]
 * @param {{ firstPlayer?: 0 | 1 }} [opts] the player who makes the first spark move (default 0).
 *   Players 0 and 1 are labels; the UI decides which is human.
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
  const second = 1 - firstPlayer;
  const scores = [0, 0];
  scores[second] = KOMI;
  return freezeState({
    seed,
    size: SIZE,
    values: generateBoard(seed),
    burned: new Array(SIZE * SIZE).fill(false),
    spark: null,
    phase: 'pick-start',
    over: false,
    firstPlayer,
    toMove: second,
    scores,
    history: [],
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
  if (!PHASES.includes(s.phase)) bad('phase');
  if (s.over !== (s.phase === 'over')) bad('over must match phase');
  if (s.phase === 'pick-start') {
    if (s.spark !== null) bad('spark must be null before the start pick');
    if (s.burned.some(Boolean)) bad('nothing is burned before the start pick');
  } else {
    if (!s.spark || !onBoard(s.spark.r, s.spark.c)) bad('spark');
    if (!s.burned[indexOf(s.spark.r, s.spark.c)]) bad('spark cell must be burned');
  }
  if (s.firstPlayer !== 0 && s.firstPlayer !== 1) bad('firstPlayer');
  if (s.toMove !== 0 && s.toMove !== 1) bad('toMove');
  if (!Array.isArray(s.scores) || s.scores.length !== 2) bad('scores');
  for (const x of s.scores) if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) bad('scores');
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
      moves.push(Object.freeze({ type: 'move', r, c, dir: d.name, dist, value: values[i] }));
    }
  }
  return moves;
}

function allPicks() {
  const picks = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) picks.push(Object.freeze({ type: 'pick', r, c, dir: null, dist: 0, value: 0 }));
  }
  return picks;
}

/**
 * Everything the player to move may do now.
 * - 'pick-start': all 36 cells as PickActions (row-major).
 * - 'play': MoveActions that go 1-3 cells straight up, down, left or right, stay on the
 *   board, and have every cell along the path (passed-over cells and the landing cell)
 *   unburned. Order: up, right, down, left; within a direction, distance 1, 2, 3.
 * - 'over': empty.
 * @param {GameState} state
 * @returns {ReadonlyArray<Action>}
 */
export function legalMoves(state) {
  assertState(state);
  if (state.phase === 'over') return Object.freeze([]);
  if (state.phase === 'pick-start') return Object.freeze(allPicks());
  return Object.freeze(movesFrom(state.values, state.burned, state.spark.r, state.spark.c));
}

/**
 * Is this cell a legal action right now (a pick in 'pick-start', a move in 'play')?
 * Never throws: a malformed state or move just returns false.
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

function readCell(move, what) {
  if (move === null || typeof move !== 'object') {
    throw new TypeError(`${what} must be an object like { r, c }`);
  }
  const { r, c } = /** @type {any} */ (move);
  if (typeof r !== 'number' || typeof c !== 'number') {
    throw new TypeError(`${what}.r and ${what}.c must be numbers`);
  }
  if (!Number.isInteger(r) || !Number.isInteger(c)) {
    throw new TypeError(`${what}.r and ${what}.c must be integers`);
  }
  if (!onBoard(r, c)) {
    throw new RangeError(`(${r}, ${c}) is off the ${SIZE}x${SIZE} board`);
  }
  return { r, c };
}

/**
 * Second player's start pick (D9). Any of the 36 cells; it becomes the spark, burns, and
 * scores nothing. Then the first player moves.
 * @param {GameState} state must be in phase 'pick-start'
 * @param {{ r: number, c: number }} cell
 * @returns {GameState}
 * @throws {TypeError} malformed state or cell
 * @throws {RangeError} cell off the board
 * @throws {IllegalMoveError} not in the 'pick-start' phase (the start can only be picked once)
 */
export function pickStart(state, cell) {
  assertState(state);
  const { r, c } = readCell(cell, 'cell');
  if (state.phase !== 'pick-start') {
    throw new IllegalMoveError(
      state.phase === 'over' ? 'the game is over' : 'the start cell has already been picked',
    );
  }
  const burned = state.burned.slice();
  burned[indexOf(r, c)] = true;
  const history = [{ type: 'pick', player: state.toMove, from: null, to: { r, c }, value: 0 }];
  return freezeState({
    seed: state.seed,
    size: SIZE,
    values: state.values,
    burned,
    spark: { r, c },
    phase: 'play',
    over: false,
    firstPlayer: state.firstPlayer,
    toMove: state.firstPlayer,
    scores: state.scores.slice(),
    history,
  });
}

/**
 * Play a spark move and return the new state. The input state is never modified.
 * Only `move.r` and `move.c` (the landing cell) are read; other fields are ignored.
 * The game ends (phase 'over') when the next player has no legal move. There is no end bonus.
 * @param {GameState} state must be in phase 'play'
 * @param {{ r: number, c: number }} move
 * @returns {GameState}
 * @throws {TypeError} malformed state or move
 * @throws {RangeError} landing cell off the board
 * @throws {IllegalMoveError} start not picked yet, game over, or the cell is not reachable this turn
 */
export function applyMove(state, move) {
  assertState(state);
  const { r, c } = readCell(move, 'move');
  if (state.phase === 'pick-start') {
    throw new IllegalMoveError('the start cell must be picked first (use pickStart)');
  }
  if (state.phase === 'over') {
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
  history.push({
    type: 'move',
    player,
    from: { r: state.spark.r, c: state.spark.c },
    to: { r, c },
    value: legal.value,
  });
  const over = movesFrom(state.values, burned, r, c).length === 0;
  return freezeState({
    seed: state.seed,
    size: SIZE,
    values: state.values,
    burned,
    spark: { r, c },
    phase: over ? 'over' : 'play',
    over,
    firstPlayer: state.firstPlayer,
    toMove: /** @type {Player} */ (1 - player),
    scores,
    history,
  });
}

/**
 * Do whatever the phase calls for: pickStart in 'pick-start', applyMove in 'play'.
 * Handy for a UI where the player just taps a cell, and for replays.
 * @param {GameState} state
 * @param {{ r: number, c: number }} cell
 * @returns {GameState}
 */
export function step(state, cell) {
  assertState(state);
  return state.phase === 'pick-start' ? pickStart(state, cell) : applyMove(state, cell);
}

/**
 * True when the game has ended (the player to move has no legal move).
 * @param {GameState} state
 */
export function isOver(state) {
  assertState(state);
  return state.phase === 'over';
}

/**
 * Final result, or null while the game is still running. Scores include KOMI.
 * With a half-point komi and whole-point cells a draw cannot happen; `draw` is kept
 * (always false) so callers can stay generic.
 * @param {GameState} state
 * @returns {GameResult | null}
 */
export function result(state) {
  assertState(state);
  if (state.phase !== 'over') return null;
  const [a, b] = state.scores;
  const winner = a === b ? null : a > b ? 0 : 1;
  return Object.freeze({ over: true, scores: state.scores, winner, draw: winner === null });
}

/**
 * Rebuild a game from its seed and the cells played, starting with the start pick
 * (for "replay seed" and undo). Uses step(), so cells[0] is the pick.
 * @param {number} seed
 * @param {ReadonlyArray<{ r: number, c: number }>} cells
 * @param {{ firstPlayer?: 0 | 1 }} [opts]
 * @returns {GameState}
 */
export function replay(seed, cells, opts) {
  if (!Array.isArray(cells)) throw new TypeError('cells must be an array');
  let s = createGame(seed, opts);
  for (const m of cells) s = step(s, m);
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
