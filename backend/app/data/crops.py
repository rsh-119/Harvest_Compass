"""Crops we can advise on: commodity names exactly as data.gov.in spells them. These are the 80
most-reported commodities in the live price feed on 31 Oct 2026 (names only, no numbers).
A farmer's word is matched to one of them; anything else gets an honest "not in the price list"."""

import re

COMMODITIES = [
    "Onion", "Tomato", "Brinjal", "Wheat", "Maize", "Potato", "Paddy(Common)",
    "Bhindi(Ladies Finger)", "Green Chilli", "Banana", "Soyabean", "Cauliflower", "Cabbage",
    "Bottle gourd", "Bitter gourd", "Raddish", "Pumpkin", "Carrot", "Cucumbar(Kheera)",
    "Ridgeguard(Tori)", "Coriander(Leaves)", "Bengal Gram(Gram)(Whole)", "Banana - Green",
    "Ginger(Green)", "Beetroot", "Papaya", "Coconut", "Drumstick", "Snakeguard", "Lemon",
    "Cluster beans", "Amaranthus", "Groundnut", "Garlic", "Beans", "Ashgourd",
    "Black Gram(Urd Beans)(Whole)", "Mint(Pudina)", "Onion Green", "Green Avare(W)", "Apple",
    "Guava", "Capsicum", "Cotton", "Chow Chow", "Elephant Yam(Suran)/Amorphophallus",
    "Green Gram(Moong)(Whole)", "Mustard", "Colacasia", "Thondekai", "Sweet Potato",
    "Pomegranate", "Bajra(Pearl Millet/Cumbu)", "Mousambi(Sweet Lime)", "Yam(Ratalu)",
    "Mango(Raw-Ripe)", "Tapioca", "Cowpea(Veg)", "Knool Khol", "Jowar(Sorghum)",
    "Amla(Nelli Kai)", "Tender Coconut", "Lime", "Red gram/Arhar/Tur(whole)", "Orange",
    "Paddy(Fine/Superfine/Grade A)", "Sesamum(Sesame,Gingelly,Til)", "Spinach",
    "Chikoos(Sapota)", "Green Peas", "Rice", "Lentil(Masur)(Whole)", "Pineapple",
    "Pointed gourd(Parval)", "Water Melon", "Indian Beans(Seam)", "Guar", "French Beans(Frasbean)",
    "Paddy(Basmati)",
]  # fmt: skip

# Grains, pulses, oilseeds and fibre keep for weeks; everything else here is a vegetable or fruit
# and gets the shorter drive limit.
DURABLE = {
    "Wheat", "Maize", "Paddy(Common)", "Paddy(Fine/Superfine/Grade A)", "Paddy(Basmati)", "Rice",
    "Soyabean", "Bengal Gram(Gram)(Whole)", "Black Gram(Urd Beans)(Whole)", "Groundnut",
    "Green Gram(Moong)(Whole)", "Mustard", "Cotton", "Bajra(Pearl Millet/Cumbu)",
    "Jowar(Sorghum)", "Red gram/Arhar/Tur(whole)", "Sesamum(Sesame,Gingelly,Til)",
    "Lentil(Masur)(Whole)", "Guar", "Coconut", "Garlic",
}  # fmt: skip
PERISHABLE = set(COMMODITIES) - DURABLE

