// UI checks without a DOM: static scans of the page files plus the pure helpers in src/ui-logic.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, legalMoves, step, MAX_SEED, SIZE, KOMI } from '../src/rules.js';
import {
  HUMAN, COMPUTER, parseSeed, aiSeedFor, thinkDelay, THINK_MIN_MS, THINK_MAX_MS,
  describeMove, stepOf, cellView, outcome, placeName, phaseOf, formatPoints, headStartText, secondPlayer, actorOf, humanMayPick, humanCanAct, turnView, introText, NOT_YOUR_PICK, nextFocusTarget,
} from '../src/ui-logic.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const SCRIPT_FILES = ['app.js', 'src/ui-logic.js', 'src/ai-worker.js', 'src/settings.js'];
const PAGE_FILES = ['index.html', 'app.css', ...SCRIPT_FILES];

test('page files never use HTML-string sinks or eval', () => {
  for (const file of PAGE_FILES) {
    const src = read(file);
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setTimeout("', "setTimeout('"]) {
      assert.ok(!src.includes(sink), `${file} must not use ${sink}`);
    }
  }
});

test('no external URLs, network calls, fonts or analytics', () => {
  for (const file of PAGE_FILES) {
    const src = read(file);
    assert.ok(!/\b(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(src), `${file} must not contain external URLs`);
    assert.ok(!/@import|@font-face/i.test(src), `${file} must not load CSS resources`);
    if (!file.endsWith('.js')) assert.ok(!/\burl\(/i.test(src), `${file} must not reference url(...) resources`);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // JSDoc types use import('...')
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(/.test(code), `${file} must not make network requests`);
    assert.ok(!/gtag|analytics|googletag|plausible|umami/i.test(src), `${file} must not include tracking`);
  }
  const html = read('index.html');
  const refs = [...html.matchAll(/<(script|link|img|iframe|source)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)];
  assert.ok(refs.length >= 3, 'expected favicon, app.css and app.js');
  for (const [, tag, url] of refs) {
    if (url === 'data:,') continue; // empty favicon: avoids a /favicon.ico request
    assert.match(url, /^(?![a-z][a-z0-9+.-]*:|\/)/i, `<${tag}> must use a relative path, got ${url}`);
  }
  assert.match(html, /<link rel="icon" href="data:,">/);
});

test('Content-Security-Policy blocks external loads', () => {
  const html = read('index.html');
  const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, 'CSP meta tag missing');
  const csp = m[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/, 'no unsafe-inline / unsafe-eval for scripts');
  assert.ok(!/unsafe-inline|unsafe-eval|\*|https?:/.test(csp), `CSP too loose: ${csp}`);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(!/<script>|<style>|\son[a-z]+=|style="/i.test(html), 'no inline scripts, styles or handlers (CSP blocks them)');
});

test('scripts import only relative modules', () => {
  for (const file of SCRIPT_FILES) {
    const src = read(file);
    const imports = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const spec of imports) assert.match(spec, /^\.\.?\//, `${file} imports ${spec}`);
  }
  assert.match(read('app.js'), /new URL\('\.\/src\/ai-worker\.js', import\.meta\.url\)/, 'worker path must be relative');
});

test('every form control in index.html has a label', () => {
  const html = read('index.html');
  const controls = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)];
  assert.ok(controls.length >= 3);
  for (const [tag, , attrs] of controls) {
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    const aria = /\baria-label(ledby)?="/.test(attrs);
    assert.ok(aria || (id && html.includes(`<label for="${id}"`)), `unlabeled control: ${tag}`);
  }
  for (const v of ['easy', 'normal', 'hard']) assert.match(html, new RegExp(`<option value="${v}"`));
  assert.match(html, /<option value="normal" selected>Normal<\/option>/, 'Normal is the default');
  assert.ok(!/medium/i.test(html + read('app.js') + read('README.md')), 'the middle level is called Normal, never Medium');
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /name="viewport"/);
});

