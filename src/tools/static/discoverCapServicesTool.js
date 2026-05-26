const {
  discoverCapServices
} = require('../../cf/capDiscovery');


const tool = {
  name: 'discover_cap_services',

  description:
    'Discover CAP/OData services in a Cloud Foundry space',

  inputSchema: {
    type: 'object',
    properties: {
      space_guid: {
        type: 'string'
      }
    },
    required: ['space_guid']
  }
};

async function execute(args = {}, context) {

  try {

    const services =
      await discoverCapServices(
        args.space_guid,
        context.token
      );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            services,
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