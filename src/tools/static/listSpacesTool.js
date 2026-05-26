const { getUserSpaces } = require('../../cf/spaces');

const tool = {
  name: 'list_cf_spaces',
  description: 'List Cloud Foundry spaces available to the authenticated user',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

async function execute(args, context = {}) {

  const token = context.token;

  try {

  const spaces = await getUserSpaces();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(spaces, null, 2)
      }
    ],
    isError: false
  };

} catch (err) {

  console.error(
    'CF SPACE ERROR:',
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