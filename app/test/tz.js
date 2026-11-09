// The browser loads tz-lookup.js as a plain script, which defines tzlookup for the app's modules; do the same here
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(readFileSync(new URL('../web/tz-lookup.js', import.meta.url), 'utf8'));
