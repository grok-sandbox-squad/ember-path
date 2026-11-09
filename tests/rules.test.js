import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/rules.js';
import {
  SIZE, KOMI, MAX_SEED, IllegalMoveError,
  createGame, createRng, generateBoard, legalMoves, applyMove, pickStart, step, isLegalMove, isOver, result,
  replay, assertState,
} from '../src/rules.js';
import { makeState, onlyOpen, deepFreeze, keys } from './helpers.js';

const started = (seed, cell = { r: 2, c: 2 }, opts) => pickStart(createGame(seed, opts), cell);

test('new game: 6x6, values 1-5, nothing burned, pick-start phase, second player to pick, komi', () => {
  const s = createGame(42);
  assert.equal(s.values.length, SIZE * SIZE);
  assert.ok(s.values.every((v) => Number.isInteger(v) && v >= 1 && v <= 5));
  assert.equal(s.burned.filter(Boolean).length, 0);
  assert.equal(s.spark, null);
  assert.equal(s.phase, 'pick-start');
  assert.equal(s.over, false);
  assert.equal(s.firstPlayer, 0);
  assert.equal(s.toMove, 1, 'the second player picks the start');
  assert.equal(KOMI, 1.5);
  assert.deepEqual(s.scores, [0, 1.5]);
  const t = createGame(42, { firstPlayer: 1 });
  assert.equal(t.toMove, 0);
  assert.deepEqual(t.scores, [1.5, 0]);
});

test('no end bonus or fixed start is exported any more (D9)', () => {
  assert.equal(rules.LAST_MOVE_BONUS, undefined);
  assert.equal(rules.START, undefined);
});

test('board: same seed gives the same board, different seeds differ, all values appear', () => {
  assert.deepEqual(createGame(7).values, createGame(7).values);
  assert.deepEqual(generateBoard(7), createGame(7).values);
  assert.notDeepEqual(createGame(7).values, createGame(8).values);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let seed = 0; seed < 500; seed++) for (const v of generateBoard(seed)) counts[v]++;
  for (let v = 1; v <= 5; v++) assert.ok(counts[v] > 3000 && counts[v] < 4200, `value ${v}: ${counts[v]}`);
});

test('mulberry32 is pinned: seed 1 board never changes (replayable seeds)', () => {
  assert.equal(generateBoard(1).join(''), '413552443533132131242113342243414345');
  const r = createRng(0);
  const xs = [r(), r(), r()];
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('seeds: 0 and MAX_SEED work; bad seeds throw TypeError/RangeError', () => {
  assert.doesNotThrow(() => createGame(0));
  assert.doesNotThrow(() => createGame(MAX_SEED));
  for (const bad of ['42', null, undefined, {}, [], 1n, true]) {
    assert.throws(() => createGame(bad), TypeError, String(bad));
  }
  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, MAX_SEED + 1, 2 ** 53]) {
    assert.throws(() => createGame(bad), RangeError, String(bad));
  }
  assert.throws(() => createRng(-5), RangeError);
});

test('opts: bad firstPlayer and non-object opts are rejected', () => {
  assert.throws(() => createGame(1, null), TypeError);
  assert.throws(() => createGame(1, 'computer'), TypeError);
  assert.throws(() => createGame(1, { firstPlayer: 2 }), RangeError);
  assert.throws(() => createGame(1, { firstPlayer: '1' }), RangeError);
  assert.doesNotThrow(() => createGame(1, {}));
});

test('start pick: legalMoves returns exactly the 36 cells as picks', () => {
  const ms = legalMoves(createGame(3));
  assert.equal(ms.length, 36);
  assert.equal(new Set(ms.map((m) => `${m.r},${m.c}`)).size, 36);
  for (const m of ms) assert.deepEqual({ ...m, r: 0, c: 0 }, { type: 'pick', r: 0, c: 0, dir: null, dist: 0, value: 0 });
});

test('start pick: every one of the 36 cells is a legal pick (corners and the old centre too)', () => {
  const g = createGame(11);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      assert.equal(isLegalMove(g, { r, c }), true);
      const s = pickStart(g, { r, c });
      assert.deepEqual(s.spark, { r, c });
      assert.equal(s.burned.filter(Boolean).length, 1);
      assert.equal(s.burned[r * SIZE + c], true, 'the picked cell burns');
      assert.ok(legalMoves(s).length >= 3, 'the first player always has a move after any pick');
    }
  }
});

