"""Places each area must have in a tier, or must not, checked on every run (step5_checks.py)."""
from config import AREA_CODE

CANARIES = {
    "WA": {
        # Must be tier 1.
        "tier1": ["Mount Rainier National Park", "Olympic National Park", "North Cascades National Park",
                  "Mount St. Helens", "Space Needle", "Pike Place Market", "Grand Coulee Dam"],
        # Must be tier 1 or 2.
        "any": ["Mount Rainier", "Snoqualmie Falls", "Palouse Falls", "Hoh Rainforest", "Hurricane Ridge",
                "Deception Pass Bridge", "Museum of Pop Culture", "Chihuly Garden and Glass", "The Museum of Flight",
                "Ruby Beach", "Lake Crescent", "Diablo Lake", "Gum Wall", "Hiram M. Chittenden Locks",
                "Gas Works Park", "Kerry Park", "Fremont Troll", "Lake Chelan", "Mount Baker", "Dry Falls",
                "Cape Flattery", "Sol Duc Falls", "Maryhill Museum of Art", "Maryhill Stonehenge",
                "Fort Worden", "Riverfront Park", "Manito Park and Botanical Gardens", "Steamboat Rock State Park",
                "Cape Disappointment State Park", "Beacon Rock State Park", "Washington Pass", "North Cascades Highway",
                "Chuckanut Drive", "Paradise", "Sunrise", "Marymere Falls", "Lake Quinault", "Artist Point",
                "Wonderland Trail", "Bloedel Reserve", "Olympic Sculpture Park", "Seattle Great Wheel",
                "Smith Tower", "Pioneer Square", "Point Defiance Park", "Museum of Glass",
                "Johnston Ridge Observatory", "Ape Cave", "Grand Coulee", "Leavenworth"],
        # Must not be in any tier.
        "never": ["Bill Gates's house", "Bluetooth Special Interest Group", "Microsoft Redmond campus",
                  "Lake Washington", "University of Washington", "Columbia River", "KEXP-FM",
                  "Q16985269",  # Tacoma Narrows Bridge (1940), which fell in 1940
                  "Lumen Field", "T-Mobile Park"],
    },
    "SEA": {
        "tier1": ["Space Needle", "Pike Place Market", "Museum of Pop Culture"],
        "any": ["Chihuly Garden and Glass", "Gum Wall", "Hiram M. Chittenden Locks", "Gas Works Park", "Kerry Park",
                "Fremont Troll", "Olympic Sculpture Park", "Seattle Great Wheel", "Smith Tower", "Pioneer Square",
                "Seattle Art Museum", "Seattle Central Library", "Discovery Park", "Volunteer Park",
                "Seattle Japanese Garden", "Washington Park Arboretum", "Alki Beach Park", "Green Lake Park",
                "Klondike Gold Rush National Historical Park", "Wing Luke Museum of the Asian Pacific American Experience",
                "Museum of History & Industry", "Burke Museum of Natural History and Culture", "Seattle Aquarium",
                "Woodland Park Zoo", "Seattle Underground", "Columbia Center", "Golden Gardens Park",
                "Original Starbucks", "Seattle Asian Art Museum", "Frye Art Museum", "National Nordic Museum",
                "Statue of Lenin, Seattle", "Waterfall Garden Park", "Lake View Cemetery"],
        # Stadiums and university campuses count as sights (decided 2026-11-09).
        "never": ["KEXP-FM", "Lake Washington", "Elliott Bay", "Harborview Medical Center", "Seattle City Hall",
                  "Seattle Public Schools", "King County Courthouse"],
    },
}.get(AREA_CODE, {"tier1": [], "any": [], "never": []})  # held-out areas have none
