// Shared test helpers (not a test file itself).
import { createGame, SIZE } from '../src/rules.js';

/**
 * Build a custom position as a plain (unfrozen) state object, starting from a real game.
 * @param {{ values?: number[], burned?: Array<[number, number]>, clearAll?: boolean,
 *   spark?: [number, number], toMove?: 0 | 1, scores?: [number, number] }} o
 */
export function makeState(o = {}) {
  const s = JSON.parse(JSON.stringify(createGame(1)));
  if (o.values) s.values = o.values.slice();
  if (o.clearAll) s.burned = new Array(SIZE * SIZE).fill(false);
  for (const [r, c] of o.burned ?? []) s.burned[r * SIZE + c] = true;
  if (o.spark) {
    s.spark = { r: o.spark[0], c: o.spark[1] };
    s.burned[o.spark[0] * SIZE + o.spark[1]] = true;
  }
  if (o.toMove !== undefined) s.toMove = o.toMove;
  if (o.scores) s.scores = o.scores.slice();
  return s;
}

/** Burn every cell except the listed ones (and keep the spark burned). */
export function onlyOpen(open, spark, extra = {}) {
  const burned = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!open.some(([a, b]) => a === r && b === c)) burned.push([r, c]);
    }
  }
  return makeState({ clearAll: true, burned, spark, ...extra });
}

export function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const k of Object.keys(x)) deepFreeze(x[k]);
  }
  return x;
}

export const key = (m) => `${m.r},${m.c}`;
export const keys = (ms) => ms.map(key).sort();
