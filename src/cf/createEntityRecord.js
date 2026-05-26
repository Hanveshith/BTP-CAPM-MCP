const axios = require('axios');

const {
  getXsuaaBinding
} = require('./serviceBindings');

const {
  exchangeUserToken
} = require('./tokenExchange');

async function createEntityRecord(
  appGuid,
  entityUrl,
  payload,
  userToken
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

  console.log(
    'CREATING ENTITY RECORD:',
    entityUrl
  );

  console.log(
    'CREATE PAYLOAD:',
    JSON.stringify(payload, null, 2)
  );

  const response =
    await axios.post(
      entityUrl,
      payload,
      {
        timeout: 10000,

        headers: {

          Authorization:
            `Bearer ${exchangedToken}`,

          'Content-Type':
            'application/json'
        }
      }
    );

  return {

    entity_url:
      entityUrl,

    created:
      response.data
  };
}

module.exports = {
  createEntityRecord
};