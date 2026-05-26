const axios = require('axios');

const tokenCache =
  require('../cache/tokenCache');

function isExpired(expiresAt) {

  return Date.now() >= expiresAt;
}

async function exchangeUserToken(
  userJwt,
  targetXsuaa,
  appGuid
) {

  const cacheKey =
    `${appGuid}:${targetXsuaa.clientid}`;

  // cache hit
  if (tokenCache.has(cacheKey)) {

    const cached =
      tokenCache.get(cacheKey);

    if (
      cached?.access_token &&
      !isExpired(cached.expires_at)
    ) {

      console.log(
        'TOKEN CACHE HIT:',
        cacheKey
      );

      return cached.access_token;
    }

    console.log(
      'TOKEN CACHE EXPIRED:',
      cacheKey
    );

    tokenCache.remove(cacheKey);
  }

  console.log(
    'EXCHANGING TOKEN:',
    cacheKey
  );

  const response =
    await axios.post(

      `${targetXsuaa.url}/oauth/token`,

      new URLSearchParams({

        grant_type:
          'urn:ietf:params:oauth:grant-type:jwt-bearer',

        response_type:
          'token',

        client_id:
          targetXsuaa.clientid,

        client_secret:
          targetXsuaa.clientsecret,

        assertion:
          userJwt

      }),

      {
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        }
      }
    );

  const accessToken =
    response.data.access_token;

  const expiresIn =
    response.data.expires_in || 3600;

  // cache token
  tokenCache.set(
    cacheKey,
    {
      access_token:
        accessToken,

      expires_at:
        Date.now() +
        ((expiresIn - 60) * 1000)
    }
  );

  console.log(
    'TOKEN CACHE SET:',
    cacheKey
  );

  return accessToken;
}

module.exports = {
  exchangeUserToken
};