test('app.js keeps stale computer moves out of a new game', () => {
  const js = read('app.js');
  // The guard compares the game and state captured before thinking with the current ones.
  assert.match(js, /if \(game !== g \|\| g\.state !== state \|\| !thinking\) return;/);
  assert.match(js, /clearTimeout\(thinkTimer\)/);
});

test('parseSeed accepts whole numbers 0..MAX_SEED', () => {
  assert.deepEqual(parseSeed('0'), { ok: true, seed: 0 });
  assert.deepEqual(parseSeed('42'), { ok: true, seed: 42 });
  assert.deepEqual(parseSeed('  42\t'), { ok: true, seed: 42 });
  assert.deepEqual(parseSeed('007'), { ok: true, seed: 7 });
  assert.deepEqual(parseSeed('0000000000000123'), { ok: true, seed: 123 });
  assert.deepEqual(parseSeed(String(MAX_SEED)), { ok: true, seed: MAX_SEED });
});

test('parseSeed rejects bad input with a friendly message and never throws', () => {
  const cases = {
    '': /Enter a seed/,
    '   ': /Enter a seed/,
    '-1': /negative/,
    '\u22125': /negative/,
    '-0': /negative/,
    '1.5': /whole number/,
    '1,000': /whole number/,
    '3.': /whole number/,
    '12 34': /spaces/,
    abc: /digits/,
    '1e3': /digits/,
    '0x10': /digits/,
    '+7': /digits/,
    'Infinity': /digits/,
    NaN: /digits/,
    '\uff11\uff12': /digits/, // full-width digits
    '4294967296': /too big/,
    '99999999999999999999999': /too big/,
  };
  for (const [input, re] of Object.entries(cases)) {
    const r = parseSeed(input);
    assert.equal(r.ok, false, `should reject ${JSON.stringify(input)}`);
    assert.match(r.error, re, `message for ${JSON.stringify(input)}`);
    assert.ok(!/NaN|undefined|null/.test(r.error), r.error);
  }
  for (const v of [undefined, null, 5, {}, []]) assert.equal(parseSeed(v).ok, false);
});

test('aiSeedFor is a valid seed and differs per move', () => {
  const seen = new Set();
  for (const seed of [0, 1, 12345, MAX_SEED]) {
    for (let ply = 0; ply < 40; ply++) {
      const s = aiSeedFor(seed, ply);
      assert.ok(Number.isInteger(s) && s >= 0 && s <= MAX_SEED);
      seen.add(`${seed}:${s}`);
    }
  }
  assert.equal(seen.size, 160);
  assert.equal(aiSeedFor(9, 3), aiSeedFor(9, 3));
});

test('thinkDelay stays in 400-700 ms even for odd input', () => {
  for (const u of [0, 0.5, 0.999999, -1, 1, NaN, Infinity, undefined]) {
    const d = thinkDelay(u);
    assert.ok(Number.isInteger(d) && d >= THINK_MIN_MS && d <= THINK_MAX_MS, `${u} -> ${d}`);
  }
  assert.equal(thinkDelay(0), 400);
  assert.equal(thinkDelay(0.999999), 700);
});

test('formatPoints shows whole and half points cleanly', () => {
  const cases = [[0, '0'], [1.5, '1.5'], [3, '3'], [12.5, '12.5'], [40, '40'], [0.1 + 1.4, '1.5'], [NaN, '0'], [Infinity, '0'], [undefined, '0']];
  for (const [n, want] of cases) assert.equal(formatPoints(n), want, String(n));
  assert.equal(formatPoints(KOMI), '1.5');
});

test('index.html and README state the same head start as the rules', () => {
  const k = formatPoints(KOMI);
  assert.ok(read('index.html').includes(`begins with ${k} points; there's no end bonus`));
  assert.ok(read('README.md').includes(`The second player picks where the spark starts and begins with ${k} points; there's no end bonus.`));
  for (const f of ['index.html', 'app.js', 'README.md', 'src/ui-logic.js']) {
    assert.ok(!/\+3|last[- ]spark|LAST_MOVE_BONUS/i.test(read(f)), `${f} still mentions the old +3 bonus`);
  }
});

