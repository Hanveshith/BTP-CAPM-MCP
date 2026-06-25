const {
  invokeAction
} = require('../../cf/actions');

const tool = {

  name:
    'invoke_action',

  description:
    'Invoke an action endpoint on a discovered application',

  inputSchema: {

    type: 'object',

    properties: {

      app_guid: {

        type: 'string',

        description:
          'Cloud Foundry application GUID'
      },

      action_url: {

        type: 'string',

        description:
          'Full action endpoint URL'
      },

      action_payload: {

        type: 'object',

        description:
          'JSON payload sent to the action'
      }
    },

    required: [
      'app_guid',
      'action_url'
    ]
  }
};

async function execute(
  args = {},
  context
) {

  try {

    console.log(
      'ACTION REQUEST:',
      JSON.stringify(
        args,
        null,
        2
      )
    );

    if (!args.app_guid) {

      throw new Error(
        'app_guid is required'
      );
    }

    if (!args.action_url) {

      throw new Error(
        'action_url is required'
      );
    }

    const result =
      await invokeAction(

        args.app_guid,

        args.action_url,

        args.action_payload || {},

        context.token
      );

    return {

      content: [
        {
          type: 'text',

          text:
            JSON.stringify(
              result,
              null,
              2
            )
        }
      ],

      isError: false
    };

  } catch (err) {

    console.log(
      'ACTION TOOL ERROR:',
      err.message
    );

    return {

      content: [
        {
          type: 'text',

          text:
            JSON.stringify(
              err.response?.data ||
              err.message,
              null,
              2
            )
        }
      ],

      isError: true
    };
  }
}

module.exports = {
  tool,
  execute
};