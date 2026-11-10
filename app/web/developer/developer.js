'use strict';

/* The docs pages for developers: Overview (/developer), Connect an assistant (/developer/mcp), Tools
   (/developer/tools), Sign-in (/developer/sign-in), Changelog (/developer/changelog) and App API (/developer/api);
   shell.js is the frame around them.
   Everything on them comes from what they document: the MCP server's tools, instructions and sign-in from
   GET /api/developer/mcp (the code that runs them), and the API and how to connect an assistant from README.md, turned
   into docs.json by the build (scripts/build.mjs). Each page fills in only the parts it has, found by their ids.
   Product-only: the prototype has no server. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const code = s => `<code>${esc(s)}</code>`;
  const field = (label, value) => value ? `<dt>${esc(label)}</dt><dd>${value}</dd>` : '';
  const link = href => `<a href="${esc(href)}">${code(href)}</a>`;
  const duration = s => s % 86400 === 0 ? `${s / 86400} days` : s % 3600 === 0 ? `${s / 3600 === 1 ? 'an' : s / 3600} hour${s / 3600 === 1 ? '' : 's'}` : `${s} seconds`;
  // README.md says "https://<app URL>": here, it's this one
  const here = html => html.replaceAll('https://&lt;app URL&gt;', location.origin).replaceAll('&lt;app URL&gt;', location.host);

  // Before the pages were split, all of this was one page: its old links (/developer#tools) go to where it is now
  const MOVED = { mcp: '/developer/mcp', 'sign-in': '/developer/sign-in', tools: '/developer/tools', api: '/developer/api', spots: '/developer/spots' };
  if (location.pathname.replace(/\/$/, '') === '/developer' && location.hash) {
    const id = location.hash.slice(1);
    const to = MOVED[id] ?? (id.startsWith('tool-') ? `/developer/tools#${id}` : null);
    if (to) location.replace(to);
  }

  // One argument's type, in words: its JSON Schema type, the values it takes, and its limits. Not its pattern: the
  // description says the format in words ("YYYY-MM-DD"), which is what a person reads.
  function typeOf(s) {
    if (!s) return '';
    const types = [].concat(s.type ?? []);
    let t = types.filter(x => x !== 'null').join(' or ') || 'any';
    if (s.type === 'array' && s.items) t = `list of ${s.items.type === 'object' ? `{ ${Object.keys(s.items.properties ?? {}).join(', ')} }` : typeOf(s.items)}`;
    if (s.type === 'object' && s.additionalProperties && typeof s.additionalProperties === 'object') t = `object of ${typeOf(s.additionalProperties)}`;
    const limits = [
      s.enum && `one of ${s.enum.map(v => v === '' ? '""' : v).join(', ')}`,
      s.minimum != null && s.maximum != null && `${s.minimum}–${s.maximum}`,
      s.maxLength && `up to ${s.maxLength} characters`,
      s.maxItems && `up to ${s.maxItems}`,
      types.includes('null') && 'or null',
    ].filter(Boolean);
    return limits.length ? `${t} (${limits.join('; ')})` : t;
  }

  // A tool's arguments. Those an earlier tool already has, the same, are named in one row that points to it: edit_stop
  // takes add_stop's fields, and they aren't listed twice.
  const seen = new Map(); // argument → { tool, schema as JSON } where it was first listed
  function tool(t) {
    const props = t.inputSchema?.properties ?? {}, required = new Set(t.inputSchema?.required ?? []);
    const a = t.annotations ?? {};
    const tags = [a.readOnlyHint ? 'Reads only' : 'Changes trips', a.destructiveHint && 'Can remove a stop', a.idempotentHint && 'Safe to repeat'].filter(Boolean);
    // Optional ones only, from the one earlier tool most of them come from, and only when that's at least three
    const same = Object.entries(props).filter(([name, s]) => !required.has(name) && seen.get(name)?.json === JSON.stringify(s)).map(([name]) => name);
    const counts = {};
    for (const name of same) (counts[seen.get(name).tool] ??= []).push(name);
    const [from, shared = []] = Object.entries(counts).sort((x, y) => y[1].length - x[1].length).find(([, names]) => names.length >= 3) ?? [];
    for (const [name, s] of Object.entries(props)) if (!seen.has(name)) seen.set(name, { tool: t.name, json: JSON.stringify(s) });
    const row = ([name, s]) => `<tr><td>${code(name)}${required.has(name) ? '' : ' <span class="dev__tags">optional</span>'}</td><td>${esc(typeOf(s))}</td><td>${esc(s.description ?? '')}</td></tr>`;
    const rows = Object.entries(props).filter(([name]) => !shared.includes(name)).map(row).join('') + (shared.length
      ? `<tr><td colspan="3">Any of ${shared.map(code).join(', ')}: <span class="dev__tags">optional</span>, as in <a href="#tool-${esc(from)}">${code(from)}</a></td></tr>` : '');
    return `<section class="dev__tool">
      <h2 class="dev__h2" id="tool-${esc(t.name)}" data-toc="${esc(t.name)}">${code(t.name)} <span class="dev__tool-title">${esc(t.title ?? '')}</span></h2>
      <p class="dev__prose">${esc(t.description)}</p>
      <p class="dev__tags">${esc(tags.join(' · '))}</p>
      ${rows ? `<div class="dev__table"><table><thead><tr><th>Argument</th><th>Type</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="dev__hint">No arguments.</p>'}
    </section>`;
  }

  // What each version of the server changed, newest first
  const day = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const change = c => `<section class="dev__section">
      <h2 class="dev__h2" id="v${esc(c.version)}">${esc(c.version)} <span class="dev__tool-title">${esc(day(c.date))}</span></h2>
      <ul class="dev__prose dev__list">${c.changes.map(x => `<li>${esc(x).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('')}</ul>
    </section>`;

  const needsMCP = ['#mcp-url', '#mcp-facts', '#oauth', '#tool-list', '#changes'].some(s => $(s));
  const needsDocs = ['#mcp-docs', '#signin-docs', '#api-docs'].some(s => $(s));
  Promise.all([
    needsMCP && fetch('/api/developer/mcp').then(r => { if (!r.ok) throw new Error(`The MCP server’s details didn’t load (${r.status}).`); return r.json(); }),
    needsDocs && fetch('/developer/docs.json').then(r => { if (!r.ok) throw new Error(`The docs didn’t load (${r.status}).`); return r.json(); }),
  ]).then(([mcp, docs]) => {
    if ($('#mcp-url')) $('#mcp-url').textContent = mcp.url;
    if ($('#mcp-facts')) {
      $('#mcp-facts').innerHTML = [
        field('Address', code(mcp.url)),
        field('Server', `${esc(mcp.server.title)} (${code(mcp.server.name)})`),
        field('Protocol versions', mcp.versions.map(code).join(', ')),
        field('Transport', 'Streamable HTTP without sessions: each POST is one JSON-RPC message, answered with JSON'),
        field('Version', `${esc(mcp.server.version)}, <a href="/developer/changelog">what changed</a>`),
      ].join('');
    }
    if ($('#mcp-docs')) $('#mcp-docs').innerHTML = here(docs.mcp);
    if ($('#signin-docs')) $('#signin-docs').innerHTML = here(docs.signIn);
    if ($('#changes')) $('#changes').innerHTML = mcp.changes.map(change).join('');
    if ($('#mcp-instructions')) $('#mcp-instructions').textContent = mcp.instructions;
    if ($('#oauth')) {
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
    }
    if ($('#tool-list')) $('#tool-list').innerHTML = mcp.tools.map(tool).join('');
    if ($('#api-docs')) $('#api-docs').innerHTML = here(docs.api);
    if ($('#loading')) $('#loading').hidden = true;
    DevShell.update();
  }).catch(err => { if ($('#loading')) $('#loading').textContent = err.message; });
})();
