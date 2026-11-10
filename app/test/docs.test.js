import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { markdown, section } from '../scripts/markdown.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const api = section(read('../README.md'), 'API');

// README.md's API section is published at /developer/api, so a route missing from it is missing there
test('every route the Worker answers is in README.md’s API section', () => {
  const routes = [...read('../src/index.ts').matchAll(/^app\.(get|post|put|patch|delete)\('(\/[^']+)'/gm)].map(m => m[2]);
  assert.ok(routes.length > 20);
  for (const r of routes) assert.ok(api.includes(`/api${r}`), `/api${r} isn’t in README.md’s API section`);
});

test('the developer pages’ Markdown: tables keep escaped pipes, code stays code, only web links are links', () => {
  const html = markdown('A `<b>` and **bold** and [MCP](https://modelcontextprotocol.io) and [file](src/x.ts).\n\n| Route | |\n| --- | --- |\n| `GET /a` | `\'x\' \\| \'y\'` |');
  assert.match(html, /<code>&lt;b&gt;<\/code>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/modelcontextprotocol.io"/);
  assert.match(html, /and file\./);
  assert.match(html, /<td><code>'x' \| 'y'<\/code><\/td>/);
});

test('a section’s ### headings are its page’s h2s, with ids for the page’s contents', () => {
  const html = markdown('Intro.\n\n### Sign-in and account\n\n| Route | |\n| --- | --- |\n| `GET /a` | b |\n\n#### More `x`\n\nText.');
  assert.match(html, /<p>Intro\.<\/p>\n<h2 id="sign-in-and-account">Sign-in and account<\/h2>\n<div class="dev__table">/);
  assert.match(html, /<h3 id="more-x">More <code>x<\/code><\/h3>\n<p>Text\.<\/p>/);
  assert.match(markdown(section(read('../README.md'), 'API')), /<h2 id="trips">Trips<\/h2>/);
});

// /developer/changelog shows src/mcp.ts's CHANGES, and /developer/tools an example call written by hand: both have to
// keep up with the code. (mcp.ts isn't imported: its imports don't name their files, which Node needs.)
const mcp = read('../src/mcp.ts');
test('the MCP changelog’s newest entry is the server’s version', () => {
  const version = mcp.match(/const SERVER = \{[^}]*version: '([^']+)'/)[1];
  assert.equal(mcp.match(/const CHANGES = \[\s*\{ version: '([^']+)'/)[1], version);
});

test('the example call on /developer/tools sends add_stop’s arguments and gets back a stop as the tools give it', () => {
  const page = read('../web/developer/tools.html');
  const json = id => JSON.parse(page.match(new RegExp(`<pre id="${id}"><code>([^]*?)</code></pre>`))[1]
    .replace(/^[^{]*/, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  const editable = [...mcp.match(/const EDITABLE = \{([^]*?)\n\};/)[1].matchAll(/^ {2}(\w+): /gm)].map(m => m[1]);
  for (const k of Object.keys(json('example-request').params.arguments)) assert.ok(k === 'trip_id' || editable.includes(k), `add_stop takes no ${k}`);
  const fields = [...mcp.match(/const stopOut = [^]*?\(\{([^]*?)\}\);/)[1].matchAll(/(\w+):/g)].map(m => m[1]);
  assert.deepEqual(Object.keys(json('example-response').result.structuredContent.stop), fields);
});
