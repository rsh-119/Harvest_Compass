"""States where the law puts the mandi market fee on the BUYER, so the farmer's fee is zero.

Only states whose Act or a Supreme Court ruling we have read are listed (checked 1 Nov 2026).
Every other state is left out on purpose: no rule is applied there, and the answer says any
market fee isn't included. Bihar (APMC Act repealed 2006; private markets reportedly charge
farmers too) and Kerala (no APMC Act) are left out for the same reason.
"""

# ponytail: buyer-pays states only; a state where the seller pays would need a rate column.
BUYER_PAYS: dict[str, str] = {
    "Madhya Pradesh": "MP Krishi Upaj Mandi Adhiniyam 1972, Sec 19(2)",
    "Uttar Pradesh": "UP Krishi Utpadan Mandi Adhiniyam 1964, Sec 17(iii)(b); Supreme Court, "
    "Krishi Utpadan Mandi Samiti v. Indian Wood Products, AIR 1996 SC 1251",
    "Punjab": "Punjab Agricultural Produce Markets Act 1961, Sec 23; Supreme Court, "
    "State of Punjab v. Guranditta Mal Shanti Prakash, 5 May 2004",
    "Rajasthan": "Rajasthan Agricultural Produce Markets Act 1961, Sec 17 "
    "(collected from licensed traders)",
    "Karnataka": "Karnataka Agricultural Produce Marketing (R&D) Act 1966, Sec 65(2)",
    "Andhra Pradesh": "AP (Agricultural Produce and Livestock) Markets Act 1966, Sec 12(2)",
    "Telangana": "Telangana (Agricultural Produce and Livestock) Markets Act 1966, Sec 12(2)",
}
