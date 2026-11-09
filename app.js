// Ember Path UI. Renders with DOM nodes and textContent only (never HTML strings).
import { createGame, legalMoves, step, isLegalMove, createRng, SIZE, MAX_SEED, KOMI } from './src/rules.js';
import { chooseMove, DIFFICULTY_LABELS } from './src/ai.js';
import {
  HUMAN, COMPUTER, parseSeed, aiSeedFor, thinkDelay, describeMove, cellView, outcome, phaseOf, formatPoints, actorOf, humanMayPick,
} from './src/ui-logic.js';

const $ = (id) => document.getElementById(id);
const ui = {
  board: $('board'), status: $('status'), turn: $('turn'),
  ptsYou: $('pts-you'), ptsCpu: $('pts-cpu'), scoreYou: $('score-you'), scoreCpu: $('score-cpu'),
  end: $('end'), endTitle: $('end-title'), endScore: $('end-score'), endHead: $('end-headstart'), endMeta: $('end-meta'),
  playAgain: $('play-again'), replaySeed: $('replay-seed'), newGame: $('new-game'), gameMeta: $('game-meta'),
  difficulty: $('difficulty'), computerFirst: $('computer-first'), pending: $('pending'),
  seedForm: $('seed-form'), seed: $('seed'), seedError: $('seed-error'),
};

/** @type {{ id: number, seed: number, difficulty: string, computerFirst: boolean, state: any } | null} */
let game = null;
let gameCount = 0;
let thinking = false;
let thinkTimer = 0;

// ---- Computer player: a module Worker keeps the search off the main thread. ----
const ai = createAiRunner();

function createAiRunner() {
  let worker = null;
  let nextId = 0;
  const pending = new Map();
  const failAll = () => {
    if (worker) worker.terminate();
    worker = null;
    for (const [id, p] of pending) {
      pending.delete(id);
      p.local();
    }
  };
  try {
    worker = new Worker(new URL('./src/ai-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e) => {
      const { id, move, error } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (error || !move || !isLegalMove(p.state, move)) p.local();
      else p.resolve(move);
    });
    worker.addEventListener('error', (e) => {
      e.preventDefault();
      failAll();
    });
  } catch {
    worker = null; // very old browser: compute on the main thread instead
  }
  return {
    choose(state, difficulty, rngSeed) {
      return new Promise((resolve, reject) => {
        const local = () => {
          try {
            const m = chooseMove(state, difficulty, createRng(rngSeed));
            resolve(m && { r: m.r, c: m.c });
          } catch (err) {
            reject(err);
          }
        };
        if (!worker) {
          local();
          return;
        }
        const id = ++nextId;
        const p = { state, resolve, local, timer: 0 };
        // If the worker never answers (blocked or broken), fall back after 3 s.
        p.timer = setTimeout(() => {
          if (pending.delete(id)) local();
        }, 3000);
        pending.set(id, p);
        worker.postMessage({ id, state, difficulty, rngSeed });
      });
    },
  };
}

// ---- Board: 36 buttons built once, then updated in place so focus is kept. ----
const cells = [];
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.dataset.r = String(r);
    b.dataset.c = String(c);
    ui.board.append(b);
    cells.push(b);
  }
}

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % (MAX_SEED + 1);
}

function settings() {
  return { difficulty: ui.difficulty.value, computerFirst: ui.computerFirst.checked };
}

function stopThinking() {
  clearTimeout(thinkTimer);
  thinkTimer = 0;
  thinking = false;
}

function startGame(seed) {
  stopThinking();
  const { difficulty, computerFirst } = settings();
  game = {
    id: ++gameCount,
    seed,
    difficulty,
    computerFirst,
    state: createGame(seed, { firstPlayer: computerFirst ? COMPUTER : HUMAN }),
  };
  ui.seed.value = String(seed);
  showSeedError('');
  ui.end.hidden = true;
  const intro = `New game, ${DIFFICULTY_LABELS[difficulty]}, seed ${seed}.`;
  const head = formatPoints(KOMI);
  if (actorOf(game.state) === COMPUTER) computerTurn(`${intro} You move first, so the computer picks where the spark starts and begins with ${head} points.`);
  else render(`${intro} Pick where the spark starts: tap any cell. It burns and scores nothing, and you begin with ${head} points. Then the computer moves first.`);
}

