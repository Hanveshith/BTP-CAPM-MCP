const express = require('express');

const { requireAuth } = require('../middleware/authMiddleware');

const { handleInitialize } = require('./handlers/initialize');
const { handlePing } = require('./handlers/ping');
const { handleToolsList } = require('./handlers/toolsList');
const { handleToolsCall } = require('./handlers/toolsCall');

const router = express.Router();

router.all('/mcp', requireAuth, async (req, res) => {

  if (req.method === 'GET') {
    return res.json({
      status: 'ok'
    });
  }

  const body = req.body || {};
  const method = body.method;

  if (typeof method === 'string' && method.startsWith('notifications/')) {
    return res.status(202).end();
  }

  switch (method) {

    case 'initialize':
      return handleInitialize(req, res, body);

    case 'ping':
      return handlePing(req, res, body);

    case 'tools/list':
      return handleToolsList(req, res, body);

    case 'tools/call':
      return handleToolsCall(req, res, body);

    default:
      return res.json({
        jsonrpc: '2.0',
        id: body.id || null,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      });
  }
});

module.exports = router;