test('start pick: then phase is play and the FIRST player moves (both firstPlayer options)', () => {
  for (const firstPlayer of [0, 1]) {
    const g = createGame(5, { firstPlayer });
    assert.equal(g.toMove, 1 - firstPlayer);
    const s = pickStart(g, { r: 0, c: 0 });
    assert.equal(s.phase, 'play');
    assert.equal(s.toMove, firstPlayer);
    const expected = [0, 0];
    expected[1 - firstPlayer] = KOMI;
    assert.deepEqual(s.scores, expected, 'the pick scores nothing; komi stays');
    assert.deepEqual(s.history, [{ type: 'pick', player: 1 - firstPlayer, from: null, to: { r: 0, c: 0 }, value: 0 }]);
    assert.ok(legalMoves(s).every((m) => m.type === 'move'));
  }
});

test('start pick: cannot be skipped and cannot be done twice', () => {
  const g = createGame(9);
  assert.throws(() => applyMove(g, { r: 2, c: 3 }), IllegalMoveError);
  const s = pickStart(g, { r: 2, c: 2 });
  assert.throws(() => pickStart(s, { r: 0, c: 0 }), IllegalMoveError);
  assert.throws(() => pickStart(s, { r: 2, c: 2 }), IllegalMoveError);
  const over = applyMove(onlyOpen([[0, 1]], [0, 0]), { r: 0, c: 1 });
  assert.throws(() => pickStart(over, { r: 3, c: 3 }), IllegalMoveError);
});

test('start pick: bad coordinates and bad states', () => {
  const g = createGame(9);
  for (const bad of [null, undefined, 3, 'a1', {}, [0, 0], { r: '0', c: 0 }, { r: 0 }, { r: 0.5, c: 0 }, { r: NaN, c: 1 }, { r: Infinity, c: 1 }]) {
    assert.throws(() => pickStart(g, bad), TypeError, JSON.stringify(bad));
    assert.equal(isLegalMove(g, bad), false);
  }
  for (const [r, c] of [[-1, 0], [0, 6], [6, 6], [99, -99]]) assert.throws(() => pickStart(g, { r, c }), RangeError);
  for (const bad of [null, undefined, {}, 'state', { ...g, spark: { r: 0, c: 0 } }, { ...g, phase: 'setup' }]) {
    assert.throws(() => pickStart(bad, { r: 0, c: 0 }), TypeError);
  }
});

test('step(): picks in pick-start, moves in play', () => {
  let s = step(createGame(4), { r: 0, c: 0 });
  assert.equal(s.phase, 'play');
  s = step(s, legalMoves(s)[0]);
  assert.equal(s.history.length, 2);
  assert.equal(s.history[1].type, 'move');
});

test('legality: board edges stop moves (corner spark)', () => {
  const s = makeState({ clearAll: true, spark: [0, 0] });
  assert.deepEqual(keys(legalMoves(s)), ['0,1', '0,2', '0,3', '1,0', '2,0', '3,0']);
  const s2 = makeState({ clearAll: true, spark: [5, 5] });
  assert.deepEqual(keys(legalMoves(s2)), ['2,5', '3,5', '4,5', '5,2', '5,3', '5,4']);
});

test('legality: every cell on the path must be clear, not just the landing cell', () => {
  const right = makeState({ clearAll: true, spark: [2, 2], burned: [[2, 3]] });
  assert.ok(!legalMoves(right).some((m) => m.dir === 'right'));
  assert.throws(() => applyMove(right, { r: 2, c: 4 }), IllegalMoveError); // 2-step over burned middle
  assert.throws(() => applyMove(right, { r: 2, c: 5 }), IllegalMoveError); // 3-step over burned first cell
  const down = makeState({ clearAll: true, spark: [2, 2], burned: [[4, 2]] });
  assert.deepEqual(legalMoves(down).filter((m) => m.dir === 'down').map((m) => m.dist), [1]);
  assert.throws(() => applyMove(down, { r: 4, c: 2 }), IllegalMoveError); // landing burned
  assert.throws(() => applyMove(down, { r: 5, c: 2 }), IllegalMoveError); // 3-step, 2nd cell burned
  const row = makeState({ clearAll: true, spark: [5, 0], burned: [[5, 2]] });
  assert.deepEqual(legalMoves(row).filter((m) => m.dir === 'right').map((m) => m.dist), [1]);
  assert.throws(() => applyMove(row, { r: 5, c: 3 }), IllegalMoveError);
  const up = makeState({ clearAll: true, spark: [2, 2], burned: [[1, 2]] });
  assert.throws(() => applyMove(up, { r: 0, c: 2 }), IllegalMoveError);
});

