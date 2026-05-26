const axios = require('axios');

const {
  getXsuaaBinding
} = require('./serviceBindings');

const {
  exchangeUserToken
} = require('./tokenExchange');

async function queryEntity(
  appGuid,
  entityUrl,
  userToken,
  options = {}
) {

  const xsuaaBinding =
    await getXsuaaBinding(appGuid);

  if (!xsuaaBinding?.xsuaa) {

    throw new Error(
      'No XSUAA binding found'
    );
  }

  // exchanged token
  const exchangedToken =
    await exchangeUserToken(
      userToken,
      xsuaaBinding.xsuaa,
      appGuid
    );

  // build query params
  const queryParams =
    new URLSearchParams();

  if (options.top) {
    queryParams.append(
      '$top',
      options.top
    );
  }

  if (options.skip) {
    queryParams.append(
      '$skip',
      options.skip
    );
  }

  if (options.filter) {
    queryParams.append(
      '$filter',
      options.filter
    );
  }

  if (options.select) {
    queryParams.append(
      '$select',
      options.select
    );
  }

  const finalUrl =
    queryParams.toString()
      ? `${entityUrl}?${queryParams.toString()}`
      : entityUrl;

  console.log(
    'QUERY ENTITY URL:',
    finalUrl
  );

  const response =
    await axios.get(
      finalUrl,
      {
        timeout: 10000,

        headers: {
          Authorization:
            `Bearer ${exchangedToken}`
        }
      }
    );

  return {
    entity_url: finalUrl,
    data: response.data
  };
}

module.exports = {
  queryEntity
};