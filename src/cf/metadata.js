const axios = require('axios');

const {
  getXsuaaBinding
} = require('./serviceBindings');

const {
  exchangeUserToken
} = require('./tokenExchange');

async function getServiceMetadata(
  appGuid,
  serviceRoot,
  serviceUrl,
  userToken
) {

  // discover target app xsuaa
  const xsuaaBinding =
    await getXsuaaBinding(appGuid);

  if (!xsuaaBinding?.xsuaa) {

    throw new Error(
      'No XSUAA binding found for app'
    );
  }

  console.log(
    'METADATA XSUAA:',
    JSON.stringify(xsuaaBinding, null, 2)
  );

  // token exchange
  // now internally cached
  const exchangedToken =
    await exchangeUserToken(
      userToken,
      xsuaaBinding.xsuaa,
      appGuid
    );

  console.log(
    'TOKEN READY FOR METADATA'
  );

const normalizedUrl =
  serviceUrl.replace(/\/$/, '');

const metadataUrl =
  serviceUrl.endsWith('$metadata')
    ? serviceUrl
    : `${serviceUrl.replace(/\/$/, '')}/$metadata`;

  console.log(
    'FETCHING METADATA:',
    metadataUrl
  );

  const response =
    await axios.get(
      metadataUrl,
      {
        timeout: 10000,

        headers: {
          Authorization:
            `Bearer ${exchangedToken}`
        }
      }
    );

  console.log(
    'METADATA FETCH SUCCESS:',
    metadataUrl
  );

  return {

    metadata_url:
      metadataUrl,

    metadata:
      response.data
  };
}

module.exports = {
  getServiceMetadata
};