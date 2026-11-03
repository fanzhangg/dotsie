/* Waythread design system — icons v1.0.0
 *
 * Line icons on a 24px grid, 2px stroke, round caps and joins, drawn in currentColor.
 * Usage: WaythreadIcons.svg('car')            -> default size and stroke
 *        WaythreadIcons.svg('check', 16, 3)   -> size 16, stroke 3
 * Add an icon by adding its path data to PATHS; keep it inside a 2px margin of the 24px box. */
(function () {
  const PATHS = {
    back: 'M15 18l-6-6 6-6',
    forward: 'M9 18l6-6-6-6',
    close: 'M18 6L6 18M6 6l12 12',
    plus: 'M12 5v14M5 12h14',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    car: 'M5 16h14M6 16v2.5M18 16v2.5M3.5 16v-3.5L6 7h12l2.5 5.5V16',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
    'person-add': 'M15 19a6 6 0 00-12 0M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M16 11h6',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
    pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  };
  // Default size and stroke per icon, as the product uses them.
  const DEFAULTS = {
    close: [20], 'person-add': [20], edit: [18], check: [16, 3], car: [16], external: [14],
  };
  function svg(name, size, stroke) {
    const d = PATHS[name];
    if (!d) throw new Error(`Unknown icon: ${name}`);
    const [ds = 22, dw = 2] = DEFAULTS[name] || [];
    const s = size ?? ds, w = stroke ?? dw;
    return `<svg class="wt-icon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  }
  window.WaythreadIcons = { svg, names: Object.keys(PATHS) };
})();
