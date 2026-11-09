import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createRng, legalMoves, applyMove, pickStart, step, result } from '../src/rules.js';
import {
  chooseMove, DIFFICULTIES, DIFFICULTY_LABELS, HARD_NODE_BUDGET, HARD_PICK_NODE_BUDGET,
} from '../src/ai.js';
import { onlyOpen, key } from './helpers.js';

/** Play a whole game (start pick included). diffs[p] is player p's level; hardOpts applies to Hard. */
function playGame(seed, diffs, firstPlayer, hardOpts) {
  let s = createGame(seed, { firstPlayer });
  const rng = createRng((seed * 7919 + 13) >>> 0);
  while (!s.over) {
    const d = diffs[s.toMove];
    const opts = d === 'hard' && hardOpts ? (s.phase === 'pick-start' ? hardOpts.pick : hardOpts.move) : undefined;
    s = step(s, chooseMove(s, d, rng, opts === undefined ? undefined : { maxNodes: opts }));
  }
  return s;
}

/** A pick-start state with custom values. */
function pickState(values) {
  const s = JSON.parse(JSON.stringify(createGame(1)));
  s.values = values.slice();
  return s;
}

test('labels: Easy, Normal, Hard (never Medium); names are case-insensitive', () => {
  assert.deepEqual([...DIFFICULTIES], ['easy', 'normal', 'hard']);
  assert.deepEqual({ ...DIFFICULTY_LABELS }, { easy: 'Easy', normal: 'Normal', hard: 'Hard' });
  const s = pickStart(createGame(1), { r: 2, c: 2 });
  for (const d of ['Easy', 'NORMAL', 'Hard']) assert.ok(chooseMove(s, d, createRng(1)));
});

test('every difficulty only returns legal actions, start pick included (odd rngs too)', () => {
  const rngs = [() => 0, () => 0.9999999999999999, () => 0.5];
  for (let seed = 0; seed < 20; seed++) {
    for (const d of DIFFICULTIES) {
      for (const odd of rngs) {
        let s = createGame(seed, { firstPlayer: seed % 2 });
        while (!s.over) {
          const m = chooseMove(s, d, odd, { maxNodes: 5000 });
          assert.ok(legalMoves(s).some((x) => key(x) === key(m) && x.type === m.type), `${d} seed ${seed}`);
          assert.equal(m.type, s.phase === 'pick-start' ? 'pick' : 'move');
          s = step(s, m);
        }
      }
    }
  }
});

test('determinism: same state + same rng seed gives the same action (pick and move), every level', () => {
  for (let seed = 0; seed < 12; seed++) {
    const g = createGame(seed);
    for (const d of DIFFICULTIES) {
      assert.deepEqual(chooseMove(g, d, createRng(99)), chooseMove(g, d, createRng(99)), `${d} pick`);
    }
    let s = pickStart(g, { r: seed % 6, c: (seed * 5) % 6 });
    for (let i = 0; i < 3 && !s.over; i++) s = applyMove(s, legalMoves(s)[i % legalMoves(s).length]);
    if (s.over) continue;
    for (const d of DIFFICULTIES) assert.deepEqual(chooseMove(s, d, createRng(99)), chooseMove(s, d, createRng(99)));
  }
  assert.deepEqual(playGame(3, ['hard', 'easy'], 0).history, playGame(3, ['hard', 'easy'], 0).history);
});

test('chooseMove does not mutate the state', () => {
  for (const s of [JSON.parse(JSON.stringify(createGame(4))), JSON.parse(JSON.stringify(pickStart(createGame(4), { r: 1, c: 1 })))]) {
    const before = JSON.stringify(s);
    for (const d of DIFFICULTIES) chooseMove(s, d, createRng(1), { maxNodes: 20000 });
    assert.equal(JSON.stringify(s), before);
  }
});

test('bad input: unknown difficulty, bad rng, bad state, bad opts', () => {
  for (const s of [createGame(2), pickStart(createGame(2), { r: 0, c: 0 })]) {
    for (const d of ['medium', 'Medium', 'impossible', '']) assert.throws(() => chooseMove(s, d, createRng(1)), RangeError);
    for (const d of [undefined, null, 2, {}]) assert.throws(() => chooseMove(s, d, createRng(1)), TypeError);
    for (const rng of [undefined, null, 0.5, 'random']) assert.throws(() => chooseMove(s, 'easy', rng), TypeError);
    for (const out of [1, 1.5, -0.1, NaN, Infinity, '0.5', undefined]) {
      assert.throws(() => chooseMove(s, 'easy', () => out), RangeError, String(out));
    }
    assert.throws(() => chooseMove(s, 'hard', createRng(1), { maxNodes: 0 }), RangeError);
    assert.throws(() => chooseMove(s, 'hard', createRng(1), { maxNodes: 1.5 }), RangeError);
    assert.throws(() => chooseMove(s, 'hard', createRng(1), { maxTimeMs: -1 }), RangeError);
    assert.throws(() => chooseMove(s, 'hard', createRng(1), null), TypeError);
  }
  for (const bad of [null, undefined, {}, 'state']) assert.throws(() => chooseMove(bad, 'hard', createRng(1)), TypeError);
});

