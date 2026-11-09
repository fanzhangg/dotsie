# Vendored libraries

The map's library, served with the app rather than from a CDN, so a trip opens whether or not the CDN answers, and the
first visit needs nothing but this site. It's the files its npm package publishes, unchanged, with its license.

| Folder | Package | Files |
| --- | --- | --- |
| `maplibre/` | [maplibre-gl](https://maplibre.org) 5.24.0 (BSD-3-Clause) | `dist/maplibre-gl.js`, `dist/maplibre-gl.css` |

To update one, copy the same files from the new version's package (`npm pack <package>@<version>`, then unpack it) and
change the version here. It loads only when a trip's map opens (`MAPLIBRE` in `map.js`).
