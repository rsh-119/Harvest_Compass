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


def normalize_market(name: str) -> str:
    """'Ashta  APMC' -> 'ashta apmc'. Used in the mandi key (normalised market, district)."""
    return re.sub(r"\s+", " ", name).strip().lower()


def market_town(name: str) -> str:
    """'Mhow (Ambedkar Nagar) (F&V) APMC' -> 'Mhow'. The searchable place name for geocoding."""
    town = re.sub(r"\(.*?\)|\bAPMC\b", " ", name)
    return re.sub(r"\s+", " ", town).strip()