test('game over: chooseMove returns null; a single legal move is returned as is', () => {
  const over = applyMove(onlyOpen([[0, 1]], [0, 0]), { r: 0, c: 1 });
  for (const d of DIFFICULTIES) assert.equal(chooseMove(over, d, createRng(1)), null);
  const one = onlyOpen([[0, 1], [3, 3]], [0, 0]);
  for (const d of DIFFICULTIES) assert.deepEqual(key(chooseMove(one, d, createRng(1))), '0,1');
});

test('Normal is greedy and breaks ties by the opponent\'s best reply', () => {
  const values = new Array(36).fill(1);
  values[0 * 6 + 3] = 5; // (0,3)
  values[3 * 6 + 0] = 5; // (3,0)
  values[3 * 6 + 1] = 5; // (3,1): reply available from (3,0)
  const s = onlyOpen([[0, 1], [0, 2], [0, 3], [1, 0], [2, 0], [3, 0], [3, 1]], [0, 0], { values });
  assert.equal(key(chooseMove(s, 'normal', createRng(1))), '0,3');
});

test('Hard sees past the greedy move', () => {
  // Spark (0,1). Open: (0,0)=1 dead end; (0,2)=5 whose only reply is (1,2)=5.
  // Greedy takes (0,2) and the opponent answers with 5: net 0. Hard takes (0,0): net +1.
  const values = new Array(36).fill(1);
  values[2] = 5;
  values[8] = 5;
  const s = onlyOpen([[0, 0], [0, 2], [1, 2]], [0, 1], { values });
  assert.equal(key(chooseMove(s, 'normal', createRng(1))), '0,2');
  assert.equal(key(chooseMove(s, 'hard', createRng(1))), '0,0');
});

test('start pick: Normal takes the cell where the first player\'s best reply is smallest; Easy picks from the better half', () => {
  // All 5s except 1s on every cell a spark at (0,0) could reach: only (0,0) caps the first player at 1.
  const values = new Array(36).fill(5);
  for (const [r, c] of [[0, 1], [0, 2], [0, 3], [1, 0], [2, 0], [3, 0]]) values[r * 6 + c] = 1;
  const s = pickState(values);
  assert.equal(key(chooseMove(s, 'normal', createRng(1))), '0,0');
  assert.equal(key(chooseMove(s, 'normal', () => 0.99)), '0,0', 'Normal pick does not depend on rng');
  // Easy's picks vary with the rng...
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(key(chooseMove(createGame(i), 'easy', createRng(i))));
  assert.ok(seen.size > 10, 'Easy picks vary');
  // On a real board, Easy's picks are always in the better half by the cheap score.
  const g = createGame(21);
  const score = (r, c) => {
    let best = 0;
    for (const m of legalMoves(pickStart(g, { r, c }))) best = Math.max(best, m.value);
    return best;
  };
  const all = legalMoves(g).map((p) => score(p.r, p.c)).sort((a, b) => a - b);
  const median = all[17];
  for (let i = 0; i < 40; i++) {
    const p = chooseMove(g, 'easy', createRng(i));
    assert.ok(score(p.r, p.c) <= median, `easy pick ${key(p)} worse than the better half`);
  }
});

test('start pick: Hard picks a cell no better for the first player than Normal\'s pick (deep check)', () => {
  // Evaluate the first player's value after each AI's pick with a deep fixed-budget search.
  const firstValue = (g, p) => {
    const s = pickStart(g, p);
    const m = chooseMove(s, 'hard', createRng(1), { maxNodes: 200000 });
    let t = applyMove(s, m);
    let v = m.value;
    // play it out Hard vs Hard to get a concrete outcome for the first player
    let sign = -1;
    while (!t.over) {
      const x = chooseMove(t, 'hard', createRng(1), { maxNodes: 20000 });
      v += sign * x.value;
      sign = -sign;
      t = applyMove(t, x);
    }
    return v;
  };
  let hardBetter = 0;
  let worse = 0;
  for (let seed = 300; seed < 312; seed++) {
    const g = createGame(seed);
    const h = firstValue(g, chooseMove(g, 'hard', createRng(1)));
    const n = firstValue(g, chooseMove(g, 'normal', createRng(1)));
    if (h < n) hardBetter++;
    if (h > n) worse++;
  }
  assert.ok(hardBetter >= worse, `Hard pick better ${hardBetter}, worse ${worse}`);
});

