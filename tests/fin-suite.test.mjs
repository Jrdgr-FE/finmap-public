import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/fin-suite.js', import.meta.url), 'utf8');
function page({ cookie = '', local = {}, hostname = 'map.finhot.fun', dark = false, blocked = false } = {}) {
  const stored = new Map(Object.entries(local));
  const listeners = {}, writes = [];
  const document = {
    documentElement: { dataset: {}, lang: 'zh-CN' },
    get cookie() { return cookie; },
    set cookie(value) { writes.push(value); cookie = value.split(';')[0]; },
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const window = { addEventListener: (name, handler) => { listeners[name] = handler; } };
  vm.runInNewContext(source, {
    document, window, location: { hostname, protocol: 'https:' },
    localStorage: {
      getItem: key => { if (blocked) throw Error('Storage blocked'); return stored.get(key); },
      setItem: (key, value) => { if (blocked) throw Error('Storage blocked'); stored.set(key, value); },
    },
    matchMedia: () => ({ matches: dark, addEventListener: () => {} }),
  });
  return { document, window, writes, stored, listeners };
}
test('a shared choice overrides each app’s old preference and survives navigation', () => {
  const map = page({ cookie: 'fin-suite-theme=dark', local: { 'finmap-theme': 'light' } });
  assert.equal(map.document.documentElement.dataset.theme, 'dark');
  map.window.FinSuite.choose('light');
  assert.match(map.writes[0], /Domain=finhot\.fun; Path=\/; Max-Age=31536000; Secure; SameSite=Lax/);
  const hot = page({ hostname: 'finhot.fun', cookie: map.writes[0], local: { 'fin-suite-theme': 'dark' } });
  assert.equal(hot.document.documentElement.dataset.theme, 'light');
  assert.equal(map.stored.get('fin-suite-theme'), 'light');
});
test('storage denial and an invalid preference fall back to the system', () => {
  const app = page({ cookie: 'fin-suite-theme=invalid', blocked: true, dark: true });
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.doesNotThrow(() => app.window.FinSuite.choose('light'));
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  app.window.FinSuite.choose('unsupported');
  assert.equal(app.writes.length, 1);
});
test('localhost and unrelated hostnames never receive a sibling-site cookie', () => {
  for (const hostname of ['localhost', '127.0.0.1', 'finhot.fun.example.com', 'example.com']) {
    const app = page({ hostname });
    app.window.FinSuite.choose('dark');
    assert.equal(app.writes.length, 0);
    assert.equal(app.document.documentElement.dataset.theme, 'dark');
  }
});
