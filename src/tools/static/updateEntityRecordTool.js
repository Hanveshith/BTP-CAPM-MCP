const {
  updateEntityRecord
} = require('../../cf/updateEntityRecord');

const tool = {

  name:
    'update_entity_record',

  description:
    'Update a CAP entity record dynamically',

  inputSchema: {

    type: 'object',

    properties: {

      app_guid: {
        type: 'string'
      },

      entity_url: {
        type: 'string'
      },

      payload: {
        type: 'object'
      }
    },

    required: [
      'app_guid',
      'entity_url',
      'payload'
    ]
  }
};

async function execute(
  args = {},
  context
) {

  try {

    const result =
      await updateEntityRecord(

        args.app_guid,

        args.entity_url,

        args.payload,

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