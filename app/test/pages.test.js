// The app's page and the prototype's load the same modules, and the prototype's backend stands in for the app's.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const preloads = html => [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]);
const exportsOf = js => [...js.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map(m => m[1]).sort();
// Every module but the entry (loaded by its script tag) and the plain scripts
const modules = readdirSync(new URL('../web/', import.meta.url)).filter(f => f.endsWith('.js') && !['app.js', 'sw.js', 'tz-lookup.js'].includes(f));

test('the app’s page preloads every module, so a trip saved for offline has them all', () => {
  assert.deepEqual(preloads(read('../web/index.html')).sort(), modules.sort());
});

test('the prototype’s page preloads the same modules, with its own backend', () => {
  const want = modules.map(f => (f === 'backend.js' ? 'backend.js' : `../app/web/${f}`)).sort();
  assert.deepEqual(preloads(read('../../prototype/index.html')).sort(), want);
  assert.match(read('../../prototype/index.html'), /"\.\.\/app\/web\/backend\.js": "\.\/backend\.js"/);
});

test('the prototype’s backend has the same exports as the app’s', () => {
  assert.deepEqual(exportsOf(read('../../prototype/backend.js')), exportsOf(read('../web/backend.js')));
});

test('every module imports files that exist', () => {
  for (const f of [...modules, 'app.js']) {
    for (const [, path] of read(`../web/${f}`).matchAll(/^import .* from '\.\/([\w-]+\.js)';$/gm)) assert.ok([...modules, 'app.js'].includes(path), `${f} imports ${path}`);
  }
});
