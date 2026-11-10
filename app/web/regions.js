/* What each country's states (or provinces) are called, for the spots: the page's filters and headings, and the
   server's search, which finds a state's spots by its name ("washington") or its code ("WA"). The Worker imports
   this file too. A country not here shows its states' codes. */
/** @type {Record<string, Record<string, string>>} */
export const REGIONS = {
  US: { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' },
  CA: { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia',
    NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' },
};
/** @param {string} country @param {string} state */
export const regionName = (country, state) => REGIONS[country]?.[state] ?? state;
/**
 * The states a search means, as "US-WA": its code when it's two letters ("wa"), or any state with a word starting
 * with it, from three letters on ("wash", "new m"), so a short search doesn't match half the country.
 * @param {string} q @returns {string[]}
 */
export function regionsMatching(q) {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const out = [];
  for (const [country, states] of Object.entries(REGIONS)) {
    for (const [code, name] of Object.entries(states)) {
      const n = name.toLowerCase();
      if (t === code.toLowerCase() || (t.length >= 3 && (n.startsWith(t) || n.includes(` ${t}`)))) out.push(`${country}-${code}`);
    }
  }
  return out;
}
