// Cell accessible names (WCAG 2.5.3 label in name): every cell's visible text must be in
// its accessible name, in order, with no parentheses. Covers every phase and cell type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, step, SIZE } from '../src/rules.js';
import { HUMAN, COMPUTER, cellView, humanCanAct, phaseOf } from '../src/ui-logic.js';

// The same targets/humanToMove the page computes in render().
function viewsOf(state, thinking = false) {
  const humanToMove = humanCanAct(state, thinking);
  const targets = new Set(humanToMove ? legalMoves(state).map((m) => m.r * SIZE + m.c) : []);
  const out = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out.push(cellView(state, r, c, { targets, humanToMove }));
  return out;
}

function checkNames(views, where) {
  for (const v of views) {
    const at = `${where} ${v.kind} "${v.text}": ${v.label}`;
    assert.ok(!/[()]/.test(v.label), `no parentheses: ${at}`);
    assert.ok(!/\s{2,}|^\s|\s$|,,|, ,/.test(v.label), `tidy: ${at}`);
    if (/^[0-9]+$/.test(v.text)) {
      // The visible number comes first, as its own word: "3 points, row …".
      assert.ok(v.label.startsWith(`${v.text} point`), `visible number first: ${at}`);
      assert.match(v.label, new RegExp(`^${v.text} points?, row [1-6], column [1-6]`), at);
    } else {
      // Symbol cells: the glyph is decorative; the name explains it in words.
      assert.ok(v.kind === 'spark' || v.kind === 'burned', at);
      assert.match(v.label, v.kind === 'spark' ? /^Spark, row [1-6], column [1-6]/ : /^Burned out, row [1-6], column [1-6]/, at);
    }
  }
}

test('accessible names include the visible number first, no parentheses, in every phase and cell type', () => {
  const seen = new Set();
  for (let seed = 0; seed < 25; seed++) {
    for (const fp of [HUMAN, COMPUTER]) {
      let s = createGame(seed, { firstPlayer: fp });
      for (const thinking of [false, true]) {
        const vs = viewsOf(s, thinking);
        for (const v of vs) seen.add(`${phaseOf(s)}:${v.kind}`);
        checkNames(vs, `seed ${seed} pick`);
      }
      s = step(s, { r: seed % 6, c: (seed * 5) % 6 });
      while (s.phase !== 'over') {
        for (const thinking of [false, true]) {
          const vs = viewsOf(s, thinking);
          for (const v of vs) seen.add(`${phaseOf(s)}:${v.kind}`);
          checkNames(vs, `seed ${seed} ply ${s.history.length}`);
        }
        s = step(s, legalMoves(s)[(seed * 3) % legalMoves(s).length]);
      }
      const vs = viewsOf(s);
      for (const v of vs) seen.add(`${phaseOf(s)}:${v.kind}`);
      checkNames(vs, `seed ${seed} over`);
    }
  }
  for (const k of ['pick-start:target', 'pick-start:coal', 'play:target', 'play:coal', 'play:burned', 'play:spark', 'over:coal', 'over:burned', 'over:spark']) {
    assert.ok(seen.has(k), `covered ${k}`);
  }
  assert.ok(!seen.has('over:target'), 'no targets once the game is over');
});

test('exact wording for each cell type reads naturally', () => {
  const youPick = createGame(3, { firstPlayer: COMPUTER });
  const v0 = youPick.values[0];
  const pts = (v) => (v === 1 ? '1 point' : `${v} points`);
  assert.equal(viewsOf(youPick)[0].label, `${pts(v0)}, row 1, column 1, start the spark here, not scored`);
  const cpuPicks = createGame(3);
  assert.equal(viewsOf(cpuPicks)[0].label, `${pts(v0)}, row 1, column 1`);
  let s = step(cpuPicks, { r: 2, c: 2 });
  const t = legalMoves(s)[0];
  const tv = viewsOf(s)[t.r * SIZE + t.c];
  assert.equal(tv.label, `${pts(t.value)}, row ${t.r + 1}, column ${t.c + 1}, move here`);
  assert.equal(viewsOf(s)[2 * SIZE + 2].label, 'Spark, row 3, column 3, the computer picked this start');
  s = step(s, t);
  assert.equal(viewsOf(s)[2 * SIZE + 2].label, 'Burned out, row 3, column 3, last move started here');
  assert.equal(viewsOf(s)[t.r * SIZE + t.c].label, `Spark, row ${t.r + 1}, column ${t.c + 1}, you moved it here`);
});
