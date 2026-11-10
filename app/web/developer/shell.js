'use strict';

/* The frame around every page for developers (/developer/*), as developer docs lay it out: a bar at the top, the menu
   of pages on the left (a drawer behind a button on a phone), the page's own headings on the right ("On this page", on
   a wide screen), and the pages before and after it at the bottom. The menu is MENU, here only: each page's HTML has
   just its <main>, and this script, loaded after it, builds the rest around it.
   A page that fills itself in later (developer.js, spots.js, guide.js) calls DevShell.update() once it has, for the
   contents and the copy buttons. Product-only, like the pages. */
(() => {
  const MENU = [
    { items: [['/developer', 'Overview']] },
    { title: 'MCP server', items: [['/developer/mcp', 'Connect an assistant'], ['/developer/tools', 'Tools'], ['/developer/sign-in', 'Sign-in']] },
    { title: 'App', items: [['/developer/api', 'App API']] },
    { title: 'Data', items: [['/developer/spots', 'Spots data'], ['/developer/guide', 'Guide preview']] },
  ];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, size = 20) => window.DotsieIcons ? DotsieIcons.svg(name, size) : '';
  const path = location.pathname.replace(/(\.html|\/index\.html|\/)$/, '') || '/developer';
  const pages = MENU.flatMap(g => g.items.map(([href, text]) => ({ href, text, group: g.title })));
  const at = pages.findIndex(p => p.href === path);

  const main = document.querySelector('main');
  main.id ||= 'main';
  main.tabIndex = -1;

  // ---------- The bar, the menu, the contents and the pager ----------
  const bar = `<a class="dev-skip" href="#${main.id}">Skip to content</a>
    <header class="dev-bar">
      <button type="button" class="wt-icon-btn dev-bar__menu" aria-label="Menu" aria-expanded="false" aria-controls="dev-menu">${icon('list')}</button>
      <a class="dev-bar__brand" href="/developer">
        <img src="/favicon.svg" alt="" width="24" height="24">
        <span class="wt-wordmark" aria-hidden="true">Dots<span class="wt-wordmark__i">ı</span>e</span>
        <span class="dev-bar__name"><span class="wt-visually-hidden">Dotsie </span>Developers</span>
      </a>
      <a class="dev-bar__app" href="/">Open Dotsie</a>
    </header>`;
  const menu = `<nav class="dev-side" id="dev-menu" aria-label="Developers">${MENU.map(g => `<div class="dev-side__group">
      ${g.title ? `<p class="dev-side__title">${esc(g.title)}</p>` : ''}
      ${g.items.map(([href, text]) => `<a class="dev-side__link" href="${href}"${href === path ? ' aria-current="page"' : ''}>${esc(text)}</a>`).join('')}
    </div>`).join('')}</nav>`;
  const step = (p, dir) => p ? `<a class="dev-pager__link dev-pager__link--${dir}" href="${p.href}" rel="${dir}">
      <span class="dev-pager__dir">${dir === 'prev' ? `${icon('back', 16)}Previous` : `Next${icon('forward', 16)}`}</span>
      <span class="dev-pager__page">${esc(p.text)}</span></a>` : '<span></span>';
  const pager = at < 0 ? '' : `<nav class="dev-pager" aria-label="Pages before and after">${step(pages[at - 1], 'prev')}${step(pages[at + 1], 'next')}</nav>`;

  document.body.classList.add('dev-site');
  main.insertAdjacentHTML('beforebegin', `${bar}<div class="dev-layout">${menu}<div class="dev-content"></div>
    <aside class="dev-toc" aria-labelledby="dev-toc-title" hidden><p class="dev-toc__title" id="dev-toc-title">On this page</p><ol></ol></aside></div>`);
  const content = document.querySelector('.dev-content');
  content.append(main);
  content.insertAdjacentHTML('beforeend', pager);

  // ---------- The menu on a phone: a drawer under the bar ----------
  const button = document.querySelector('.dev-bar__menu'), side = document.getElementById('dev-menu');
  const wide = matchMedia('(min-width: 900px)'); // the menu is a column there, not a drawer (developer.css)
  const setOpen = open => {
    document.documentElement.classList.toggle('dev-menu-open', open);
    content.inert = open; // the page under the drawer, out of reach while it's open
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    button.innerHTML = icon(open ? 'close' : 'list');
  };
  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
  side.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  wide.addEventListener('change', () => setOpen(false));
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') { setOpen(false); button.focus(); }
  });

  // ---------- On this page: the page's h2s, the one being read marked as it scrolls ----------
  const toc = document.querySelector('.dev-toc');
  let heads = [];
  function contents() {
    heads = [...main.querySelectorAll('h2[id]')];
    for (const h of heads) {
      if (h.querySelector('.dev-anchor')) continue;
      h.insertAdjacentHTML('beforeend', ` <a class="dev-anchor" href="#${esc(h.id)}" aria-label="Link to ${esc(h.dataset.toc ?? h.textContent.trim())}">#</a>`);
    }
    toc.hidden = heads.length < 2;
    toc.querySelector('ol').innerHTML = heads.map(h =>
      `<li><a href="#${esc(h.id)}">${esc(h.dataset.toc ?? h.textContent.replace(/#$/, '').trim())}</a></li>`).join('');
    spy();
  }
  function spy() {
    if (toc.hidden) return;
    const top = document.querySelector('.dev-bar').offsetHeight + 24;
    let current = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top <= top) current = h;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = heads[heads.length - 1];
    for (const a of toc.querySelectorAll('a')) a.classList.toggle('is-current', a.hash === `#${current?.id}`);
  }
  addEventListener('scroll', spy, { passive: true });

  // ---------- Copy buttons on code blocks, and on anything marked data-copy ----------
  function copyButtons() {
    for (const pre of main.querySelectorAll('pre:not(.dev-code pre)')) {
      const wrap = document.createElement('div');
      wrap.className = 'dev-code';
      pre.replaceWith(wrap);
      wrap.append(pre);
      wrap.insertAdjacentHTML('beforeend', '<button type="button" class="dev-copy" data-copies>Copy</button>');
    }
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-copies]');
    if (!b) return;
    const target = b.dataset.copies ? document.getElementById(b.dataset.copies) : b.parentElement.querySelector('pre');
    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      b.textContent = 'Copied';
    } catch { b.textContent = 'Couldn’t copy'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  });

  function update() {
    contents();
    copyButtons();
    if (location.hash.length > 1) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }
  window.DevShell = { update };
  update();
})();
