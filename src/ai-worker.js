// Runs the computer's move search off the main thread so the page stays responsive.
// Message in:  { id, state, difficulty, rngSeed }
// Message out: { id, move: { r, c } | null } or { id, error }
import { chooseMove } from './ai.js';
import { createRng } from './rules.js';

self.onmessage = (event) => {
  const { id, state, difficulty, rngSeed } = event.data || {};
  try {
    const m = chooseMove(state, difficulty, createRng(rngSeed));
    self.postMessage({ id, move: m ? { r: m.r, c: m.c } : null });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
