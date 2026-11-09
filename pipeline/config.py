"""Rules for the spots pipeline MVP. Pilots: Washington State, and the city of Seattle in it.
Pick one with SPOTS_AREA=WA or SPOTS_AREA=SEA."""
import os

# Rough outline of Washington (lat, lng), to keep NPS places of multi-state parks inside the state.
WA_OUTLINE = [(49.0, -123.32), (49.0, -117.03), (46.0, -117.03), (46.0, -118.98), (45.93, -119.3),
              (45.67, -120.83), (45.6, -121.18), (45.71, -121.52), (45.64, -121.94), (45.6, -122.67),
              (46.1, -122.93), (46.2, -123.38), (46.22, -123.83), (46.25, -124.05), (46.25, -124.3),
              (48.4, -124.9), (48.3, -123.6), (48.4, -123.2), (48.7, -123.25), (49.0, -123.32)]
AREAS = {
    "WA": {"qid": "Q1223", "name": "Washington", "nps_state": "WA", "outline": WA_OUTLINE},
    # A city is its state's candidates inside the city's Census boundary: on Wikidata, P131 (located in)
    # often stops at the county, and 387 of 1,057 items inside Seattle don't say Seattle.
    "SEA": {"qid": "Q5083", "name": "Seattle", "nps_state": "WA", "within": "WA", "census_place": "5363000",
            "outline": None, "wikivoyage": "Seattle"},
    # Held out: nothing was tuned on these.
    "OR": {"qid": "Q824", "name": "Oregon", "nps_state": "OR", "outline": None},
    "PDX": {"qid": "Q6106", "name": "Portland", "nps_state": "OR", "within": "OR", "census_place": "4159000",
            "outline": None, "wikivoyage": "Portland (Oregon)"},
    "NM": {"qid": "Q1522", "name": "New Mexico", "nps_state": "NM", "outline": None},
    "SAF": {"qid": "Q38555", "name": "Santa Fe", "nps_state": "NM", "within": "NM", "census_place": "3570500",
            "outline": None, "wikivoyage": "Santa Fe (New Mexico)"},
}
AREA_CODE = os.environ.get("SPOTS_AREA", "WA")
AREA = AREAS[AREA_CODE]
STATE = {"code": AREA["nps_state"], "qid": AREA["qid"], "name": AREA["name"]}
OUTLINE = AREA["outline"]

# Months of pageviews used for the views signal: five full years.
VIEWS_START, VIEWS_END = "2021110100", "2026103100"

# Sight types win at any depth of P279*.
ALLOW = {
    "Q570116": "tourist attraction", "Q33506": "museum", "Q2087181": "historic house museum",
    "Q575727": "museum ship", "Q24398318": "religious building", "Q4989906": "monument",
    "Q5003624": "memorial", "Q22698": "park", "Q473972": "protected area", "Q43501": "zoo",
    "Q2281788": "public aquarium", "Q34038": "waterfall", "Q8502": "mountain", "Q8072": "volcano",
    "Q40080": "beach", "Q35509": "cave", "Q35666": "glacier", "Q177380": "hot spring",
    "Q150784": "canyon", "Q954501": "natural arch", "Q631305": "rock formation",
    "Q839954": "archaeological site", "Q23413": "castle", "Q16560": "palace", "Q1107656": "garden",
    "Q12280": "bridge", "Q12518": "tower", "Q15243209": "historic district",
    "Q132510": "market", "Q860861": "sculpture", "Q7075": "library",
    "Q6017969": "scenic viewpoint", "Q39715": "lighthouse", "Q12323": "dam",
    "Q194195": "amusement park", "Q1785071": "fort", "Q1406331": "scenic route",
    "Q800517": "National Scenic Byway", "Q133056": "mountain pass", "Q2143825": "hiking trail",
}
# Big geography: kept as context, not a spot, unless an ALLOW type also applies.
CONTEXT = {
    "Q15324": "body of water", "Q46831": "mountain range", "Q23442": "island",
    "Q1402592": "island group", "Q33837": "archipelago", "Q82794": "region", "Q34763": "peninsula",
    "Q75520": "plateau", "Q736917": "geological formation", "Q47089": "fault",
}
# Dropped unless an ALLOW type also applies.
BLOCK = {
    "Q486972": "human settlement", "Q56061": "administrative territorial entity",
    "Q4830453": "business", "Q43229": "organization", "Q2385804": "educational institution",
    "Q12819564": "station", "Q34442": "road", "Q16917": "hospital", "Q27686": "hotel",
    "Q11707": "restaurant", "Q213441": "shop", "Q5": "human", "Q1190554": "occurrence",
    "Q327333": "government agency", "Q12973014": "sports team", "Q1076486": "sports venue",
    "Q1248784": "airport", "Q31855": "research institute", "Q34770": "language",
    "Q1021645": "office building", "Q3947": "house", "Q11755880": "residential building",
    "Q42889": "vehicle", "Q1048525": "golf course",
    "Q41710": "ethnic group", "Q189349": "urban legend",
    "Q2431196": "audiovisual work", "Q26401003": "individual animal", "Q44377": "tunnel", "Q728937": "railway line",
    "Q27997185": "tram line", "Q1378975": "convention center",
}

