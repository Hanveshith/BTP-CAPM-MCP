const axios = require('axios');

const CF_API_URL =
  process.env.CF_API_URL ||
  'https://api.cf.us10-001.hana.ondemand.com';

async function cfRequest(token, method, path, data = null) {

  const response = await axios({
    method,
    url: `${CF_API_URL}${path}`,
    data,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  return response.data;
}

module.exports = {
  CF_API_URL,
  cfRequest
};