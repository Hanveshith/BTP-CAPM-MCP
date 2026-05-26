const xsenv = require('@sap/xsenv');

let xsuaa;
const CF_CLIENT_ID = process.env.CF_CLIENT_ID;
const CF_CLIENT_SECRET = process.env.CF_CLIENT_SECRET;
const CF_AUTH_URL = process.env.CF_AUTH_URL;

try {
  xsuaa = xsenv.getServices({
    xsuaa: { tag: 'xsuaa' }
  }).xsuaa;
} catch (err) {
  console.error('[FATAL] Cannot load XSUAA service binding:', err.message);
  process.exit(1);
}

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

const OUR_CALLBACK_URI = `${APP_URL}/oauth/callback`;

module.exports = {
  xsuaa,
  APP_URL,
  PORT,
  OUR_CALLBACK_URI,
    CF_CLIENT_ID,
    CF_CLIENT_SECRET,
    CF_AUTH_URL
};