test('legality: lengths 1-3 only; 0, 4, 5 steps, diagonals, knight jumps and staying put rejected', () => {
  const s = makeState({ clearAll: true, spark: [1, 1] });
  for (const [r, c] of [[1, 5], [5, 1], [1, 1], [0, 0], [2, 2], [3, 3], [0, 2], [3, 2]]) {
    assert.throws(() => applyMove(s, { r, c }), IllegalMoveError, `${r},${c}`);
    assert.equal(isLegalMove(s, { r, c }), false);
  }
  for (const [r, c] of [[1, 2], [1, 3], [1, 4], [2, 1], [4, 1], [0, 1], [1, 0]]) {
    assert.equal(isLegalMove(s, { r, c }), true, `${r},${c}`);
  }
});

test('malformed moves: TypeError; off-board: RangeError; game over: IllegalMoveError', () => {
  const s = started(5);
  for (const bad of [null, undefined, 3, 'up', {}, { r: '1', c: 2 }, { r: 1 }, { r: 1.5, c: 2 }, { r: NaN, c: 2 }, [1, 2]]) {
    assert.throws(() => applyMove(s, bad), TypeError, JSON.stringify(bad));
    assert.equal(isLegalMove(s, bad), false);
  }
  for (const [r, c] of [[-1, 2], [6, 2], [2, 6], [2, -1], [100, 100]]) {
    assert.throws(() => applyMove(s, { r, c }), RangeError);
  }
  assert.throws(() => applyMove(s, { r: Infinity, c: 2 }), TypeError);
  const over = applyMove(onlyOpen([[0, 1]], [0, 0]), { r: 0, c: 1 });
  assert.equal(over.phase, 'over');
  assert.throws(() => applyMove(over, { r: 0, c: 0 }), IllegalMoveError);
  assert.deepEqual(legalMoves(over), []);
});

test('bad state: null, junk and broken shapes throw TypeError; isLegalMove returns false', () => {
  const good = started(1);
  const fresh = createGame(1);
  const broken = [
    null, undefined, 0, 'state', [], {},
    { ...good, values: good.values.slice(1) },
    { ...good, values: good.values.map(() => 9) },
    { ...good, burned: good.burned.map(() => 1) },
    { ...good, spark: { r: 9, c: 0 } },
    { ...good, spark: { r: 0, c: 0 } }, // spark on an unburned cell
    { ...good, spark: null }, // play phase without a spark
    { ...good, phase: 'pick-start' }, // pick-start with a spark
    { ...good, phase: 'done' },
    { ...good, over: true }, // over disagrees with phase
    { ...good, toMove: 2 },
    { ...good, firstPlayer: 3 },
    { ...good, scores: [0] },
    { ...good, scores: [-1, 0] },
    { ...good, scores: [0, NaN] },
    { ...fresh, burned: fresh.burned.map((b, i) => i === 0) }, // burned cell before the pick
  ];
  for (const s of broken) {
    for (const fn of [legalMoves, isOver, result, assertState, (x) => applyMove(x, { r: 1, c: 2 }), (x) => step(x, { r: 1, c: 2 })]) {
      assert.throws(() => fn(s), TypeError);
    }
    assert.equal(isLegalMove(s, { r: 1, c: 2 }), false, 'isLegalMove never throws');
  }
});

test('immutability: frozen inputs are never touched and outputs are deeply frozen', () => {
  const g = createGame(9);
  const gSnap = JSON.stringify(g);
  const s0 = pickStart(g, { r: 3, c: 3 });
  assert.equal(JSON.stringify(g), gSnap);
  assert.ok(Object.isFrozen(s0) && Object.isFrozen(s0.values) && Object.isFrozen(s0.burned) && Object.isFrozen(s0.spark));
  const snapshot = JSON.stringify(s0);
  const m = legalMoves(s0)[0];
  const s1 = applyMove(s0, m);
  assert.equal(JSON.stringify(s0), snapshot);
  assert.notEqual(s1, s0);
  assert.ok(Object.isFrozen(s1.history[1]) && Object.isFrozen(s1.scores));
  const plain = JSON.parse(snapshot);
  const before = JSON.stringify(plain);
  applyMove(plain, m);
  legalMoves(plain);
  result(plain);
  assert.equal(JSON.stringify(plain), before);
  const plainFresh = JSON.parse(gSnap);
  pickStart(plainFresh, { r: 0, c: 0 });
  assert.equal(JSON.stringify(plainFresh), gSnap);
  assert.doesNotThrow(() => applyMove(deepFreeze(JSON.parse(snapshot)), deepFreeze({ r: m.r, c: m.c })));
});

