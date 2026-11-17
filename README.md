# lead-contact-bot

Monday lead -> RingCentral (bizdan chiqqan call/SMS) -> Google Sheets.
Number ustuni Sheets'da doim bo'sh; raqam faqat xotirada ishlatiladi.

## Ishga tushirish
1. `npm install`
2. `cp .env.example .env` va to'ldir (Monday token+board ID, RC JWT app, Google service account, SHEET_ID)
3. Sheets'ni service account email'iga Editor qilib share qil
4. `npm run inspect`  -> Monday ustun nomlarini ko'r, .env dagi COL_* ni moslab chiq
5. `npm run dry`      -> Sheets'ga yozmasdan 2 lead ni ko'rsatadi
6. `npm run test:2`   -> 2 lead ni Sheets'ga yozadi
7. `npm start` (bir marta, hammasi) yoki `npm run watch` (har POLL_MINUTES da)

## RingCentral log ("RingCentral" tab)
Har siklda leadlar bilan bo'lgan barcha call va SMS lar alohida qator bo'lib yoziladi
(Type, status, vaqt, davomiylik, HR, driver id, lead name, SMS matni / call natijasi).
- Faqat Monday "Leads" guruhidagi lead raqamlari bilan bo'lganlar olinadi.
- Birinchi ishga tushganda `RC_ACTIVITY_DAYS` (default 7) kunlik tarix olinadi.
- Qayerda to'xtagani `rc-activity-state.json` da saqlanadi — uni o'chirmang, aks holda dublikat bo'lishi mumkin.
- Faqat log: `npm run activity`. Faqat leadlar (logsiz): `node src/index.js run --no-activity`.