test('strength: Hard beats Easy in at least 85% of 40 seeded games (alternating who starts)', (t) => {
  const N = 40;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    // Hard sits in seat 0 for the first half, seat 1 for the second; the first player alternates,
    // so Hard both moves first and picks the start in a quarter of the games each way.
    const hardPlayer = i < N / 2 ? 0 : 1;
    const s = playGame(1000 + i, hardPlayer === 0 ? ['hard', 'easy'] : ['easy', 'hard'], i % 2);
    if (result(s).winner === hardPlayer) wins++;
  }
  t.diagnostic(`Hard beat Easy ${wins}/${N}`);
  assert.ok(wins >= 34, `Hard won only ${wins}/${N}`);
});

test('strength: Hard beats Normal and Normal beats Easy', (t) => {
  const N = 30;
  const tally = (a, b) => {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const aPlayer = i % 2; // a sits in seat 0 then seat 1; first player alternates too
      const diffs = aPlayer === 0 ? [a, b] : [b, a];
      const r = result(playGame(2000 + i, diffs, Math.floor(i / 2) % 2));
      if (r.winner === aPlayer) w++;
    }
    return w;
  };
  const hw = tally('hard', 'normal');
  const nw = tally('normal', 'easy');
  t.diagnostic(`Hard beat Normal ${hw}/${N}, Normal beat Easy ${nw}/${N}`);
  assert.ok(hw >= 0.7 * N, 'Hard should clearly beat Normal');
  assert.ok(nw >= 0.7 * N, 'Normal should clearly beat Easy');
});

test('Hard timing: start pick and early moves stay under 300 ms', (t) => {
  // Hard stops on node budgets (deterministic), so wall time only depends on device speed.
  let worstPick = 0;
  let worstMove = 0;
  for (let seed = 0; seed < 12; seed++) {
    let s = createGame(seed);
    let t0 = performance.now();
    s = pickStart(s, chooseMove(s, 'hard', createRng(1)));
    worstPick = Math.max(worstPick, performance.now() - t0);
    for (let ply = 0; ply < 3 && !s.over; ply++) {
      t0 = performance.now();
      const m = chooseMove(s, 'hard', createRng(1));
      worstMove = Math.max(worstMove, performance.now() - t0);
      s = applyMove(s, m);
    }
  }
  t.diagnostic(
    `Hard worst start pick ${worstPick.toFixed(0)} ms (budget ${HARD_PICK_NODE_BUDGET} nodes), ` +
      `worst early move ${worstMove.toFixed(0)} ms (budget ${HARD_NODE_BUDGET} nodes)`,
  );
  assert.ok(worstPick <= 300, `start pick took ${worstPick.toFixed(1)} ms`);
  assert.ok(worstMove <= 300, `move took ${worstMove.toFixed(1)} ms`);
});

test('tiny Hard budgets still give legal actions (pick and move)', () => {
  let s = createGame(8);
  for (const maxNodes of [1, 2, 35, 36, 37]) {
    const p = chooseMove(s, 'hard', createRng(1), { maxNodes });
    assert.equal(p.type, 'pick');
    const t = pickStart(s, p);
    const m = chooseMove(t, 'hard', createRng(1), { maxNodes });
    assert.ok(legalMoves(t).some((x) => key(x) === key(m)));
  }
});

test('Hard optional time cap is honoured', () => {
  let clock = 0;
  const now = () => (clock += 1); // fake clock: 1 ms per check
  const g = createGame(0);
  const m = chooseMove(g, 'hard', createRng(1), { maxNodes: 10_000_000, maxTimeMs: 5, now });
  assert.ok(legalMoves(g).some((x) => key(x) === key(m)));
  assert.ok(clock < 50);
});

test('balance: Hard vs Hard over seeds 5000-5099 has a first-player win rate within 40-60% (D9)', (t) => {
  const N = 100;
  let first = 0;
  let second = 0;
  let draws = 0;
  for (let i = 0; i < N; i++) {
    const fp = i % 2;
    const r = result(playGame(5000 + i, ['hard', 'hard'], fp));
    if (r.draw) draws++;
    else if (r.winner === fp) first++;
    else second++;
  }
  t.diagnostic(`Hard vs Hard (production budgets): first ${first}%, second ${second}%, draw ${draws}%`);
  assert.equal(draws, 0, 'half-point komi: no draws');
  assert.ok(first >= 40 && first <= 60, `first-player win rate ${first}% is outside 40-60%`);
});
