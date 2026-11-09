-- Place data for the end-to-end tests (app.spec.js): one NPS place and the Wikidata item that shares its NPS place
-- ID, in a state of their own ("ZZ") so they never mix with a state loaded for real. Loaded before the local Worker
-- starts (see playwright.config.js).
DELETE FROM places WHERE state = 'ZZ';
DELETE FROM place_links WHERE state = 'ZZ';
INSERT INTO places (source, id, state, name, description, lat, lng, types, url, wikipedia, website, views, ids) VALUES
  ('wikidata', 'Q1', 'ZZ', 'Test Lodge', 'historic lodge in a test park', 46.78, -121.73, '["hotel","historic building"]',
   'https://www.wikidata.org/wiki/Q1', 'Test Lodge', 'https://example.com/lodge', 12345, '{"P8649":["test-lodge"],"P649":["91000227"]}'),
  ('nps:places', 'TEST-LODGE', 'ZZ', 'Test Lodge', 'Built in 1917, the lodge is open from May to September.', 46.7801, -121.7302,
   '["NPS place"]', 'https://www.nps.gov/places/test-lodge.htm', NULL, NULL, NULL, '{"url":["https://www.nps.gov/places/test-lodge.htm"],"P8649":["test-lodge"]}');
INSERT INTO place_links VALUES ('nps:places', 'TEST-LODGE', 'wikidata', 'Q1', 'P8649', 'ZZ');
INSERT OR REPLACE INTO place_schemes VALUES ('P8649', 'National Park Service place ID'), ('P649', 'NRHP reference number');
INSERT OR REPLACE INTO place_loads VALUES ('ZZ', '2026-11-09T12:00:00Z', NULL, 2);
