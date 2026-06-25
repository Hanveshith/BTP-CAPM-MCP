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
const updateEntityRecordTool =  require('../../tools/static/updateEntityRecordTool');
const deleteEntityRecordTool =  require('../../tools/static/deleteEntityRecordTool');
const invokeActionTool =  require('../../tools/static/invokeActionTool');
const invokeFunctionTool =  require('../../tools/static/invokeFunctionTool');

async function handleToolsList(req, res, body) {

  return res.json({
    jsonrpc: '2.0',
    id: body.id,
    result: {
      tools: [
        helloTool.tool,
        serverInfoTool.tool,
        listSpacesTool.tool,
        listAppsTool.tool,
        discoverCapServicesTool.tool,
        getServiceMetadataTool.tool,
        queryEntityTool.tool,
        createEntityRecordTool.tool,
        updateEntityRecordTool.tool,
        deleteEntityRecordTool.tool,
        invokeActionTool.tool,
        invokeFunctionTool.tool
      ]
    }
  });
}

module.exports = {
  handleToolsList
};