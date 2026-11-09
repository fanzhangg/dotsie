// @ts-check
/* What MapLibre is asked to draw: the basemaps, and the routes' layers inside them. No DOM: the tests import this. */

// The routes, from one GeoJSON source, drawn in the basemap under its first names layer: so the place and road names,
// and the road numbers, sit over the routes (a route never hides the names of the roads it follows), and the land,
// water and roads under them. Each route has a casing under its line; a route not looked up yet is dotted, and transit
// and flights, which have none, are dashed (as multiples of the line's width). The route on show is drawn again on top,
// over any route it crosses. The widest layer is the one taps find a route with: a line nobody sees.
export const ROUTE_SOURCE = 'routes';
export const ROUTE_HIT = 'routes-hit';
const DASHES = { dot: [0, 1.6], dash: [2.2, 1.8] };
export function routeLayers() {
  const base = { type: 'line', source: ROUTE_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' } };
  /** @param {boolean} top @param {string} [dash] */
  const on = (top, dash) => ['all', ['==', ['get', 'top'], top], ...(dash ? [['==', ['get', 'dash'], dash]] : [])];
  const set = top => {
    const id = name => `routes-${name}${top ? '-top' : ''}`;
    return [
      { ...base, id: id('casing'), filter: on(top), paint: { 'line-color': ['get', 'casing'], 'line-width': ['get', 'casingWidth'], 'line-opacity': 0.9 } },
      ...['solid', 'dot', 'dash'].map(dash => ({
        ...base, id: id(dash), filter: on(top, dash),
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], ...(DASHES[dash] && { 'line-dasharray': DASHES[dash] }) },
      })),
    ];
  };
  return [...set(false), ...set(true), { ...base, id: ROUTE_HIT, filter: on(false), paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 24 } }];
}
// Where the routes go in a style: before its first names layer, or on top of a map without names
/** @param {{ id: string, type: string }[]} layers @returns {string | undefined} */
export const firstLabelLayer = layers => layers.find(l => l.type === 'symbol')?.id;

// Before a style has come in, or with none (no connection and nothing saved): the map's own color
/** @param {string} color */
export const blankStyle = color => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': color } }] });

// OpenStreetMap's pictures, when Stadia's map can't be had: busier than Stadia's, so quieted, and turned dark in dark mode
/** @param {boolean} dark */
export const osmStyle = dark => ({
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19 } },
  layers: [{
    id: 'osm', type: 'raster', source: 'osm',
    paint: dark ? { 'raster-brightness-min': 0.9, 'raster-brightness-max': 0.1, 'raster-hue-rotate': 180, 'raster-saturation': -0.6 } : { 'raster-saturation': -0.45 },
  }],
});

// A trip saved for offline when the map was Stadia's pictures, not its vector tiles: those pictures, as they were saved.
// `{r}` is "@2x" on a screen that took the sharper ones.
/** @param {string} template @param {boolean} retina */
export const pictureStyle = (template, retina) => ({
  version: 8,
  sources: { pictures: { type: 'raster', tiles: [template.replace('{r}', retina ? '@2x' : '')], tileSize: 256, maxzoom: 20 } },
  layers: [{ id: 'pictures', type: 'raster', source: 'pictures' }],
});
