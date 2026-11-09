// The app's page and the prototype's load the same modules, and the prototype's backend stands in for the app's.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const preloads = html => [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]);
const exportsOf = js => [...js.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map(m => m[1]).sort();
// Every module the page loads, by following the imports from its entry (loaded by its script tag, so not preloaded).
// The prototype's backend.js stands in for the app's, with its own imports.
const modules = readdirSync(new URL('../web/', import.meta.url)).filter(f => f.endsWith('.js') && !['sw.js', 'tz-lookup.js'].includes(f));
const importsOf = js => [...js.matchAll(/^import .* from '((?:\.\.\/app\/web\/|\.\/)[\w-]+\.js)';$/gm)].map(m => m[1].replace(/^(\.\.\/app\/web\/|\.\/)/, ''));
function loaded(prototype) {
  const seen = new Set(), todo = ['app.js'];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...importsOf(read(prototype && f === 'backend.js' ? '../../prototype/backend.js' : `../web/${f}`)));
  }
  seen.delete('app.js');
  return [...seen];
}

test('the app’s page preloads every module it loads, so a trip saved for offline has them all', () => {
  assert.deepEqual(preloads(read('../web/index.html')).sort(), loaded(false).sort());
});

test('the prototype’s page preloads every module it loads, with its own backend', () => {
  const want = loaded(true).map(f => (f === 'backend.js' ? 'backend.js' : `../app/web/${f}`)).sort();
  assert.deepEqual(preloads(read('../../prototype/index.html')).sort(), want);
  assert.match(read('../../prototype/index.html'), /"\.\.\/app\/web\/backend\.js": "\.\/backend\.js"/);
});

test('the prototype’s backend has the same exports as the app’s', () => {
  assert.deepEqual(exportsOf(read('../../prototype/backend.js')), exportsOf(read('../web/backend.js')));
});

test('every module imports files that exist', () => {
  for (const f of modules) {
    for (const path of importsOf(read(`../web/${f}`))) assert.ok(modules.includes(path), `${f} imports ${path}`);
  }
});
