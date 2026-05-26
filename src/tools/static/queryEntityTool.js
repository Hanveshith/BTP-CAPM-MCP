const {
  queryEntity
} = require('../../cf/queryEntity');

const tool = {

  name:
    'query_entity_data',

  description:
    'Query CAP entity data dynamically',

  inputSchema: {

    type: 'object',

    properties: {

      app_guid: {
        type: 'string'
      },

      entity_url: {
        type: 'string'
      },

      top: {
        type: 'number'
      },

      skip: {
        type: 'number'
      },

      filter: {
        type: 'string'
      },

      select: {
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
      await queryEntity(

        args.app_guid,

        args.entity_url,

        context.token,

        {
          top:
            args.top,

          skip:
            args.skip,

          filter:
            args.filter,

          select:
            args.select
        }
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