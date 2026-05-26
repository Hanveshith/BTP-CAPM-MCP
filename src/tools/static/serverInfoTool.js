const { xsuaa } = require('../../config/env');

const tool = {
  name: 'get_server_info',
  description: 'Returns MCP server information',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

async function execute() {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          platform: 'SAP BTP CF',
          auth: 'XSUAA',
          xsuaa: xsuaa.url,
          timestamp: new Date().toISOString()
        }, null, 2)
      }
    ],
    isError: false
  };
}

module.exports = {
  tool,
  execute
};