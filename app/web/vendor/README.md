# Vendored libraries

The map's libraries, served with the app rather than from a CDN, so a trip opens whether or not the CDN answers, and the
first visit needs nothing but this site. They're the files their npm packages publish, unchanged, each with its license.

| Folder | Package | Files |
| --- | --- | --- |
| `leaflet/` | [leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause) | `dist/leaflet.js`, `dist/leaflet.css`, `dist/images/` |
| `maplibre/` | [maplibre-gl](https://maplibre.org) 5.24.0 (BSD-3-Clause) | `dist/maplibre-gl.js`, `dist/maplibre-gl.css` |
| `maplibre/` | [@maplibre/maplibre-gl-leaflet](https://github.com/maplibre/maplibre-gl-leaflet) 0.1.4 (ISC; `LICENSE-leaflet-plugin`) | `leaflet-maplibre-gl.js` |

To update one, copy the same files from the new version's package (`npm pack <package>@<version>`, then unpack it) and
change the version here. MapLibre loads only when a trip's map opens (`MAPLIBRE` in `map.js`).