test('phaseOf follows the game from start pick to the end', () => {
  let s = createGame(5);
  assert.equal(phaseOf(s), 'pick-start');
  assert.equal(secondPlayer(s), COMPUTER); // human moves first by default, so the computer picks
  assert.equal(secondPlayer(createGame(5, { firstPlayer: COMPUTER })), HUMAN);
  s = step(s, { r: 0, c: 0 });
  assert.equal(phaseOf(s), 'play');
  while (s.phase !== 'over') s = step(s, legalMoves(s)[0]);
  assert.equal(phaseOf(s), 'over');
});

test('only the real second player may pick the start, even in a tampered state', () => {
  const tamper = (st, patch) => ({ ...JSON.parse(JSON.stringify(st)), ...patch });
  // You move first: the computer picks; you may not.
  const youFirst = createGame(42, { firstPlayer: HUMAN });
  assert.equal(actorOf(youFirst), COMPUTER);
  assert.equal(humanMayPick(youFirst), false);
  // Computer moves first: you pick.
  const cpuFirst = createGame(42, { firstPlayer: COMPUTER });
  assert.equal(actorOf(cpuFirst), HUMAN);
  assert.equal(humanMayPick(cpuFirst), true);
  // Tampered: toMove points at the first mover during pick-start. Nobody may act.
  const bad1 = tamper(youFirst, { toMove: HUMAN });
  assert.equal(humanMayPick(bad1), false);
  assert.equal(actorOf(bad1), null);
  const bad2 = tamper(cpuFirst, { toMove: COMPUTER });
  assert.equal(humanMayPick(bad2), false);
  assert.equal(actorOf(bad2), null);
  // Tampered firstPlayer / toMove values.
  for (const patch of [{ firstPlayer: 2 }, { firstPlayer: undefined }, { toMove: -1 }, { toMove: '0' }]) {
    assert.equal(humanMayPick(tamper(cpuFirst, patch)), false, JSON.stringify(patch));
    assert.equal(actorOf(tamper(cpuFirst, patch)), null, JSON.stringify(patch));
  }
  for (const v of [null, undefined, 5, 'x']) assert.equal(actorOf(v), null);
  // After the pick and in play, the player to move acts; at the end nobody does.
  let s = step(cpuFirst, { r: 0, c: 0 });
  assert.equal(actorOf(s), COMPUTER);
  assert.equal(humanMayPick(s), false);
  while (s.phase !== 'over') s = step(s, legalMoves(s)[0]);
  assert.equal(actorOf(s), null);
});

