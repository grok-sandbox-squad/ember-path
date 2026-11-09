// Remembered settings: parsing, serializing and storage failures (no DOM needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_KEY, DEFAULT_SETTINGS, MAX_STORED_LENGTH,
  parseSettings, serializeSettings, getStorage, loadSettings, saveSettings,
} from '../src/settings.js';

const D = { difficulty: 'normal', computerFirst: false };

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

test('key is namespaced and versioned; defaults are Normal, you first', () => {
  assert.equal(SETTINGS_KEY, 'ember-path:settings:v1');
  assert.deepEqual({ ...DEFAULT_SETTINGS }, D);
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
});

test('round trip for every valid combination', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const computerFirst of [true, false]) {
      const raw = serializeSettings({ difficulty, computerFirst });
      assert.equal(raw, JSON.stringify({ difficulty, computerFirst }));
      assert.deepEqual(parseSettings(raw), { settings: { difficulty, computerFirst }, problems: [] });
    }
  }
});

test('serialize writes only the two fields and rejects bad values', () => {
  const raw = serializeSettings({ difficulty: 'hard', computerFirst: true, name: 'x', email: 'y' });
  assert.deepEqual(Object.keys(JSON.parse(raw)), ['difficulty', 'computerFirst']);
  assert.throws(() => serializeSettings({ difficulty: 'Medium', computerFirst: true }), RangeError);
  assert.throws(() => serializeSettings({ difficulty: 'hard', computerFirst: 'yes' }), TypeError);
  assert.throws(() => serializeSettings(null), TypeError);
});

test('whole fallback: missing, not a string, too long, bad JSON, not an object', () => {
  const cases = [null, undefined, 42, {}, '', 'nope', '{', '{"difficulty":"hard"', 'null', 'true', '7', '"hard"', '[]',
    '["hard",true]', JSON.stringify({ difficulty: 'hard', computerFirst: true, pad: 'x'.repeat(MAX_STORED_LENGTH) }),
    'x'.repeat(5_000_000)];
  for (const raw of cases) {
    const r = parseSettings(raw);
    assert.deepEqual(r.settings, D, `input ${String(raw).slice(0, 40)}`);
    assert.ok(r.problems.length > 0);
  }
});

test('field-by-field fallback keeps the valid field', () => {
  const p = (o) => parseSettings(JSON.stringify(o)).settings;
  assert.deepEqual(p({ difficulty: 'hard' }), { difficulty: 'hard', computerFirst: false });
  assert.deepEqual(p({ computerFirst: true }), { difficulty: 'normal', computerFirst: true });
  assert.deepEqual(p({ difficulty: 'Hard', computerFirst: true }), { difficulty: 'normal', computerFirst: true }); // exact match only
  assert.deepEqual(p({ difficulty: 'medium', computerFirst: true }), { difficulty: 'normal', computerFirst: true });
  assert.deepEqual(p({ difficulty: ['hard'], computerFirst: 'true' }), D);
  assert.deepEqual(p({ difficulty: 'easy', computerFirst: 1 }), { difficulty: 'easy', computerFirst: false });
  assert.deepEqual(p({ difficulty: null, computerFirst: null }), D);
  assert.deepEqual(p({ difficulty: 'hard', computerFirst: true, extra: 'junk', n: 1 }), { difficulty: 'hard', computerFirst: true });
  assert.ok(parseSettings(JSON.stringify({ difficulty: 'hard', computerFirst: true, extra: 1 })).problems.includes('extra key extra'));
});

test('prototype-pollution style keys are ignored and pollute nothing', () => {
  const nasty = [
    '{"__proto__":{"difficulty":"hard","computerFirst":true,"polluted":1}}',
    '{"constructor":{"prototype":{"polluted":1}},"difficulty":"easy"}',
    '{"__proto__":{"polluted":1},"difficulty":"hard","computerFirst":true}',
  ];
  const r0 = parseSettings(nasty[0]);
  assert.deepEqual(r0.settings, D, 'values inside __proto__ are not used');
  assert.deepEqual(parseSettings(nasty[1]).settings, { difficulty: 'easy', computerFirst: false });
  assert.deepEqual(parseSettings(nasty[2]).settings, { difficulty: 'hard', computerFirst: true });
  for (const raw of nasty) parseSettings(raw);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.getPrototypeOf(r0.settings), Object.prototype);
  assert.deepEqual(Object.keys(r0.settings), ['difficulty', 'computerFirst']);
});

test('loadSettings / saveSettings with a working storage', () => {
  const st = fakeStorage();
  assert.deepEqual(loadSettings(st).settings, D);
  assert.equal(saveSettings(st, { difficulty: 'hard', computerFirst: true }), true);
  assert.deepEqual([...st.m.keys()], [SETTINGS_KEY], 'only our one key is written');
  assert.deepEqual(loadSettings(st), { settings: { difficulty: 'hard', computerFirst: true }, problems: [] });
  assert.equal(saveSettings(st, { difficulty: 'nope', computerFirst: true }), false, 'bad values are not saved');
  assert.deepEqual(loadSettings(st).settings, { difficulty: 'hard', computerFirst: true });
});

test('storage that throws, or is missing, never breaks anything', () => {
  const boom = (name) => () => {
    const e = new Error(name);
    e.name = name;
    throw e;
  };
  const throwing = { getItem: boom('SecurityError'), setItem: boom('QuotaExceededError') };
  assert.deepEqual(loadSettings(throwing), { settings: D, problems: ['read failed'] });
  assert.equal(saveSettings(throwing, { difficulty: 'hard', computerFirst: true }), false);
  assert.deepEqual(loadSettings(null).settings, D);
  assert.equal(saveSettings(null, D), false);
  // Reading window.localStorage itself can throw (blocked storage) or be undefined.
  const blocked = {};
  Object.defineProperty(blocked, 'localStorage', { get: boom('SecurityError') });
  assert.equal(getStorage(blocked), null);
  assert.equal(getStorage({}), null);
  assert.equal(getStorage({ localStorage: undefined }), null);
  assert.equal(getStorage({ localStorage: { getItem: 1 } }), null);
  assert.equal(getStorage(undefined), null);
  const ok = fakeStorage();
  assert.equal(getStorage({ localStorage: ok }), ok);
  // A getItem that returns junk types.
  assert.deepEqual(loadSettings({ getItem: () => 123, setItem() {} }).settings, D);
});

test('the page touches storage only through src/settings.js, and stores nothing else', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  for (const f of ['app.js', 'src/ui-logic.js', 'src/ai-worker.js']) {
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(read(f)), `${f} must not use storage directly`);
  }
  const src = read('src/settings.js');
  assert.equal((src.match(/setItem\(/g) || []).length, 1, 'one write site');
  assert.match(src, /storage\.setItem\(SETTINGS_KEY, serializeSettings\(s\)\)/);
  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(src));
});
