'use strict';

/* Developers (/developer). Everything on it comes from what it documents: the MCP server's tools, instructions and
   sign-in from GET /api/developer/mcp (the code that runs them), and the API and how to connect an assistant from
   README.md, turned into docs.json by the build (scripts/build.mjs). Product-only: the prototype has no server. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const code = s => `<code>${esc(s)}</code>`;
const field = (label, value) => value ? `<dt>${esc(label)}</dt><dd>${value}</dd>` : '';
const link = href => `<a href="${esc(href)}">${code(href)}</a>`;
const duration = s => s % 86400 === 0 ? `${s / 86400} days` : s % 3600 === 0 ? `${s / 3600 === 1 ? 'an' : s / 3600} hour${s / 3600 === 1 ? '' : 's'}` : `${s} seconds`;
// README.md says "https://<app URL>": here, it's this one
const here = html => html.replaceAll('https://&lt;app URL&gt;', location.origin).replaceAll('&lt;app URL&gt;', location.host);

// One argument's type, in words: its JSON Schema type, the values it takes, and its limits
function typeOf(s) {
  if (!s) return '';
  const types = [].concat(s.type ?? []);
  let t = types.filter(x => x !== 'null').join(' or ') || 'any';
  if (s.type === 'array' && s.items) t = `list of ${s.items.type === 'object' ? `{ ${Object.keys(s.items.properties ?? {}).join(', ')} }` : typeOf(s.items)}`;
  if (s.type === 'object' && s.additionalProperties && typeof s.additionalProperties === 'object') t = `object of ${typeOf(s.additionalProperties)}`;
  const limits = [
    s.enum && `one of ${s.enum.map(v => v === '' ? '""' : v).join(', ')}`,
    s.pattern && `matching ${s.pattern}`,
    s.minimum != null && s.maximum != null && `${s.minimum}–${s.maximum}`,
    s.maxLength && `up to ${s.maxLength} characters`,
    s.maxItems && `up to ${s.maxItems}`,
    types.includes('null') && 'or null',
  ].filter(Boolean);
  return limits.length ? `${t} (${limits.join('; ')})` : t;
}

function tool(t) {
  const props = t.inputSchema?.properties ?? {}, required = new Set(t.inputSchema?.required ?? []);
  const a = t.annotations ?? {};
  const tags = [a.readOnlyHint ? 'Reads only' : 'Changes trips', a.destructiveHint && 'Can remove a stop', a.idempotentHint && 'Safe to repeat'].filter(Boolean);
  const rows = Object.entries(props).map(([name, s]) => `<tr><td>${code(name)}${required.has(name) ? '' : ' <span class="dev__tags">optional</span>'}</td><td>${esc(typeOf(s))}</td><td>${esc(s.description ?? '')}</td></tr>`).join('');
  return `<article class="dev__tool" id="tool-${esc(t.name)}">
    <h3 class="dev__h3">${code(t.name)} · ${esc(t.title ?? '')}</h3>
    <p class="dev__prose">${esc(t.description)}</p>
    <p class="dev__tags">${esc(tags.join(' · '))}</p>
    ${rows ? `<div class="dev__table"><table><thead><tr><th>Argument</th><th>Type</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="dev__hint">No arguments.</p>'}
  </article>`;
}

Promise.all([
  fetch('/api/developer/mcp').then(r => { if (!r.ok) throw new Error(`The MCP server’s details didn’t load (${r.status}).`); return r.json(); }),
  fetch('/developer/docs.json').then(r => { if (!r.ok) throw new Error(`The API docs didn’t load (${r.status}).`); return r.json(); }),
]).then(([mcp, docs]) => {
  $('#mcp-facts').innerHTML = [
    field('Address', code(mcp.url)),
    field('Server', `${esc(mcp.server.title)} (${code(mcp.server.name)}), version ${esc(mcp.server.version)}`),
    field('Protocol versions', mcp.versions.map(code).join(', ')),
    field('Transport', 'Streamable HTTP without sessions: each POST is one JSON-RPC message, answered with JSON'),
  ].join('');
  $('#mcp-docs').innerHTML = here(docs.mcp);
  $('#mcp-instructions').textContent = mcp.instructions;
  const o = mcp.oauth;
  $('#oauth').innerHTML = [
    field('Protected resource', code(o.resource)),
    field('Issuer', code(o.issuer)),
    field('Discovery', o.discovery.map(link).join('<br>')),
    field('Authorization', code(o.authorize)),
    field('Token', code(o.token)),
    field('Client registration', `Client ID Metadata Documents, or dynamic registration at ${code(o.register)}`),
    field('Scopes', o.scopes.map(code).join(', ')),
    field('PKCE', o.pkce.map(code).join(', ')),
    field('Access token', `Lasts ${duration(o.accessTokenSeconds)}, then refreshes`),
    field('Connection', `Lasts while it’s used; ends after ${duration(o.refreshIdleSeconds)} without, or when the person disconnects it in Account`),
  ].join('');
  $('#tool-list').innerHTML = mcp.tools.map(tool).join('');
  $('#api-docs').innerHTML = here(docs.api);
  $('#loading').hidden = true;
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}).catch(err => { $('#loading').textContent = err.message; });
