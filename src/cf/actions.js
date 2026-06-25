const axios = require('axios');

const {
  getXsuaaBinding
} = require('./serviceBindings');

const {
  exchangeUserToken
} = require('./tokenExchange');

async function invokeAction(
  appGuid,
  actionUrl,
  actionPayload,
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
    'INVOKING ACTION:',
    actionUrl
  );

  console.log(
    'ACTION PAYLOAD:',
    JSON.stringify(
      actionPayload,
      null,
      2
    )
  );

  try {

    const response =
      await axios.post(
        actionUrl,
        actionPayload,
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

    console.log(
      'ACTION RESPONSE:',
      response.status
    );

    return {

      action_url:
        actionUrl,

      status:
        response.status,

      result:
        response.data
    };

  } catch (err) {

    console.log(
      'ACTION ERROR STATUS:',
      err.response?.status
    );

    console.log(
      'ACTION ERROR DATA:',
      JSON.stringify(
        err.response?.data,
        null,
        2
      )
    );

    throw err;
  }
}

module.exports = {
  invokeAction
};