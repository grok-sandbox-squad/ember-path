import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZE, START, LAST_MOVE_BONUS, MAX_SEED, IllegalMoveError,
  createGame, createRng, generateBoard, legalMoves, applyMove, isLegalMove, isOver, result, replay, assertState,
} from '../src/rules.js';
import { makeState, onlyOpen, deepFreeze, keys } from './helpers.js';

test('board: 6x6, values 1-5, start r2c2 (0-based) burned, spark there, player 0 first', () => {
  const s = createGame(42);
  assert.equal(s.values.length, SIZE * SIZE);
  assert.ok(s.values.every((v) => Number.isInteger(v) && v >= 1 && v <= 5));
  assert.deepEqual(START, { r: 2, c: 2 });
  assert.equal(s.burned.filter(Boolean).length, 1);
  assert.equal(s.burned[2 * SIZE + 2], true);
  assert.deepEqual(s.spark, { r: 2, c: 2 });
  assert.equal(s.toMove, 0);
  assert.deepEqual(s.scores, [0, 0]);
  assert.equal(s.over, false);
  assert.equal(createGame(42, { firstPlayer: 1 }).toMove, 1);
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

test('opening: from the centre-ish start every direction has 2-3 cells (10 moves)', () => {
  const ms = legalMoves(createGame(3));
  assert.equal(ms.length, 10); // up 2, right 3, down 3, left 2
  for (const m of ms) {
    assert.ok(m.dist >= 1 && m.dist <= 3);
    assert.ok(m.r === 2 || m.c === 2, 'orthogonal only');
  }
});

test('legality: board edges stop moves (corner spark)', () => {
  const s = makeState({ clearAll: true, spark: [0, 0] });
  assert.deepEqual(keys(legalMoves(s)), ['0,1', '0,2', '0,3', '1,0', '2,0', '3,0']);
  const s2 = makeState({ clearAll: true, spark: [5, 5] });
  assert.deepEqual(keys(legalMoves(s2)), ['2,5', '3,5', '4,5', '5,2', '5,3', '5,4']);
});

test('legality: every cell on the path must be clear, not just the landing cell', () => {
  // Spark at (2,2). Burn (2,3): blocks the 1-step landing AND the 2- and 3-step moves right.
  const right = makeState({ clearAll: true, spark: [2, 2], burned: [[2, 3]] });
  assert.ok(!legalMoves(right).some((m) => m.dir === 'right'));
  assert.throws(() => applyMove(right, { r: 2, c: 4 }), IllegalMoveError); // 2-step over burned middle
  assert.throws(() => applyMove(right, { r: 2, c: 5 }), IllegalMoveError); // 3-step over burned first cell
  // Burn (4,2): down 1 is fine, down 2 lands on burned, down 3 passes a burned middle cell.
  const down = makeState({ clearAll: true, spark: [2, 2], burned: [[4, 2]] });
  assert.deepEqual(legalMoves(down).filter((m) => m.dir === 'down').map((m) => m.dist), [1]);
  assert.throws(() => applyMove(down, { r: 4, c: 2 }), IllegalMoveError); // landing burned
  assert.throws(() => applyMove(down, { r: 5, c: 2 }), IllegalMoveError); // 3-step, 2nd cell burned
  // Spark at (5,0), burn (5,2): right 1 ok, right 2 lands burned, right 3 passes it.
  const row = makeState({ clearAll: true, spark: [5, 0], burned: [[5, 2]] });
  assert.deepEqual(legalMoves(row).filter((m) => m.dir === 'right').map((m) => m.dist), [1]);
  assert.throws(() => applyMove(row, { r: 5, c: 3 }), IllegalMoveError);
  // Burn (1,2): up 1 blocked so up 2 (row 0) is illegal even though row 0 is clear.
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
  const s = createGame(5);
  for (const bad of [null, undefined, 3, 'up', {}, { r: '1', c: 2 }, { r: 1 }, { r: 1.5, c: 2 }, { r: NaN, c: 2 }, [1, 2]]) {
    assert.throws(() => applyMove(s, bad), TypeError, JSON.stringify(bad));
    assert.equal(isLegalMove(s, bad), false);
  }
  for (const [r, c] of [[-1, 2], [6, 2], [2, 6], [2, -1], [100, 100]]) {
    assert.throws(() => applyMove(s, { r, c }), RangeError);
  }
  assert.throws(() => applyMove(s, { r: Infinity, c: 2 }), TypeError);
  const over = applyMove(onlyOpen([[0, 1]], [0, 0]), { r: 0, c: 1 });
  assert.equal(over.over, true);
  assert.throws(() => applyMove(over, { r: 0, c: 0 }), IllegalMoveError);
  assert.deepEqual(legalMoves(over), []);
});

test('bad state: null, undefined, junk and broken shapes throw TypeError everywhere', () => {
  const good = createGame(1);
  const broken = [
    null, undefined, 0, 'state', [], {},
    { ...good, values: good.values.slice(1) },
    { ...good, values: good.values.map(() => 9) },
    { ...good, burned: good.burned.map(() => 1) },
    { ...good, spark: { r: 9, c: 0 } },
    { ...good, spark: { r: 0, c: 0 } }, // spark on an unburned cell
    { ...good, toMove: 2 },
    { ...good, scores: [0] },
    { ...good, scores: [-1, 0] },
    { ...good, over: 'no' },
  ];
  for (const s of broken) {
    for (const fn of [legalMoves, isOver, result, assertState, (x) => applyMove(x, { r: 1, c: 2 })]) {
      assert.throws(() => fn(s), TypeError);
    }
    assert.equal(isLegalMove(s, { r: 1, c: 2 }), false, 'isLegalMove never throws');
  }
});

test('immutability: frozen inputs are never touched and outputs are deeply frozen', () => {
  const s0 = createGame(9);
  assert.ok(Object.isFrozen(s0) && Object.isFrozen(s0.values) && Object.isFrozen(s0.burned) && Object.isFrozen(s0.spark));
  const snapshot = JSON.stringify(s0);
  const m = legalMoves(s0)[0];
  const s1 = applyMove(s0, m);
  assert.equal(JSON.stringify(s0), snapshot);
  assert.notEqual(s1, s0);
  assert.ok(Object.isFrozen(s1.history[0]) && Object.isFrozen(s1.scores));
  // A plain (unfrozen, JSON round-tripped) state is also left untouched.
  const plain = JSON.parse(snapshot);
  const before = JSON.stringify(plain);
  applyMove(plain, m);
  legalMoves(plain);
  result(plain);
  assert.equal(JSON.stringify(plain), before);
  // And a caller-frozen move object is fine.
  assert.doesNotThrow(() => applyMove(deepFreeze(JSON.parse(snapshot)), deepFreeze({ r: m.r, c: m.c })));
});

test('scoring: landing value scores, landing cell burns, spark moves, turn passes', () => {
  const values = new Array(36).fill(1);
  values[2 * 6 + 5] = 5; // (2,5)
  const s = makeState({ values, clearAll: true, spark: [2, 2] });
  const t = applyMove(s, { r: 2, c: 5 });
  assert.deepEqual(t.scores, [5, 0]);
  assert.equal(t.burned[2 * 6 + 5], true);
  assert.equal(t.burned[2 * 6 + 3], false, 'passed-over cells do not burn');
  assert.deepEqual(t.spark, { r: 2, c: 5 });
  assert.equal(t.toMove, 1);
  assert.deepEqual(t.history.at(-1), { player: 0, from: { r: 2, c: 2 }, to: { r: 2, c: 5 }, value: 5 });
  const u = applyMove(t, { r: 3, c: 5 });
  assert.deepEqual(u.scores, [5, 1]);
  assert.equal(u.toMove, 0);
});

test('end: game ends when the player to move has no move; last mover gets +3', () => {
  const values = new Array(36).fill(2);
  values[1] = 4; // (0,1)
  const s = onlyOpen([[0, 1]], [0, 0], { values, scores: [1, 6] });
  assert.equal(isOver(s), false);
  assert.equal(result(s), null);
  const t = applyMove(s, { r: 0, c: 1 });
  assert.equal(t.over, true);
  assert.equal(isOver(t), true);
  assert.deepEqual(t.bonus, { player: 0, points: LAST_MOVE_BONUS });
  assert.deepEqual(t.scores, [1 + 4 + 3, 6]);
  assert.deepEqual(result(t), { over: true, scores: [8, 6], winner: 0, draw: false });
});

test('end: the bonus can make a draw, and player 1 can win', () => {
  const values = new Array(36).fill(1);
  const draw = applyMove(onlyOpen([[0, 1]], [0, 0], { values, scores: [3, 7] }), { r: 0, c: 1 });
  assert.deepEqual(result(draw), { over: true, scores: [7, 7], winner: null, draw: true });
  const p1 = applyMove(onlyOpen([[0, 1]], [0, 0], { values, scores: [9, 2], toMove: 1 }), { r: 0, c: 1 });
  assert.deepEqual(p1.bonus, { player: 1, points: 3 });
  assert.deepEqual(result(p1), { over: true, scores: [9, 6], winner: 0, draw: false });
  const p1win = applyMove(onlyOpen([[0, 1]], [0, 0], { values, scores: [5, 2], toMove: 1 }), { r: 0, c: 1 });
  assert.equal(result(p1win).winner, 1);
});

test('end: a move that still leaves the opponent a move does not end the game', () => {
  const s = onlyOpen([[0, 1], [0, 2]], [0, 0]);
  const t = applyMove(s, { r: 0, c: 1 });
  assert.equal(t.over, false);
  assert.equal(t.bonus, null);
  const u = applyMove(t, { r: 0, c: 2 });
  assert.equal(u.over, true);
  assert.equal(u.bonus.player, 1);
});

test('replay: rebuilding from seed + moves gives the same state', () => {
  let s = createGame(77, { firstPlayer: 1 });
  const played = [];
  for (let i = 0; i < 6 && !s.over; i++) {
    const m = legalMoves(s).at(-1);
    played.push({ r: m.r, c: m.c });
    s = applyMove(s, m);
  }
  assert.deepEqual(replay(77, played, { firstPlayer: 1 }), s);
  assert.throws(() => replay(77, 'nope'), TypeError);
  assert.throws(() => replay(77, [{ r: 5, c: 5 }]), IllegalMoveError);
});
