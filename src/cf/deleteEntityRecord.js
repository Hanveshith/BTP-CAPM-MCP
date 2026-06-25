const axios = require('axios');

const {
  getXsuaaBinding
} = require('./serviceBindings');

const {
  exchangeUserToken
} = require('./tokenExchange');

async function deleteEntityRecord(
  appGuid,
  entityUrl,
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
    'DELETING ENTITY:',
    entityUrl
  );

  const response =
    await axios.delete(
      entityUrl,
      {
        timeout: 10000,

        headers: {

          Authorization:
            `Bearer ${exchangedToken}`
        }
      }
    );

  return {

    entity_url:
      entityUrl,

    deleted:
      true,

    status:
      response.status
  };
}

module.exports = {
  deleteEntityRecord
};