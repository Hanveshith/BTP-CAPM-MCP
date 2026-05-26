async function handlePing(req, res, body) {
  return res.json({
    jsonrpc: '2.0',
    id: body.id,
    result: {}
  });
}

module.exports = {
  handlePing
};