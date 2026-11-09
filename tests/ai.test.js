import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createRng, legalMoves, applyMove, result } from '../src/rules.js';
import { chooseMove, DIFFICULTIES, DIFFICULTY_LABELS, HARD_NODE_BUDGET } from '../src/ai.js';
import { onlyOpen, makeState, key } from './helpers.js';

function playGame(seed, diffs, firstPlayer, hardOpts) {
  let s = createGame(seed, { firstPlayer });
  const rng = createRng((seed * 7919 + 13) >>> 0);
  while (!s.over) {
    const d = diffs[s.toMove];
    s = applyMove(s, chooseMove(s, d, rng, d === 'hard' ? hardOpts : undefined));
  }
  return s;
}

test('labels: Easy, Normal, Hard (never Medium); names are case-insensitive', () => {
  assert.deepEqual([...DIFFICULTIES], ['easy', 'normal', 'hard']);
  assert.deepEqual({ ...DIFFICULTY_LABELS }, { easy: 'Easy', normal: 'Normal', hard: 'Hard' });
  const s = createGame(1);
  for (const d of ['Easy', 'NORMAL', 'Hard']) assert.ok(chooseMove(s, d, createRng(1)));
});

test('every difficulty only returns legal moves (many positions, odd rngs too)', () => {
  const rngs = [() => 0, () => 0.9999999999999999, () => 0.5];
  for (let seed = 0; seed < 25; seed++) {
    for (const d of DIFFICULTIES) {
      for (const odd of rngs) {
        let s = createGame(seed, { firstPlayer: seed % 2 });
        while (!s.over) {
          const m = chooseMove(s, d, odd, { maxNodes: 5000 });
          assert.ok(legalMoves(s).some((x) => key(x) === key(m)), `${d} seed ${seed}`);
          s = applyMove(s, m);
        }
      }
    }
  }
});

test('determinism: same state + same rng seed gives the same move, for every level', () => {
  for (let seed = 0; seed < 20; seed++) {
    let s = createGame(seed);
    for (let i = 0; i < 4 && !s.over; i++) s = applyMove(s, legalMoves(s)[i % legalMoves(s).length]);
    if (s.over) continue;
    for (const d of DIFFICULTIES) {
      const a = chooseMove(s, d, createRng(99));
      const b = chooseMove(s, d, createRng(99));
      assert.deepEqual(a, b);
    }
  }
  // whole games replay identically
  assert.deepEqual(playGame(3, ['hard', 'easy'], 0).history, playGame(3, ['hard', 'easy'], 0).history);
});

test('chooseMove does not mutate the state', () => {
  const s = JSON.parse(JSON.stringify(createGame(4)));
  const before = JSON.stringify(s);
  for (const d of DIFFICULTIES) chooseMove(s, d, createRng(1));
  assert.equal(JSON.stringify(s), before);
});

test('bad input: unknown difficulty, bad rng, bad state, bad opts', () => {
  const s = createGame(2);
  for (const d of ['medium', 'Medium', 'impossible', '']) assert.throws(() => chooseMove(s, d, createRng(1)), RangeError);
  for (const d of [undefined, null, 2, {}]) assert.throws(() => chooseMove(s, d, createRng(1)), TypeError);
  for (const rng of [undefined, null, 0.5, 'random']) assert.throws(() => chooseMove(s, 'easy', rng), TypeError);
  for (const out of [1, 1.5, -0.1, NaN, Infinity, '0.5', undefined]) {
    assert.throws(() => chooseMove(s, 'easy', () => out), RangeError, String(out));
  }
  for (const bad of [null, undefined, {}, 'state']) assert.throws(() => chooseMove(bad, 'hard', createRng(1)), TypeError);
  assert.throws(() => chooseMove(s, 'hard', createRng(1), { maxNodes: 0 }), RangeError);
  assert.throws(() => chooseMove(s, 'hard', createRng(1), { maxNodes: 1.5 }), RangeError);
  assert.throws(() => chooseMove(s, 'hard', createRng(1), { maxTimeMs: -1 }), RangeError);
  assert.throws(() => chooseMove(s, 'hard', createRng(1), null), TypeError);
});

test('game over: chooseMove returns null; single legal move is returned as is', () => {
  const over = applyMove(onlyOpen([[0, 1]], [0, 0]), { r: 0, c: 1 });
  for (const d of DIFFICULTIES) assert.equal(chooseMove(over, d, createRng(1)), null);
  const one = onlyOpen([[0, 1], [3, 3]], [0, 0]);
  for (const d of DIFFICULTIES) assert.deepEqual(key(chooseMove(one, d, createRng(1))), '0,1');
});

