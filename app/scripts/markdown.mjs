// README.md's sections as HTML, for the developer pages (see build.mjs).

export function section(md, title) {
  const start = md.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`README.md has no "## ${title}" section`);
  const rest = md.slice(start + title.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

// Enough Markdown for the README: headings, paragraphs, lists (with indented code under an item), fenced code, tables,
// and inline code, bold and links. A section is a page of its own on the site, so its ### headings are the page's h2s
// (and #### its h3s), each with an id for the page's contents: ### Trips is <h2 id="trips">.
export function markdown(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = s => {
    const parts = s.split(/(`[^`]+`)/g);
    return parts.map(p => p.startsWith('`') && p.endsWith('`') && p.length > 1 ? `<code>${esc(p.slice(1, -1))}</code>`
      : esc(p).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => /^https?:\/\//.test(href)
          ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text)).join('');
  };
  const cells = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => inline(c.trim().replace(/\\\|/g, '|')));
  const lines = md.split('\n'), html = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^#{3,4} /.test(line)) {
      const text = line.replace(/^#+ /, ''), level = line.indexOf(' ') - 1;
      html.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      i++;
    } else if (/^\s*```/.test(line)) {
      const indent = line.match(/^\s*/)[0].length, code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i].slice(indent));
      html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i].trim())) rows.push(cells(lines[i]));
      const [head, ...body] = rows;
      html.push(`<div class="dev__table"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^- /.test(line)) {
      const items = [];
      for (; i < lines.length && (/^- /.test(lines[i]) || /^\s+\S/.test(lines[i]) || (!lines[i].trim() && /^\s+\S/.test(lines[i + 1] ?? ''))); i++) {
        if (/^- /.test(lines[i])) items.push([lines[i].slice(2)]);
        else items[items.length - 1].push(lines[i]);
      }
      html.push(`<ul>${items.map(it => `<li>${markdown(it.join('\n').replace(/^ {2}/gm, ''))}</li>`).join('')}</ul>`);
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !/^(\||- |\s*```|#{3,4} )/.test(lines[i]); i++) para.push(lines[i].trim());
      html.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return html.join('\n');
}

// A heading's id: its words, lower case, joined by hyphens ("Sign-in and account" is sign-in-and-account)
export const slug = text => text.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
