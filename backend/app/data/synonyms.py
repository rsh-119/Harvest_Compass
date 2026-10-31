"""Reference vocabulary only (allowed by the no-dummy-data rule): names, not numbers."""

import re

# data.gov.in district spellings that Nominatim does not resolve (found in the M0 coverage
# query). Map to the spelling OpenStreetMap uses.
DISTRICT_ALIASES: dict[str, str] = {
    "Badwani": "Barwani",
    "Shehdol": "Shahdol",
    "Anupur": "Anuppur",
}

# data.gov.in mandi town -> (OpenStreetMap spelling, OSM district if it differs). Each one was
# checked by hand on Nominatim on 31 Oct 2026. Names only: coordinates always come from OSM.
# Agar, Badod and Soyat Kalan moved to the new Agar Malwa district; data.gov.in still says Shajapur.
# Still unmapped (excluded and named): Barad (Shivpuri), Chhapiheda (Rajgarh; OSM has one only in
# Shajapur), Sheopurbadod (OSM has only the tahsil).
MANDI_TOWN_ALIASES: dict[str, tuple[str, str | None]] = {
    "A lot": ("Alot", None),
    "Agar": ("Agar", "Agar Malwa"),
    "Akodiya": ("Akodia", None),
    "Badamalhera": ("Bada Malhera", None),
    "Badod": ("Badod", "Agar Malwa"),
    "Badwaha": ("Barwaha", None),
    "Badwani": ("Barwani", None),
    "Berachha": ("Berchha", None),
    "Bhensdehi": ("Bhainsdehi", None),
    "Bherunda": ("Nasrullaganj", None),  # Bherunda is the new name of Nasrullaganj
    "Gadakota": ("Garhakota", None),
    "Gadarwada": ("Gadarwara", None),
    "Ganjbasoda": ("Ganj Basoda", None),
    "Haatpipliya": ("Hatpipliya", None),
    "Harsood": ("Harsud", None),
    "Jeerapur": ("Jirapur", None),
    "Lashkar": ("Gwalior", None),  # Lashkar is Gwalior's old city; OSM has no separate place
    "Mungawali": ("Mungaoli", None),
    "Naugaon": ("Nowgong", None),
    "Obedullaganj": ("Obaidullaganj", None),
    "Paatan": ("Patan", None),
    "Pachaur": ("Pachore", None),
    "Rehati": ("Rehti", None),
    "Semriharchand": ("Semri Harchand", None),
    "Shahagarh": ("Shahgarh", None),
    "Sheopurkalan": ("Sheopur", None),
    "Soyatkalan": ("Soyat Kalan", "Agar Malwa"),
    "Suvasra": ("Suwasra", None),
    "Taal": ("Tal", None),
}


# Sub-yards named "<main yard>(<town>)": the yard is in the town in brackets, which market_town()
# would strip. Checked on OpenStreetMap (Nominatim) on 1 Nov 2026:
#   Vinchur = OSM node 4026062333, village in Niphad Taluka, Nashik (about 4 km from Lasalgaon)
#   Niphad  = OSM node 650711320, town, Niphad Taluka, Nashik (about 15 km from Lasalgaon)
# Keyed by the market name lowercased with spaces removed. Names only: coordinates come from OSM.
SUB_YARD_TOWNS: dict[str, tuple[str, str]] = {
    "lasalgaon(vinchur)": ("Vinchur", "Nashik"),
    "lasalgaon(niphad)": ("Niphad", "Nashik"),
}


def sub_yard_town(name: str) -> tuple[str, str] | None:
    return SUB_YARD_TOWNS.get(re.sub(r"\s+", "", name).lower())


def normalize_market(name: str) -> str:
    """'Ashta  APMC' -> 'ashta apmc'. Used in the mandi key (normalised market, district)."""
    return re.sub(r"\s+", " ", name).strip().lower()


# Market-type words around the town name, seen in the feed: 'PMY Bilaspur' (Himachal principal /
# sub market yard), 'Adimali VFPCK Market' (Kerala), 'APMC/MAC Shopian', 'MAC F&V Market Narwal'.
_NOT_TOWN = re.compile(
    r"\(.*?\)|/|\b(?:APMC|PMY|SMY|VFPCK|MAC|Market Administrative Committee"
    r"|Fruit and Vegetable|F&V|Market)\b",
    re.IGNORECASE,
)


def market_town(name: str) -> str:
    """'Mhow (Ambedkar Nagar) (F&V) APMC' -> 'Mhow'. The searchable place name for geocoding."""
    return re.sub(r"\s+", " ", _NOT_TOWN.sub(" ", name)).strip()