# Farmer words (Hindi, Hinglish, regional, plain English) the derived names below don't cover.
SYNONYMS = {
    "soya": "Soyabean", "soybean": "Soyabean", "soyabeen": "Soyabean", "सोयाबीन": "Soyabean",
    "pyaz": "Onion", "pyaaz": "Onion", "piyaz": "Onion", "kanda": "Onion", "प्याज": "Onion",
    "प्याज़": "Onion", "कांदा": "Onion",
    # Farmers sell rice as paddy at the mandi; milled rice ("chawal") is its own commodity.
    "rice": "Paddy(Common)", "dhan": "Paddy(Common)", "धान": "Paddy(Common)",
    "chawal": "Rice", "चावल": "Rice", "basmati": "Paddy(Basmati)",
    "gehun": "Wheat", "gehu": "Wheat", "गेहूं": "Wheat", "गेहूँ": "Wheat",
    "makka": "Maize", "makki": "Maize", "corn": "Maize", "मक्का": "Maize",
    "aloo": "Potato", "alu": "Potato", "आलू": "Potato",
    "tamatar": "Tomato", "टमाटर": "Tomato",
    "kapas": "Cotton", "कपास": "Cotton",
    "chana": "Bengal Gram(Gram)(Whole)", "चना": "Bengal Gram(Gram)(Whole)",
    "chickpea": "Bengal Gram(Gram)(Whole)",
    "sarson": "Mustard", "सरसों": "Mustard",
    "moongfali": "Groundnut", "mungfali": "Groundnut", "peanut": "Groundnut", "मूंगफली": "Groundnut",
    "arhar": "Red gram/Arhar/Tur(whole)", "tur": "Red gram/Arhar/Tur(whole)",
    "toor": "Red gram/Arhar/Tur(whole)", "pigeon pea": "Red gram/Arhar/Tur(whole)",
    "अरहर": "Red gram/Arhar/Tur(whole)", "तुअर": "Red gram/Arhar/Tur(whole)",
    "moong": "Green Gram(Moong)(Whole)", "mung bean": "Green Gram(Moong)(Whole)",
    "मूंग": "Green Gram(Moong)(Whole)",
    "urad": "Black Gram(Urd Beans)(Whole)", "उड़द": "Black Gram(Urd Beans)(Whole)",
    "masoor": "Lentil(Masur)(Whole)", "मसूर": "Lentil(Masur)(Whole)",
    "til": "Sesamum(Sesame,Gingelly,Til)", "sesame": "Sesamum(Sesame,Gingelly,Til)",
    "bajra": "Bajra(Pearl Millet/Cumbu)", "बाजरा": "Bajra(Pearl Millet/Cumbu)",
    "jowar": "Jowar(Sorghum)", "ज्वार": "Jowar(Sorghum)",
    "lahsun": "Garlic", "लहसुन": "Garlic",
    "mirch": "Green Chilli", "chilli": "Green Chilli", "मिर्च": "Green Chilli",
    "baingan": "Brinjal", "eggplant": "Brinjal", "बैंगन": "Brinjal",
    "bhindi": "Bhindi(Ladies Finger)", "okra": "Bhindi(Ladies Finger)", "भिंडी": "Bhindi(Ladies Finger)",
    "gobhi": "Cauliflower", "फूलगोभी": "Cauliflower", "patta gobhi": "Cabbage",
    "kela": "Banana", "केला": "Banana",
    # Banana in other languages; nendran is Kerala's main variety (feed: "Nendra Bale").
    "nendran": "Banana", "nendra": "Banana", "നേന്ത്രക്കായ": "Banana", "നേന്ത്രപ്പഴം": "Banana",
    "ഏത്തക്കായ": "Banana", "വാഴക്കുല": "Banana", "വാഴപ്പഴം": "Banana", "വാഴ": "Banana",
    "வாழைப்பழம்": "Banana", "வாழை": "Banana", "అరటి": "Banana", "అరటిపండు": "Banana",
    "ಬಾಳೆಹಣ್ಣು": "Banana", "ಬಾಳೆ": "Banana", "কলা": "Banana", "केळी": "Banana", "કેળા": "Banana",
}  # fmt: skip


def _derived() -> dict[str, str]:
    """'Red gram/Arhar/Tur(whole)' -> red gram, arhar, tur, red gram/arhar/tur(whole)."""
    out: dict[str, str] = {}
    for c in COMMODITIES:
        out[c.lower()] = c
        for part in re.split(r"[()/,]| - ", c):
            p = part.strip().lower()
            if len(p) > 2 and p not in ("whole", "veg", "common", "green", "w", "leaves"):
                out.setdefault(p, c)
    return out


_INDEX = _derived() | {k.lower(): v for k, v in SYNONYMS.items()}


def normalize_crop(word: str) -> str | None:
    w = word.strip().lower()
    # plurals: "onions", "tomatoes"
    return _INDEX.get(w) or _INDEX.get(w.removesuffix("s")) or _INDEX.get(w.removesuffix("es"))
