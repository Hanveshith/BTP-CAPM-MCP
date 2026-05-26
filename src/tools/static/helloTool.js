const tool = {
  name: 'hello_btp',
  description: 'Greet a user from SAP BTP Cloud Foundry',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string'
      }
    },
    required: []
  }
};

async function execute(args = {}) {
  return {
    content: [
      {
        type: 'text',
        text: `Hello from SAP BTP, ${args.name || 'World'}!`
      }
    ],
    isError: false
  };
}

module.exports = {
  tool,
  execute
};