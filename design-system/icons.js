/* Waythread design system — icons v1.5.0
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
    car: 'M5 11l1.6-4.3A2 2 0 018.5 5.3h7a2 2 0 011.9 1.4L19 11M4.5 11h15a.5.5 0 01.5.5V17H4v-5.5a.5.5 0 01.5-.5zM6 17v2M18 17v2M7.5 14h1M15.5 14h1',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
    'person-add': 'M15 19a6 6 0 00-12 0M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M16 11h6',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
    pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
    settings: 'M4 7h9M19 7h1M4 17h1M11 17h9M16 9.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 19.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    'chevron-down': 'M6 9l6 6 6-6',
    'chevron-up-down': 'M8 9.5l4-4 4 4M8 14.5l4 4 4-4',   // a picker: tap for a list to choose from
    map: 'M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2zM9 4.5v13M15 6.5v13',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    fit: 'M4 9V6a2 2 0 012-2h3M15 4h3a2 2 0 012 2v3M20 15v3a2 2 0 01-2 2h-3M9 20H6a2 2 0 01-2-2v-3',
    alert: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5v5M12 16.5h.01',   // something went wrong
    // Offline: saving a trip on this device, saved, and no connection
    download: 'M12 4v10.5M7.5 10L12 14.5 16.5 10M5 19.5h14',
    saved: 'M5 19.5h14M7.5 10.5l3 3 6-6.5',
    'cloud-off': 'M3.5 3.5l17 17M9.5 5.6A6 6 0 0117.8 10.1a4 4 0 012.5 6.6M16.5 18H7a4.5 4.5 0 01-2.2-8.4',
    directions: 'M10.6 3.4a2 2 0 012.8 0l7.2 7.2a2 2 0 010 2.8l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2a2 2 0 010-2.8zM9 15v-2.5a2 2 0 012-2h4.5M13 8l2.5 2.5L13 13',
    // Stop types
    plane: 'M12 3c.8 0 1.5.9 1.5 2v4.5l7 4V16l-7-2v4l2 1.5V21L12 20l-3.5 1v-1.5l2-1.5v-4l-7 2v-2.5l7-4V5c0-1.1.7-2 1.5-2z',
    bed: 'M3 5v14M3 15h18v4M21 15v-2.5a3 3 0 00-3-3h-7V15M7 12.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    utensils: 'M6 3v5a2 2 0 004 0V3M8 3v18M17 21V3c2 1.5 3 4 3 7.5V13h-3',
    cup: 'M4 9h12v4.5A5.5 5.5 0 0110.5 19h-1A5.5 5.5 0 014 13.5zM16 10h1.5a2.5 2.5 0 010 5H16M8 3v3M12 3v3',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    museum: 'M3 9l9-5 9 5M5.5 9v9M9.8 9v9M14.2 9v9M18.5 9v9M3 20h18',
    tree: 'M12 3l5 7h-3l4 6H6l4-6H7zM12 16v5',
    camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 100-6 3 3 0 000 6z',
    bag: 'M5 8h14l-1 12H6zM9 8V6.5a3 3 0 016 0V8',
    fuel: 'M4 21V5a2 2 0 012-2h6a2 2 0 012 2v16M2.5 21h13M4 10h10M14 8l3 3v6.5a1.5 1.5 0 003 0V9l-3-3',
  };
  // Default size and stroke per icon, as the product uses them.
  const DEFAULTS = {
    close: [20], 'person-add': [20], edit: [18], check: [16, 3], car: [14], external: [14],
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
