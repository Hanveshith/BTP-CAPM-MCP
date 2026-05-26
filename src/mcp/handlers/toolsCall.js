const helloTool = require('../../tools/static/helloTool');
const serverInfoTool = require('../../tools/static/serverInfoTool');
const listSpacesTool = require('../../tools/static/listSpacesTool');
const listAppsTool =
  require('../../tools/static/listAppsTool');
const discoverCapServicesTool =
  require('../../tools/static/discoverCapServicesTool');
const getServiceMetadataTool =
  require('../../tools/static/getServiceMetadataTool');
const queryEntityTool =
  require('../../tools/static/queryEntityTool');
const createEntityRecordTool =
  require('../../tools/static/createEntityRecordTool');

const toolRegistry = {
  hello_btp: helloTool.execute,
  get_server_info: serverInfoTool.execute,
  list_cf_spaces: listSpacesTool.execute,
  list_cf_apps: listAppsTool.execute,
  discover_cap_services:
  discoverCapServicesTool.execute,
  get_service_metadata:
  getServiceMetadataTool.execute,
  query_entity_data:
  queryEntityTool.execute,
  create_entity_record:
  createEntityRecordTool.execute
};

async function handleToolsCall(req, res, body) {

  const toolName = body?.params?.name;
  const args = body?.params?.arguments || {};

  const toolExecutor = toolRegistry[toolName];

  if (!toolExecutor) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: {
        code: -32601,
        message: `Unknown tool: ${toolName}`
      }
    });
  }

  const result = await toolExecutor(args, {
  token: req.accessToken,
  securityContext: req.securityContext
});

  return res.json({
    jsonrpc: '2.0',
    id: body.id,
    result
  });
}

module.exports = {
  handleToolsCall
};