test('scoring: landing value scores, landing cell burns, spark moves, turn passes', () => {
  const values = new Array(36).fill(1);
  values[2 * 6 + 5] = 5; // (2,5)
  const s = makeState({ values, clearAll: true, spark: [2, 2] });
  const t = applyMove(s, { r: 2, c: 5 });
  assert.deepEqual(t.scores, [5, 1.5]);
  assert.equal(t.burned[2 * 6 + 5], true);
  assert.equal(t.burned[2 * 6 + 3], false, 'passed-over cells do not burn');
  assert.deepEqual(t.spark, { r: 2, c: 5 });
  assert.equal(t.toMove, 1);
  assert.deepEqual(t.history.at(-1), { type: 'move', player: 0, from: { r: 2, c: 2 }, to: { r: 2, c: 5 }, value: 5 });
  const u = applyMove(t, { r: 3, c: 5 });
  assert.deepEqual(u.scores, [5, 2.5]);
  assert.equal(u.toMove, 0);
});

test('end: game ends when the player to move has no move; no end bonus', () => {
  const values = new Array(36).fill(2);
  values[1] = 4; // (0,1)
  const s = onlyOpen([[0, 1]], [0, 0], { values, scores: [1, 6.5] });
  assert.equal(isOver(s), false);
  assert.equal(result(s), null);
  const t = applyMove(s, { r: 0, c: 1 });
  assert.equal(t.phase, 'over');
  assert.equal(t.over, true);
  assert.equal(isOver(t), true);
  assert.equal(t.toMove, 1, 'toMove is the stuck player');
  assert.equal('bonus' in t, false);
  assert.deepEqual(t.scores, [5, 6.5]);
  assert.deepEqual(result(t), { over: true, scores: [5, 6.5], winner: 1, draw: false });
});

test('end: komi decides close games and draws are impossible', () => {
  const values = new Array(36).fill(1);
  // first player (0) lands 1 to tie the raw points 3-3, but the second player has +1.5
  const t = applyMove(onlyOpen([[0, 1]], [0, 0], { values, scores: [2, 3 + KOMI] }), { r: 0, c: 1 });
  assert.deepEqual(result(t), { over: true, scores: [3, 4.5], winner: 1, draw: false });
  const w = applyMove(onlyOpen([[0, 1]], [0, 0], { values, scores: [4, 3 + KOMI] }), { r: 0, c: 1 });
  assert.equal(result(w).winner, 0);
  // player 1 moving first: komi belongs to player 0
  assert.deepEqual(createGame(1, { firstPlayer: 1 }).scores, [KOMI, 0]);
});

test('end: a move that still leaves the opponent a move does not end the game', () => {
  const s = onlyOpen([[0, 1], [0, 2]], [0, 0]);
  const t = applyMove(s, { r: 0, c: 1 });
  assert.equal(t.phase, 'play');
  const u = applyMove(t, { r: 0, c: 2 });
  assert.equal(u.phase, 'over');
  assert.deepEqual(u.scores, [1 * s.values[1], KOMI + s.values[2]]);
});

test('replay: rebuilding from seed + cells (start pick first) gives the same state', () => {
  let s = createGame(77, { firstPlayer: 1 });
  const played = [{ r: 4, c: 1 }];
  s = pickStart(s, played[0]);
  for (let i = 0; i < 6 && !s.over; i++) {
    const m = legalMoves(s).at(-1);
    played.push({ r: m.r, c: m.c });
    s = applyMove(s, m);
  }
  assert.deepEqual(replay(77, played, { firstPlayer: 1 }), s);
  assert.deepEqual(replay(77, [], { firstPlayer: 1 }), createGame(77, { firstPlayer: 1 }));
  assert.throws(() => replay(77, 'nope'), TypeError);
  assert.throws(() => replay(77, [{ r: 2, c: 2 }, { r: 5, c: 5 }]), IllegalMoveError);
});