# No longer there, whatever else they are.
GONE = {"Q19860854": "destroyed building or structure", "Q96084375": "former building or structure",
        "Q811683": "proposed building or structure"}
# Wikidata often doesn't say a place has closed, was pulled down or was never built (the Alaskan
# Way Viaduct, Living Computers), or types something that isn't a place as one (Bobo the gorilla as a
# museum). English Wikipedia's categories do. Matched against each category, case-insensitively.
GONE_CATEGORIES = r"\b(demolished|destroyed|defunct|unbuilt|disestablished|cancelled|canceled|proposed)\b"
# ...and only when the category is about this kind of place: "Zoos disestablished in the 20th century"
# is about the zoo Manito Park once had, not the park. A category's noun -> the sight types it fits;
# None fits any place.
CATEGORY_KINDS = {
    "buildings": None, "structures": None, "landmarks": None, "venues": None, "piers": None,
    "theatres": None, "theaters": None, "attractions": None, "rides": None,
    "museums": {"museum", "historic house museum", "museum ship"}, "galleries": {"museum"},
    "zoos": {"zoo"}, "aquaria": {"public aquarium"}, "aquariums": {"public aquarium"},
    "parks": {"park", "amusement park", "garden", "protected area"}, "bridges": {"bridge"},
    "skyscrapers": {"tower"}, "towers": {"tower"}, "hotels": set(),
    "sculptures": {"sculpture", "monument", "memorial"}, "monuments": {"sculpture", "monument", "memorial"},
}
NOT_PLACE_CATEGORIES = r"\b(television (series|seasons)|individual (animals|gorillas|primates|whales))\b"

# Bot-written Wikipedias, left out of the language count.
BOT_WIKIS = {"cebwiki", "warwiki", "svwiki", "arzwiki", "azbwiki", "viwiki", "zh_min_nanwiki", "cewiki"}
NOT_WIKIPEDIA = {"commonswiki", "specieswiki", "metawiki", "mediawikiwiki", "wikidatawiki",
                 "sourceswiki", "wikimaniawiki", "outreachwiki", "incubatorwiki", "foundationwiki"}

# A place must have existed this long (inception year at most this).
MAX_INCEPTION_YEAR = 2022

# Tier 1, worth a journey: both signals well above the rest.
TIER1 = {"views": 3000, "langs": 5}
# Tier 2, worth a detour: above the absolute floor. Languages are left out of the floor: many
# US places people drive to (Hurricane Ridge, the Ballard Locks) have only 1-2 Wikipedias.
FLOOR = {"views": 300, "langs": 0}
# The floor by kind of place. Nature is under-read on Wikipedia (state parks, falls); ordinary
# churches, bridges and buildings are over-read. Views per month.
FLOORS = {"nature": 150, "sight": 150, "default": FLOOR["views"], "common": 500, "neutral": 1000}
NATURE = {"protected area", "waterfall", "mountain", "volcano", "beach", "cave", "glacier", "hot spring",
          "canyon", "natural arch", "rock formation", "scenic viewpoint", "mountain pass", "hiking trail"}
# What people go to see in a town: low floor, since a city's gardens and small museums get fewer
# views than its office towers.
SIGHT = {"tourist attraction", "museum", "historic house museum", "museum ship", "zoo", "public aquarium",
         "garden", "park", "sculpture", "monument", "memorial", "market", "historic district",
         "archaeological site", "castle", "palace", "fort", "lighthouse", "amusement park"}
# A place whose only sight types are these is "common". Types on neither list are "neutral".
COMMON = {"religious building", "bridge"}
# A cap on how many tier 2 spots one area keeps; None keeps them all. A cap of 12 in 60 km
# dropped Snoqualmie Falls and the Museum of Flight around Seattle.
RADIUS_KM, LOCAL_TOP = 60, None


# An NPS place with no Wikidata item is a tier 2 spot when this many NPS pages of its park
# (place pages and things to do) mention it. Words too generic to count as a mention:
NPS_MIN_PAGES = 4
NPS_GENERIC = {"beach", "switchback", "trail", "lake", "overlook", "campground", "visitor center",
               "restrooms", "parking", "moments in time", "picnic area", "boat launch", "amphitheater"}
# Facilities, not sights, however often NPS pages mention them.
NPS_FACILITY = ("entrance", "campground", "ranger station", "picnic area", "resort", "lodge",
                "restroom", "dump station", "rv park", "memorial")

# Small things (a statue, a fountain) are seen on the way round a bigger spot, not driven to: they
# hang under the spot they're in or next to, and show on its card. Matched against type labels.
SMALL_TYPES = r"sculpture|statue|fountain|totem|memorial|monument|\bbust\b|mural|plaque|public art|\bgate\b"
# What a small thing can hang under, and how close it must be when Wikidata doesn't say.
HOSTS = {"park", "garden", "museum", "historic district", "protected area", "zoo", "market", "tourist attraction"}
HOST_M = 200
# A small thing this well known stays a spot of its own (Fremont Troll, 5,668 views a month).
SMALL_ALONE_VIEWS = 2000
# Small things with no host, two or more within this of each other, make one stop named after
# their neighbourhood (Fremont: the Rocket and Waiting for the Interurban).
GROUP_M = 700
