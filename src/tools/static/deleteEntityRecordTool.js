const {
  deleteEntityRecord
} = require('../../cf/deleteEntityRecord');

const tool = {

  name:
    'delete_entity_record',

  description:
    'Delete a CAP entity record dynamically',

  inputSchema: {

    type: 'object',

    properties: {

      app_guid: {
        type: 'string'
      },

      entity_url: {
        type: 'string'
      }
    },

    required: [
      'app_guid',
      'entity_url'
    ]
  }
};

async function execute(
  args = {},
  context
) {

  try {

    const result =
      await deleteEntityRecord(

        args.app_guid,

        args.entity_url,

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