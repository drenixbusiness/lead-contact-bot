require('dotenv').config();

const e = (k, d = '') => (process.env[k] ?? d).split('#')[0].trim();
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

module.exports = {
  monday: {
    token: e('MONDAY_TOKEN'),
    // vergul bilan bir nechta board: MONDAY_BOARD_IDS=1,2,3 (eski MONDAY_BOARD_ID ham ishlaydi)
    boardIds: list(e('MONDAY_BOARD_IDS') || e('MONDAY_BOARD_ID')),
    // har maydon uchun ustun nomi variantlari (vergul bilan); birinchi to'ldirilgani olinadi
    cols: {
      number: list(e('COL_NUMBER', 'Number,Phone')),
      arrival: list(e('COL_ARRIVAL', 'Date')),
      platform: list(e('COL_PLATFORM', 'Platform')),
      driverType: list(e('COL_DRIVER_TYPE', 'Position')),
      status: list(e('COL_STATUS', "Status',Status")),
      recruiter: list(e('COL_RECRUITER', 'Recruiter')),
      assigned: list(e('COL_ASSIGNED', '')),
    },
  },
  defaults: {
    recruiter: e('DEFAULT_RECRUITER'),
    leadType: e('DEFAULT_LEAD_TYPE'),
  },
  rc: {
    server: e('RC_SERVER', 'https://platform.ringcentral.com'),
    clientId: e('RC_CLIENT_ID'),
    clientSecret: e('RC_CLIENT_SECRET'),
    jwt: e('RC_JWT'),
    accountWide: e('RC_ACCOUNT_WIDE', 'true') === 'true',
    includeSms: e('RC_INCLUDE_SMS', 'true') === 'true',
    activityTab: e('RC_ACTIVITY_TAB', 'RingCentral'),
    storeFile: e('RC_STORE_FILE', './rc-store.json'), // RC tarixi (faqat lead raqamlari) — o'chirmang
    smsCountsAsContact: e('RC_SMS_COUNTS_AS_CONTACT', 'false') === 'true',
  },
  sheets: {
    keyFile: e('GOOGLE_SERVICE_ACCOUNT_FILE', './service-account.json'),
    clientEmail: e('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    // e() ishlatilmaydi; literal "\n" larni haqiqiy qator ko'chirishga aylantiramiz
    privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim(),
    sheetId: e('GOOGLE_SHEET_ID') || e('SHEET_ID'),
    tab: e('GOOGLE_SHEET_NAME') || e('SHEET_TAB', 'Leads'),
  },
  bot: {
    tz: e('TZ_NAME', 'America/Chicago'),
    sinceHours: Number(e('SINCE_HOURS', '48')),
    refreshDays: Number(e('REFRESH_DAYS', '7')),
    pollMinutes: Number(e('POLL_MINUTES', '10')),
  },
};
