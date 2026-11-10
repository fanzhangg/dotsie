-- Spots data for the end-to-end tests (app.spec.js): one NPS place and the Wikidata item that shares its NPS place
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

-- A destination's guide for the guide preview's test: Test Lodge as Testville's one pick
DELETE FROM spot_picks WHERE destination = 'testville';
DELETE FROM spot_destinations WHERE id = 'testville';
DELETE FROM spot_guides WHERE state = 'ZZ';
INSERT INTO spot_destinations (id, name, state, kind, wikidata, built_at, counts, left_out) VALUES ('testville', 'Testville', 'ZZ', 'big city', 'Q0', '2026-11-09T12:00:00Z',
  '{"candidates":40,"sights":12,"shortlist":12,"picks":1}', '[{"source":"wikidata","id":"Q2","name":"Test Stadium","reason":"Only worth it on a game day."}]');
INSERT INTO spot_picks VALUES ('testville', 'wikidata', 'Q1', 1, 'The lodge is the reason the park has a front door.');
INSERT INTO spot_guides VALUES ('wikidata', 'Q1', 'ZZ', 'Test Lodge', 'Sleep under the beams loggers cut in 1917.',
  '[{"text":"Test Lodge was built in 1917 from logs cut on site.","sources":["https://en.wikipedia.org/wiki/Test_Lodge"]},{"text":"Its lobby still has the original stone fireplace.","sources":["https://www.nps.gov/places/test-lodge.htm"]}]',
  '[{"label":"Season","value":"Open from May to September.","source":"https://www.nps.gov/places/test-lodge.htm"}]',
  '[{"url":"https://en.wikipedia.org/wiki/Test_Lodge","kind":"wikipedia"},{"url":"https://www.nps.gov/places/test-lodge.htm","kind":"National Park Service"}]',
  '{"hero":{"file":"Test Lodge.jpg","author":"A. Photographer","licence":"CC BY-SA 4.0","page":"https://commons.wikimedia.org/wiki/File:Test_Lodge.jpg","thumb":"data:image/gif;base64,R0lGODlhAQABAAAAACw=","width":960,"height":640,"caption":"The lodge from the meadow"},"inline":[{"file":"Test fireplace.jpg","author":"B. Builder","licence":"CC0","page":"https://commons.wikimedia.org/wiki/File:Test_fireplace.jpg","thumb":"data:image/gif;base64,R0lGODlhAQABAAAAACw=","width":960,"height":640,"caption":"The stone fireplace","after_paragraph":2}]}',
  0.012, 'claude-opus-5-5', 'write v3, pictures v1', '2026-11-09T12:00:00Z');

-- Pagetown: 31 picks with nothing but a name, for the Spots page's pages (24 on a computer) and Show more (30 on a phone)
DELETE FROM spot_picks WHERE destination = 'pagetown';
DELETE FROM spot_destinations WHERE id = 'pagetown';
INSERT INTO spot_destinations (id, name, state, kind, built_at) VALUES ('pagetown', 'Pagetown', 'ZZ', 'big city', '2026-11-09T12:00:00Z');
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 31)
INSERT INTO spot_picks (destination, source, id, rank, reason) SELECT 'pagetown', 'wikidata', 'QP' || i, i, NULL FROM n;
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 31)
INSERT INTO spot_guides (source, id, state, name, one_liner, paragraphs, created_at)
  SELECT 'wikidata', 'QP' || i, 'ZZ', printf('Page spot %02d', i), 'One of many.', '[]', '2026-11-09T12:00:00Z' FROM n;
