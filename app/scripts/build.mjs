// Assemble public/: the app's own files from web/, plus the shared design system it's built on.
// Copies over what's there rather than clearing it first, so the dev server never serves a half-built folder.
import { cpSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const out = new URL('public/', root);
cpSync(new URL('web/', root), out, { recursive: true });
for (const f of ['tokens.css', 'components.css', 'icons.js']) {
  cpSync(new URL(`../design-system/${f}`, root), new URL(`design-system/${f}`, out));
}
