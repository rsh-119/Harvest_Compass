# 2–3 minute demo (record from the live deployed app)

Before recording: open the link once (wakes the backend), check the source-status footer is all ✅, and ask the first question once so the cache is warm. Keep the text box ready in case the mic fails.

| Time | Do | Say / show |
|---|---|---|
| 0:00 | Tap 🎤, speak: "मेरे पास 40 क्विंटल सोयाबीन है, गाँव सांवेर, इंदौर। फसल 2 से 5 नवंबर के बीच तैयार होगी।" | Hindi voice in |
| 0:15 | Agent asks for vehicle hire → speak "35 रुपये किलोमीटर, गाड़ी में 30 क्विंटल" | It asks, never assumes a rate |
| 0:25 | Point at the live trace | Plan with reasons; prices, history and weather fetched in parallel; source and fetch time on each |
| 0:50 | Point at a ⚠️/🚫 line | e.g. "Badnagar APMC: price 25 days old" or "far from usual; treated as suspect" |
| 1:05 | Open **टेस्ट स्विच**, tick "Weather model A (ECMWF)", tap दोबारा हिसाब करें | 🔧 repair line: falls back to GFS, days marked uncertain, confidence drops |
| 1:35 | Scroll: answer card, map, comparison table, cost breakdown | Net ₹/quintal after transport; same-town label; spoken answer plays (🔊) |
| 2:00 | New question: "अगर तीन दिन रुकूँ तो भाव बढ़ेगा क्या? पचास क्विंटल सोयाबीन, उज्जैन, गोदाम है" | Wait-3-days line, labelled *trend, not forecast* |
| 2:25 | Open **पिछले 60 दिन की जाँच** | Real backtest: onion gains vs the nearest mandi; soybean about break-even. Honest numbers |
| 2:45 | End on the sources footer | Every number from data.gov.in / Open-Meteo / OSM, with timestamps |
