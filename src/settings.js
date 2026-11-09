// Remembered settings (difficulty and who moves first) in localStorage.
// Only these two values are stored, under one namespaced key. Everything read back is
// validated field by field; anything odd falls back to the default for that field.
// Storage that is missing or throws (private mode, quota, SecurityError) never breaks the game.
import { DIFFICULTIES } from './ai.js';

export const SETTINGS_KEY = 'ember-path:settings:v1';
export const DEFAULT_SETTINGS = Object.freeze({ difficulty: 'normal', computerFirst: false });
/** Anything longer than this is not something we wrote, so it is ignored without parsing. */
export const MAX_STORED_LENGTH = 200;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Parse a stored value. Never throws.
 * Field by field: a valid difficulty or computerFirst is kept even if the other field is bad.
 * Extra keys (including "__proto__" or "constructor") are ignored and never copied.
 * @param {unknown} raw  what storage.getItem returned
 * @returns {{ settings: { difficulty: string, computerFirst: boolean }, problems: string[] }}
 */
export function parseSettings(raw) {
  const problems = [];
  let difficulty = DEFAULT_SETTINGS.difficulty;
  let computerFirst = DEFAULT_SETTINGS.computerFirst;
  const done = () => ({ settings: { difficulty, computerFirst }, problems });
  if (raw === null || raw === undefined) {
    problems.push('missing');
    return done();
  }
  if (typeof raw !== 'string') {
    problems.push('not a string');
    return done();
  }
  if (raw.length > MAX_STORED_LENGTH) {
    problems.push('too long');
    return done();
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    problems.push('bad JSON');
    return done();
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    problems.push('not an object');
    return done();
  }
  if (own(data, 'difficulty') && typeof data.difficulty === 'string' && DIFFICULTIES.includes(data.difficulty)) {
    difficulty = data.difficulty;
  } else {
    problems.push('difficulty');
  }
  if (own(data, 'computerFirst') && typeof data.computerFirst === 'boolean') {
    computerFirst = data.computerFirst;
  } else {
    problems.push('computerFirst');
  }
  for (const k of Object.keys(data)) if (k !== 'difficulty' && k !== 'computerFirst') problems.push(`extra key ${k.slice(0, 20)}`);
  return done();
}

/**
 * The exact string we store. Throws on values the UI should never produce.
 * @param {{ difficulty: string, computerFirst: boolean }} s
 */
export function serializeSettings(s) {
  if (!s || typeof s !== 'object') throw new TypeError('settings must be an object');
  if (!DIFFICULTIES.includes(s.difficulty)) throw new RangeError(`bad difficulty ${String(s.difficulty)}`);
  if (typeof s.computerFirst !== 'boolean') throw new TypeError('computerFirst must be a boolean');
  return JSON.stringify({ difficulty: s.difficulty, computerFirst: s.computerFirst });
}

/**
 * Get window.localStorage without letting a SecurityError escape.
 * @param {any} [win]
 * @returns {Storage | null}
 */
export function getStorage(win = globalThis) {
  try {
    const s = win && win.localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

/**
 * Read remembered settings. Never throws; falls back to the defaults.
 * @param {Storage | null} storage
 */
export function loadSettings(storage) {
  if (!storage) return { settings: { ...DEFAULT_SETTINGS }, problems: ['no storage'] };
  let raw;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, problems: ['read failed'] };
  }
  return parseSettings(raw);
}

/**
 * Remember settings. Never throws.
 * @param {Storage | null} storage
 * @param {{ difficulty: string, computerFirst: boolean }} s
 * @returns {boolean} true if saved
 */
export function saveSettings(storage, s) {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, serializeSettings(s));
    return true;
  } catch {
    return false;
  }
}
