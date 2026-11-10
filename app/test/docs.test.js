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
