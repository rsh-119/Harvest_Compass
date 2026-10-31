# Voice test (M6): 10 real recordings

Record on a phone with real team voices (not generated speech). Mix speakers and add background noise to some.
Save as `recordings/01.m4a` … `recordings/10.m4a` (the folder is gitignored).
Score: the intent counts as correct when crop, quantity and village match the expected values (or the agent asks the right question).

| # | Script | Expected crop | Qty | Village | Expected behaviour |
|---|---|---|---|---|---|
| 01 | मेरे पास 40 क्विंटल सोयाबीन है, गाँव सांवेर, कहाँ बेचूँ? | Soyabean | 40 q | Sanwer | answer (after the vehicle question) |
| 02 | चालीस बोरी सोयाबीन, देपालपुर के पास, अगले हफ्ते कटाई करनी है | Soyabean | 40 bori | Depalpur | asks kg per bori |
| 03 | पंद्रह क्विंटल प्याज़ निकल चुका है, महू से हूँ | Onion | 15 q | Mhow | already harvested → no harvest window |
| 04 | कांदा बेचना है बीस क्विंटल, गाँव हातोद | Onion | 20 q | Hatod | "kanda" → Onion |
| 05 | soybean ready hai 25 quintal, Sanwer side, mandi kaunsi achhi rahegi? | Soyabean | 25 q | Sanwer | Hinglish |
| 06 | मेरा गाँव रामपुर है, सोयाबीन तीस क्विंटल | Soyabean | 30 q | Rampur | asks which Rampur |
| 07 | अगर तीन दिन रुकूँ तो भाव बढ़ेगा क्या? पचास क्विंटल सोयाबीन, उज्जैन | Soyabean | 50 q | Ujjain | wait_days = 3, "trend, not forecast" |
| 08 | प्याज़ दस क्विंटल, बारिश तो नहीं होगी ना कटाई के टाइम? | Onion | 10 q | — | asks village |
| 09 | गेहूं बेचना है | Wheat | — | — | polite "only soybean/onion" |
| 10 | (said quickly, fan/traffic noise) e.g. 35 क्विंटल सोयाबीन, गाँव देवास | Soyabean | 35 q | Dewas | answer |

## Results
(to fill: transcript, extracted intent, correct? for each clip)