async function computerTurn(prefix) {
  const g = game;
  const state = g.state;
  thinking = true;
  const what = phaseOf(state) === 'pick-start' ? 'Computer is thinking about where to start the spark…' : 'Computer is thinking…';
  render(`${prefix} ${what}`);
  const delay = thinkDelay(Math.random());
  const t0 = performance.now();
  // Let the browser paint the thinking state before any search runs (matters for the
  // main-thread fallback, where Hard's start pick can take over half a second on a phone).
  await nextPaint();
  if (game !== g || g.state !== state || !thinking) return;
  let move;
  try {
    move = await ai.choose(state, g.difficulty, aiSeedFor(g.seed, state.history.length));
  } catch (err) {
    if (game !== g || g.state !== state) return;
    thinking = false;
    render('Sorry, the computer hit an error. Start a new game to keep playing.');
    console.error(err);
    return;
  }
  // A new game may have started while the computer was thinking: drop the stale move.
  if (game !== g || g.state !== state || !thinking) return;
  thinkTimer = setTimeout(() => {
    thinkTimer = 0;
    if (game !== g || g.state !== state || !thinking) return;
    thinking = false;
    g.state = step(state, move);
    afterMove();
  }, Math.max(0, delay - (performance.now() - t0)));
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function afterMove() {
  const s = game.state;
  const said = describeMove(s.history[s.history.length - 1]);
  if (phaseOf(s) === 'over') {
    render(said);
    showEnd();
  } else if (actorOf(s) === COMPUTER) {
    computerTurn(said);
  } else {
    const n = legalMoves(s).length;
    render(`${said} Your turn: ${n} ${n === 1 ? 'cell is' : 'cells are'} outlined.`);
  }
}

function onCellClick(e) {
  const btn = e.target instanceof Element ? e.target.closest('.cell') : null;
  if (!btn || !game) return;
  const s = game.state;
  if (phaseOf(s) === 'over') {
    say('The game is over. Tap Play again for a new board.');
    return;
  }
  if (thinking || actorOf(s) !== HUMAN) {
    say(thinking ? 'Hold on, the computer is still thinking.' : "It isn't your turn.");
    return;
  }
  if (phaseOf(s) === 'pick-start' && !humanMayPick(s)) {
    say("You don't pick the start in this game: the player who moves second does.");
    return;
  }
  const move = { r: Number(btn.dataset.r), c: Number(btn.dataset.c) };
  if (!isLegalMove(s, move)) {
    const i = move.r * SIZE + move.c;
    if (s.spark.r === move.r && s.spark.c === move.c) say('That is where the spark is now. Tap an outlined cell.');
    else if (s.burned[i]) say('That cell has burned out. Tap an outlined cell.');
    else say("The spark can't reach that cell. It moves 1 to 3 cells in a straight line, without crossing burned cells. Tap an outlined cell.");
    return;
  }
  game.state = step(s, move);
  afterMove();
}

function say(text) {
  // Re-set even when the text is the same so screen readers announce it again.
  ui.status.textContent = '';
  ui.status.textContent = text;
}

function render(message) {
  const s = game.state;
  const phase = phaseOf(s);
  const over = phase === 'over';
  const actor = actorOf(s);
  const humanToMove = !over && !thinking && actor === HUMAN && (phase !== 'pick-start' || humanMayPick(s));
  const targets = new Set(humanToMove ? legalMoves(s).map((m) => m.r * SIZE + m.c) : []);
  for (const b of cells) {
    const r = Number(b.dataset.r);
    const c = Number(b.dataset.c);
    const v = cellView(s, r, c, { targets, humanToMove });
    b.textContent = v.text;
    b.setAttribute('aria-label', v.label);
    b.dataset.kind = v.kind;
    b.dataset.v = v.kind === 'coal' || v.kind === 'target' ? v.text : '';
    b.classList.toggle('last-from', v.lastFrom);
    b.classList.toggle('last-to', v.kind === 'spark' && s.history.length > 0);
    const usable = v.kind === 'target';
    b.tabIndex = usable ? 0 : -1;
    if (usable) b.removeAttribute('aria-disabled');
    else b.setAttribute('aria-disabled', 'true');
  }
  ui.board.classList.toggle('your-turn', humanToMove && phase === 'play');
  ui.board.classList.toggle('picking', humanToMove && phase === 'pick-start');
  ui.board.classList.toggle('locked', !humanToMove);
  ui.board.setAttribute('aria-busy', thinking ? 'true' : 'false');
  ui.ptsYou.textContent = formatPoints(s.scores[HUMAN]);
  ui.ptsCpu.textContent = formatPoints(s.scores[COMPUTER]);
  ui.scoreYou.classList.toggle('active', actor === HUMAN);
  ui.scoreCpu.classList.toggle('active', actor === COMPUTER);
  ui.turn.textContent = over
    ? 'Game over'
    : thinking
      ? 'Thinking…'
      : actor !== HUMAN
        ? 'Computer'
        : phase === 'pick-start'
          ? 'Pick start'
          : 'Your turn';
  ui.turn.classList.toggle('thinking', thinking);
  const first = game.computerFirst ? 'computer moves first · you pick the start' : 'you move first · computer picks the start';
  ui.gameMeta.textContent = `Seed ${game.seed} · ${DIFFICULTY_LABELS[game.difficulty]} · ${first}`;
  updatePending();
  if (message !== undefined) say(message);
}

function showEnd() {
  const o = outcome(game.state);
  const [you, cpu] = [game.state.scores[HUMAN], game.state.scores[COMPUTER]];
  ui.end.dataset.kind = o.kind;
  ui.endTitle.textContent = o.title;
  ui.endScore.textContent = o.scoreLine;
  ui.endHead.textContent = o.headStartLine;
  const moves = game.state.history.filter((h) => h.from).length;
  ui.endMeta.textContent = `Seed ${game.seed} · ${DIFFICULTY_LABELS[game.difficulty]} · ${moves} moves`;
  ui.end.hidden = false;
  const short = o.kind === 'win' ? 'You win' : o.kind === 'lose' ? 'The computer wins' : "It's a draw";
  say(`Game over. ${short}, ${formatPoints(Math.max(you, cpu))} to ${formatPoints(Math.min(you, cpu))}.`);
  ui.endTitle.focus({ preventScroll: true });
  ui.end.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function updatePending() {
  const s = settings();
  ui.pending.hidden = !game || (s.difficulty === game.difficulty && s.computerFirst === game.computerFirst);
}

function showSeedError(msg) {
  ui.seedError.textContent = msg;
  if (msg) ui.seed.setAttribute('aria-invalid', 'true');
  else ui.seed.removeAttribute('aria-invalid');
}

ui.board.addEventListener('click', onCellClick);
ui.newGame.addEventListener('click', () => startGame(randomSeed()));
ui.playAgain.addEventListener('click', () => startGame(randomSeed()));
ui.replaySeed.addEventListener('click', () => startGame(game.seed));
ui.difficulty.addEventListener('change', updatePending);
ui.computerFirst.addEventListener('change', updatePending);
ui.seed.addEventListener('input', () => showSeedError(''));
ui.seedForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const p = parseSeed(ui.seed.value);
  if (!p.ok) {
    showSeedError(p.error);
    ui.seed.focus();
    return;
  }
  startGame(p.seed);
});

startGame(randomSeed());