test('Normal is greedy, counts the +3 bonus, and breaks ties by the opponent\'s best reply', () => {
  const values = new Array(36).fill(1);
  values[0 * 6 + 3] = 5; // (0,3)
  values[3 * 6 + 0] = 5; // (3,0)
  values[3 * 6 + 1] = 5; // (3,1): reply available from (3,0)
  const s = makeState({ values, clearAll: true, spark: [0, 0] });
  // (0,3) and (3,0) both give 5; from (3,0) the opponent can take (3,1)=5, from (0,3) only 1s.
  assert.equal(key(chooseMove(s, 'normal', createRng(1))), '0,3');
  // A 2 that ends the game (2+3=5) beats a 4 that does not.
  const v2 = new Array(36).fill(1);
  v2[1] = 2; // (0,1) dead end
  v2[6] = 4; // (1,0) has a follow-up at (2,0)
  const t = onlyOpen([[0, 1], [1, 0], [2, 0]], [0, 0], { values: v2 });
  assert.equal(key(chooseMove(t, 'normal', createRng(1))), '0,1');
});

test('Hard sees past the greedy move', () => {
  // Spark (0,1). Open: (0,0)=1 dead end; (0,2)=5 whose only reply is (1,2)=5, a dead end.
  // Greedy takes (0,2): 5, then the opponent takes 5 + 3 bonus, net -3.
  // Hard takes (0,0): 1 + 3 bonus at once, net +4.
  const values = new Array(36).fill(1);
  values[2] = 5;
  values[8] = 5;
  const s = onlyOpen([[0, 0], [0, 2], [1, 2]], [0, 1], { values });
  assert.equal(key(chooseMove(s, 'normal', createRng(1))), '0,2');
  assert.equal(key(chooseMove(s, 'hard', createRng(1))), '0,0');
});

test('strength: Hard beats Easy in at least 85% of 40 seeded games (alternating who starts)', (t) => {
  const N = 40;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const first = i % 2;
    const s = playGame(1000 + i, ['hard', 'easy'], first);
    if (result(s).winner === 0) wins++;
  }
  t.diagnostic(`Hard beat Easy ${wins}/${N}`);
  assert.ok(wins >= 34, `Hard won only ${wins}/${N}`);
});

test('strength: Hard beats Normal and Normal beats Easy more often than not', (t) => {
  const N = 30;
  const tally = (a, b) => {
    let w = 0;
    let l = 0;
    for (let i = 0; i < N; i++) {
      const r = result(playGame(2000 + i, [a, b], i % 2));
      if (r.winner === 0) w++;
      else if (r.winner === 1) l++;
    }
    return [w, l];
  };
  const [hw, hl] = tally('hard', 'normal');
  const [nw, nl] = tally('normal', 'easy');
  t.diagnostic(`Hard vs Normal ${hw}-${hl}, Normal vs Easy ${nw}-${nl} (of ${N})`);
  assert.ok(hw > hl * 2, 'Hard should clearly beat Normal');
  assert.ok(nw > nl * 2, 'Normal should clearly beat Easy');
});

test('Hard timing: worst of the first 3 moves over 30 seeds stays under 300 ms', (t) => {
  // Hard stops on a node budget (deterministic), so wall time only depends on device speed.
  // Locally the worst case is ~15 ms on Node 20, so 300 ms leaves ~20x headroom for slow CI.
  let worst = 0;
  for (let seed = 0; seed < 30; seed++) {
    let s = createGame(seed);
    for (let ply = 0; ply < 3 && !s.over; ply++) {
      const t0 = performance.now();
      const m = chooseMove(s, 'hard', createRng(1));
      worst = Math.max(worst, performance.now() - t0);
      s = applyMove(s, m);
    }
  }
  t.diagnostic(`Hard worst early move: ${worst.toFixed(1)} ms (budget ${HARD_NODE_BUDGET} nodes)`);
  assert.ok(worst <= 300, `Hard took ${worst.toFixed(1)} ms`);
});

test('Hard optional time cap is honoured', () => {
  let clock = 0;
  const now = () => (clock += 1); // fake clock: 1 ms per check
  const m = chooseMove(createGame(0), 'hard', createRng(1), { maxNodes: 10_000_000, maxTimeMs: 5, now });
  assert.ok(legalMoves(createGame(0)).some((x) => key(x) === key(m)));
  assert.ok(clock < 50);
});

test('balance (measurement): Hard vs Hard over 100 seeds, first vs second player', (t) => {
  // Measurement for Supreme Leader, not a pass/fail on balance. Hard is capped at
  // 20k nodes here (default 60k) to keep CI fast; the full-budget numbers are in the PR.
  const N = 100;
  let first = 0;
  let second = 0;
  let draws = 0;
  for (let i = 0; i < N; i++) {
    const fp = i % 2;
    const r = result(playGame(5000 + i, ['hard', 'hard'], fp, { maxNodes: 20000 }));
    if (r.draw) draws++;
    else if (r.winner === fp) first++;
    else second++;
  }
  t.diagnostic(`Hard vs Hard (20k nodes): first player ${first}%, second ${second}%, draw ${draws}%`);
  if (first > 65) t.diagnostic('FLAG: first-player wins exceed 65%; balance decision needed');
  assert.equal(first + second + draws, N);
});
