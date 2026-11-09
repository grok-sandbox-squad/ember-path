import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createRng, legalMoves, applyMove, result, LAST_MOVE_BONUS, SIZE } from '../src/rules.js';

// Thousands of seeded games with random legal moves; check invariants after every move.
const GAMES = 3000;

test(`fuzz: ${GAMES} random games keep every invariant`, (t) => {
  let totalMoves = 0;
  let shortest = Infinity;
  let longest = 0;
  let draws = 0;
  for (let g = 0; g < GAMES; g++) {
    const seed = (g * 2654435761) >>> 0;
    const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
    let s = createGame(seed, { firstPlayer: g % 2 });
    const landed = [0, 0];
    let steps = 0;
    while (!s.over) {
      const ms = legalMoves(s);
      assert.ok(ms.length > 0, 'a running game always has a move');
      for (const m of ms) {
        assert.ok(m.dist >= 1 && m.dist <= 3);
        assert.ok(m.r === s.spark.r || m.c === s.spark.c);
        assert.equal(s.burned[m.r * SIZE + m.c], false);
      }
      const m = ms[Math.floor(rng() * ms.length)];
      const next = applyMove(s, m);
      // scores never decrease, burned cells never un-burn, exactly one new burn
      assert.ok(next.scores[0] >= s.scores[0] && next.scores[1] >= s.scores[1]);
      let newBurns = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (s.burned[i]) assert.equal(next.burned[i], true);
        else if (next.burned[i]) newBurns++;
      }
      assert.equal(newBurns, 1);
      assert.notEqual(next.toMove, s.toMove);
      landed[s.toMove] += m.value;
      s = next;
      steps++;
      assert.ok(steps <= SIZE * SIZE - 1, 'game must terminate within 35 moves');
    }
    // total = landings + bonus to the last mover
    const last = s.history.at(-1).player;
    assert.deepEqual(s.bonus, { player: last, points: LAST_MOVE_BONUS });
    const expected = landed.slice();
    expected[last] += LAST_MOVE_BONUS;
    assert.deepEqual(s.scores, expected);
    assert.equal(s.history.length, steps);
    assert.deepEqual(legalMoves(s), []);
    const r = result(s);
    if (r.draw) draws++;
    else assert.ok(s.scores[r.winner] > s.scores[1 - r.winner]);
    totalMoves += steps;
    shortest = Math.min(shortest, steps);
    longest = Math.max(longest, steps);
  }
  assert.ok(shortest >= 2, 'no instant dead games');
  t.diagnostic(
    `random play: avg ${(totalMoves / GAMES).toFixed(1)} moves, shortest ${shortest}, longest ${longest}, draws ${((100 * draws) / GAMES).toFixed(1)}%`,
  );
});
