"""Reference vocabulary only (allowed by the no-dummy-data rule): names, not numbers."""

import re

# Farmer words -> commodity name exactly as data.gov.in spells it.
CROP_SYNONYMS: dict[str, str] = {
    "soyabean": "Soyabean",
    "soybean": "Soyabean",
    "soya": "Soyabean",
    "soyabeen": "Soyabean",
    "सोयाबीन": "Soyabean",
    "सोया": "Soyabean",
    "onion": "Onion",
    "pyaaz": "Onion",
    "pyaz": "Onion",
    "piyaz": "Onion",
    "kanda": "Onion",
    "प्याज": "Onion",
    "प्याज़": "Onion",
    "कांदा": "Onion",
}

PERISHABLE = {"Onion", "Tomato"}

# data.gov.in district spellings that Nominatim does not resolve (found in the M0 coverage
# query). Map to the spelling OpenStreetMap uses.
DISTRICT_ALIASES: dict[str, str] = {
    "Badwani": "Barwani",
    "Shehdol": "Shahdol",
}


def normalize_crop(word: str) -> str | None:
    return CROP_SYNONYMS.get(word.strip().lower())


def normalize_market(name: str) -> str:
    """'Ashta  APMC' -> 'ashta apmc'. Used in the mandi key (normalised market, district)."""
    return re.sub(r"\s+", " ", name).strip().lower()


def market_town(name: str) -> str:
    """'Mhow (Ambedkar Nagar) (F&V) APMC' -> 'Mhow'. The searchable place name for geocoding."""
    town = re.sub(r"\(.*?\)|\bAPMC\b", " ", name)
    return re.sub(r"\s+", " ", town).strip()
