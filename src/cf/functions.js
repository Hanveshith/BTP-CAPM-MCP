const axios = require('axios');

const {
  getXsuaaBinding
} = require('./serviceBindings');

const {
  exchangeUserToken
} = require('./tokenExchange');

async function invokeFunction(
  appGuid,
  functionUrl,
  userToken
) {

  const xsuaaBinding =
    await getXsuaaBinding(appGuid);

  if (!xsuaaBinding?.xsuaa) {

    throw new Error(
      'No XSUAA binding found'
    );
  }

  const exchangedToken =
    await exchangeUserToken(
      userToken,
      xsuaaBinding.xsuaa,
      appGuid
    );

  console.log(
    'INVOKING FUNCTION:',
    functionUrl
  );

  const response =
    await axios.get(
      functionUrl,
      {
        timeout: 10000,

        headers: {
          Authorization:
            `Bearer ${exchangedToken}`
        }
      }
    );

  return {

    function_url:
      functionUrl,

    result:
      response.data
  };
}

module.exports = {
  invokeFunction
};