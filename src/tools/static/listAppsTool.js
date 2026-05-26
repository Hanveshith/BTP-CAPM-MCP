const { getAppsInSpace } = require('../../cf/apps');

const tool = {
  name: 'list_cf_apps',
  description:
    'List Cloud Foundry apps in a given space',

  inputSchema: {
    type: 'object',
    properties: {
      space_guid: {
        type: 'string',
        description: 'Cloud Foundry Space GUID'
      }
    },
    required: ['space_guid']
  }
};

async function execute(args = {}) {

  try {

    const apps = await getAppsInSpace(
      args.space_guid
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(apps, null, 2)
        }
      ],
      isError: false
    };

  } catch (err) {

    console.error(
      'CF APPS ERROR:',
      err.response?.data || err.message
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            err.response?.data || err.message,
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