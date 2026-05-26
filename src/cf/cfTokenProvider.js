const axios = require('axios');

const CF_AUTH_URL =
  'https://login.cf.us10-001.hana.ondemand.com';

let cachedToken = null;
let tokenExpiry = 0;

async function getCfAccessToken() {

  const now = Date.now();

  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    grant_type: 'password',
    username: process.env.CF_USERNAME,
    password: process.env.CF_PASSWORD
  });

  const response = await axios.post(
    `${CF_AUTH_URL}/oauth/token`,
    params.toString(),
    {
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      },
      auth: {
        username: 'cf',
        password: ''
      }
    }
  );

  cachedToken = response.data.access_token;

  tokenExpiry =
    now + ((response.data.expires_in - 60) * 1000);

  return cachedToken;
}

module.exports = {
  getCfAccessToken
};