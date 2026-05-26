const {
  getServiceMetadata
} = require('../../cf/metadata');

const tool = {

  name:
    'get_service_metadata',

  description:
    'Fetch OData metadata for a CAP service',

  inputSchema: {

    type: 'object',

    properties: {

      app_guid: {
        type: 'string'
      },

      service_root: {
        type: 'string'
      },

      service_url: {
        type: 'string'
      }
    },

    required: [
      'app_guid',
      'service_root',
      'service_url'
    ]
  }
};

async function execute(
  args = {},
  context
) {

  try {

    const result =
      await getServiceMetadata(

        args.app_guid,

        args.service_root,

        args.service_url,

        context.token
      );

    return {

      content: [
        {
          type: 'text',

          text: JSON.stringify(
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

          text: JSON.stringify(
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