test('app.js gates pick taps on humanMayPick and paints "thinking" before the search', () => {
  const js = read('app.js');
  assert.match(js, /if \(phaseOf\(s\) === 'pick-start' && !humanMayPick\(s\)\)/);
  assert.match(js, /if \(thinking\) \{\n    say\('Hold on/);
  assert.match(js, /if \(!humanCanAct\(s, thinking\)\)/);
  const fn = js.slice(js.indexOf('async function computerTurn'));
  const think = fn.indexOf('thinking = true;');
  const draw = fn.indexOf('render(prefix);');
  const paint = fn.indexOf('await nextPaint();');
  const choose = fn.indexOf('await ai.choose(');
  assert.ok(think >= 0 && draw > think && paint > draw && choose > paint, 'set thinking, render, yield a frame, then search');
  assert.match(js, /requestAnimationFrame\(\(\) => setTimeout\(resolve, 0\)\)/);
  assert.ok(!/\.toMove\b/.test(js), 'app.js must use actorOf(), not state.toMove directly');
});

test('describeMove reads naturally for the start pick and for moves', () => {
  const g = createGame(7);
  const picked = step(g, { r: 1, c: 4 });
  assert.equal(describeMove(picked.history[0]), 'Computer started the spark at row 2, column 5.');
  const m = legalMoves(picked).find((x) => x.dist === 2) ?? legalMoves(picked)[0];
  const s = step(picked, m);
  const e = s.history[1];
  assert.deepEqual(stepOf(e), { dir: m.dir, dist: m.dist });
  assert.equal(describeMove(e), `You moved ${m.dir} ${m.dist} and scored ${m.value} point${m.value === 1 ? '' : 's'}.`);
  assert.equal(describeMove({ player: COMPUTER, from: { r: 2, c: 2 }, to: { r: 2, c: 0 }, value: 1 }), 'Computer moved left 2 and scored 1 point.');
});

test('cellView during the start pick: every cell is a target for the picker, numbers shown', () => {
  const g = createGame(11, { firstPlayer: COMPUTER }); // human picks
  const targets = new Set(legalMoves(g).map((m) => m.r * SIZE + m.c));
  assert.equal(targets.size, 36);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = cellView(g, r, c, { targets, humanToMove: true });
      assert.equal(v.kind, 'target');
      assert.equal(v.text, String(g.values[r * SIZE + c]));
      assert.match(v.label, /^\d points?, row \d, column \d, start the spark here, not scored$/);
    }
  }
  assert.equal(cellView(g, 0, 0, { targets, humanToMove: false }).kind, 'coal');
});

test('cellView in play marks spark, burned, targets and plain coals with text, not just colour', () => {
  let g = step(createGame(11), { r: 2, c: 2 });
  const targets = new Set(legalMoves(g).map((m) => m.r * SIZE + m.c));
  const kinds = { spark: 0, burned: 0, target: 0, coal: 0 };
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = cellView(g, r, c, { targets, humanToMove: true });
      kinds[v.kind]++;
      assert.ok(v.text.length > 0 && v.label.includes(placeName(r, c)));
      if (v.kind === 'target') assert.match(v.label, /^\d points?, row \d, column \d, move here/);
      if (v.kind === 'coal' || v.kind === 'target') assert.equal(v.text, String(g.values[r * SIZE + c]));
    }
  }
  assert.deepEqual(kinds, { spark: 1, burned: 0, target: targets.size, coal: 35 - targets.size });
  assert.match(cellView(g, 2, 2, { targets, humanToMove: true }).label, /^Spark, .*the computer picked this start/);
  const [t0] = targets;
  assert.equal(cellView(g, (t0 / SIZE) | 0, t0 % SIZE, { targets, humanToMove: false }).kind, 'coal');
  // After a move the old spark cell is burned and labelled as the last move's start.
  g = step(g, legalMoves(g)[0]);
  const old = cellView(g, 2, 2, { targets: new Set(), humanToMove: false });
  assert.equal(old.kind, 'burned');
  assert.equal(old.text, '\u00D7');
  assert.ok(old.lastFrom && /last move started here/.test(old.label));
  assert.match(cellView(g, g.spark.r, g.spark.c, { targets: new Set(), humanToMove: false }).label, /^Spark, .*you moved it here/);
});

function playOut(seed, firstPlayer, pickCell = { r: 0, c: 0 }) {
  let s = step(createGame(seed, { firstPlayer }), pickCell);
  while (s.phase !== 'over') s = step(s, legalMoves(s)[0]);
  return s;
}

test('outcome: win or lose with half-point scores, the head start explained, no draws', () => {
  assert.equal(outcome(createGame(3)), null);
  const kinds = new Set();
  for (let seed = 0; seed < 40; seed++) {
    for (const fp of [HUMAN, COMPUTER]) {
      const s = playOut(seed, fp, { r: seed % 6, c: (seed * 5) % 6 });
      const o = outcome(s);
      kinds.add(o.kind);
      assert.notEqual(o.kind, 'draw');
      assert.equal(o.kind === 'win', s.scores[HUMAN] > s.scores[COMPUTER]);
      assert.equal(o.scoreLine, `Final score: you ${formatPoints(s.scores[HUMAN])}, computer ${formatPoints(s.scores[COMPUTER])}.`);
      assert.ok(!/NaN|undefined|\.0\b|\.5\d/.test(o.scoreLine), o.scoreLine);
      assert.equal(o.headStartLine, headStartText(s));
      assert.match(o.headStartLine, fp === HUMAN ? /^The computer picked the start and began with 1\.5 points\.$/ : /^You picked the start and began with 1\.5 points\.$/);
    }
  }
  assert.deepEqual([...kinds].sort(), ['lose', 'win']);
});

