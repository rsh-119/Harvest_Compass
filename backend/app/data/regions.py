"""Indian states and union territories, as OpenStreetMap writes them, and how data.gov.in
(Agmarknet) spells the few that differ. The differences were read from the live price feed on
31 Oct 2026: 'Chattisgarh', 'Keralam', 'NCT of Delhi'."""

STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
    "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
]  # fmt: skip

AGMARK = {"Chhattisgarh": "Chattisgarh", "Kerala": "Keralam", "Delhi": "NCT of Delhi"}


def state_of(display_name: str) -> str | None:
    """'Sanwer, Sanwer Tahsil, Indore, Madhya Pradesh, 453551, India' -> 'Madhya Pradesh'.
    Matches whole comma-separated parts, so a village called 'Delhi Road' doesn't count."""
    parts = {p.strip() for p in display_name.split(",")}
    if "India" not in parts:  # Punjab is also a province of Pakistan
        return None
    return next((s for s in STATES if s in parts), None)


def agmark(state: str) -> str:
    return AGMARK.get(state, state)
