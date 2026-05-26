async function handleInitialize(req, res, body) {

  return res.json({
    jsonrpc: '2.0',
    id: body.id,
    result: {
      protocolVersion: body?.params?.protocolVersion || '2024-11-05',
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: 'sap-btp-mcp-server',
        version: '1.0.0'
      }
    }
  });
}

module.exports = {
  handleInitialize
};