// ---- Polish PR: turn label, status copy ----

function statesAlongAGame(seed, firstPlayer) {
  const out = [];
  let s = createGame(seed, { firstPlayer });
  out.push(s);
  s = step(s, { r: seed % 6, c: (seed * 7) % 6 });
  out.push(s);
  while (s.phase !== 'over') {
    s = step(s, legalMoves(s)[seed % legalMoves(s).length]);
    out.push(s);
  }
  return out;
}

test('turn label says "Your …" exactly when the board accepts a tap, never while the computer acts', () => {
  let checked = 0;
  for (let seed = 0; seed < 30; seed++) {
    for (const fp of [HUMAN, COMPUTER]) {
      for (const s of statesAlongAGame(seed, fp)) {
        for (const thinking of [false, true]) {
          const tv = turnView(s, thinking);
          const can = humanCanAct(s, thinking);
          assert.equal(tv.who === 'human', can);
          if (thinking) {
            assert.notEqual(tv.who, 'human', 'never "Your turn" while thinking');
            if (s.phase !== 'over') assert.match(tv.text, /^Computer is (thinking|picking the start)…$/);
          }
          if (actorOf(s) === COMPUTER) assert.ok(tv.who === 'computer' && /^Computer/.test(tv.text), tv.text);
          if (s.phase === 'over') assert.deepEqual(tv, { who: 'none', text: '' });
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000);
});

test('turn label copy for each situation', () => {
  const cpuPicks = createGame(1); // you move first
  assert.deepEqual(turnView(cpuPicks, true), { who: 'computer', text: 'Computer is picking the start…' });
  assert.deepEqual(turnView(cpuPicks, false), { who: 'computer', text: "Computer's turn" });
  const youPick = createGame(1, { firstPlayer: COMPUTER });
  assert.deepEqual(turnView(youPick, false), { who: 'human', text: 'Your pick: tap any cell' });
  // Even if thinking were left on by mistake during your pick, it's not shown as your turn.
  assert.equal(turnView(youPick, true).who, 'computer');
  const afterPick = step(cpuPicks, { r: 0, c: 0 });
  assert.deepEqual(turnView(afterPick, false), { who: 'human', text: 'Your turn' });
  const cpuMoves = step(afterPick, legalMoves(afterPick)[0]);
  assert.deepEqual(turnView(cpuMoves, true), { who: 'computer', text: 'Computer is thinking…' });
  // Tampered: toMove points at the first mover during the pick. Nobody may act.
  const bad = { ...JSON.parse(JSON.stringify(cpuPicks)), toMove: HUMAN };
  assert.equal(humanCanAct(bad, false), false);
  assert.deepEqual(turnView(bad, false), { who: 'none', text: '' });
});

test('status copy is short and plain', () => {
  const a = introText(createGame(1), 'Hard');
  const b = introText(createGame(1, { firstPlayer: COMPUTER }), 'Easy');
  assert.equal(a, 'New Hard game. The computer picks the start and gets 1.5 points.');
  assert.equal(b, 'New Easy game. Tap any cell to start the spark there. It scores nothing, but you get 1.5 points.');
  assert.equal(NOT_YOUR_PICK, "Only the second player picks the start, and here that's the computer.");
  for (const t of [a, b, NOT_YOUR_PICK]) assert.ok(t.length <= 100, `${t.length}: ${t}`);
  for (let seed = 0; seed < 10; seed++) {
    for (const s of statesAlongAGame(seed, HUMAN).slice(1)) {
      const line = describeMove(s.history[s.history.length - 1]);
      assert.ok(line.length <= 50, line);
      assert.ok(!/NaN|undefined/.test(line), line);
    }
  }
  const js = read('app.js');
  assert.ok(!/You don't pick the start/.test(js));
  assert.equal((js.match(/Game over/g) || []).length, 1, '"Game over" appears once (status line); the card shows the result');
});

test('settings controls cannot silently disagree with the game', () => {
  const html = read('index.html');
  assert.match(html, /<select id="difficulty" autocomplete="off">/, 'no form-state restore on reload/back');
  assert.match(html, /<input type="checkbox" id="computer-first" autocomplete="off">/);
  const js = read('app.js');
  for (const ev of ["'pageshow', syncControls", "'load', syncControls"]) assert.ok(js.includes(ev), ev);
  assert.match(js, /This game: \$\{DIFFICULTY_LABELS\[game\.difficulty\]\}/);
});

test('nextFocusTarget moves off a dead cell onto the first playable one', () => {
  assert.equal(nextFocusTarget({
    focusOnBoard: true, focusOnPlayable: false, focusOnBody: false, boardHadFocus: true,
    hasPlayable: true, gameOver: false,
  }), 'first-playable');
  // Lost to body after a move that took the cell out of the tab order.
  assert.equal(nextFocusTarget({
    focusOnBoard: false, focusOnPlayable: false, focusOnBody: true, boardHadFocus: true,
    hasPlayable: true, gameOver: false,
  }), 'first-playable');
});

test('nextFocusTarget leaves focus alone when it is already on a playable cell or elsewhere', () => {
  assert.equal(nextFocusTarget({
    focusOnBoard: true, focusOnPlayable: true, focusOnBody: false, boardHadFocus: true,
    hasPlayable: true, gameOver: false,
  }), null);
  // User is in settings / seed field / New game: do not steal.
  assert.equal(nextFocusTarget({
    focusOnBoard: false, focusOnPlayable: false, focusOnBody: false, boardHadFocus: false,
    hasPlayable: true, gameOver: false,
  }), null);
  // Fresh page load: focus on body, never on the board yet.
  assert.equal(nextFocusTarget({
    focusOnBoard: false, focusOnPlayable: false, focusOnBody: true, boardHadFocus: false,
    hasPlayable: true, gameOver: false,
  }), null);
});

test('nextFocusTarget at game over goes to the result heading (or New game)', () => {
  assert.equal(nextFocusTarget({
    focusOnBoard: true, focusOnPlayable: false, focusOnBody: false, boardHadFocus: true,
    hasPlayable: false, gameOver: true,
  }), 'result');
  assert.equal(nextFocusTarget({
    focusOnBoard: true, focusOnPlayable: false, focusOnBody: false, boardHadFocus: true,
    hasPlayable: false, gameOver: true, hasResultHeading: false,
  }), 'new-game');
  // During the computer's thinking there are no playable cells, but it is not game over: leave alone.
  assert.equal(nextFocusTarget({
    focusOnBoard: true, focusOnPlayable: false, focusOnBody: false, boardHadFocus: true,
    hasPlayable: false, gameOver: false,
  }), null);
});

test('nextFocusTarget ignores bad input', () => {
  assert.equal(nextFocusTarget(null), null);
  assert.equal(nextFocusTarget(undefined), null);
  assert.equal(nextFocusTarget(0), null);
});

test('app.js restores board focus after a move and capitalizes the pending note', () => {
  const js = read('app.js');
  assert.match(js, /nextFocusTarget/);
  assert.match(js, /restoreBoardFocus/);
  assert.match(js, /boardHadFocus/);
  assert.match(js, /charAt\(0\)\.toUpperCase\(\)/);
  // Pending parts that would otherwise start lowercase get a capital first letter.
  assert.match(js, /computer moves first/);
});

test('checkbox paints at a real 24x24 box across engines', () => {
  const css = read('app.css');
  assert.match(css, /input\[type="checkbox"\]/);
  assert.match(css, /appearance:\s*none/);
  assert.match(css, /width:\s*24px/);
  assert.match(css, /height:\s*24px/);
  assert.match(css, /min-width:\s*24px/);
  assert.match(css, /min-height:\s*24px/);
  assert.match(css, /flex:\s*0 0 24px/);
});
