// Assemble public/: the app's own files from web/, plus the shared design system it's built on.
// Copies over what's there rather than clearing it first, so the dev server never serves a half-built folder.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { markdown, section } from './markdown.mjs';

const root = new URL('..', import.meta.url);
const out = new URL('public/', root);
cpSync(new URL('web/', root), out, { recursive: true });
for (const f of ['tokens.css', 'components.css', 'icons.js']) {
  cpSync(new URL(`../design-system/${f}`, root), new URL(`design-system/${f}`, out));
}

// The developer page (/developer) publishes README.md's API section, and the part of its MCP section on connecting
// an assistant, so they're written once. The MCP tools themselves come from the code (GET /api/developer/mcp).
const readme = readFileSync(new URL('README.md', root), 'utf8');
mkdirSync(new URL('developer/', out), { recursive: true });
writeFileSync(new URL('developer/docs.json', out), JSON.stringify({
  api: markdown(section(readme, 'API')),
  mcp: markdown(section(readme, 'MCP server').split(/\n\| Tool \|/)[0]),
}));
