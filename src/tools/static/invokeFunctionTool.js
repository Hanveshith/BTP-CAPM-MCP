const {
  invokeFunction
} = require('../../cf/functions');

const tool = {

  name:
    'invoke_function',

  description:
    'Invoke a function endpoint',

  inputSchema: {

    type: 'object',

    properties: {

      function_url: {
        type: 'string'
      }
    },

    required: [
      'function_url'
    ]
  }
};

async function execute(
  args = {},
  context
) {

  try {

    const result =
  await invokeFunction(

    args.app_guid,

    args.function_url,

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

    return {

      content: [
        {
          type: 'text',

          text:
            err.message
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