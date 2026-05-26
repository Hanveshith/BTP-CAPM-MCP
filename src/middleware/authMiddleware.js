const { validateXsuaaToken } = require('../auth/xsuaa');
const { APP_URL } = require('../config/env');

function sendOAuthChallenge(res, body = {}) {
  return res
    .status(401)
    .set(
      'WWW-Authenticate',
      `Bearer realm="MCP Server", resource_metadata="${APP_URL}/.well-known/oauth-protected-resource"`
    )
    .json({
      jsonrpc: '2.0',
      id: null,
      ...body
    });
}

async function requireAuth(req, res, next) {

  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendOAuthChallenge(res, {
      error: {
        code: -32001,
        message: 'Unauthorized'
      }
    });
  }

  const token = authHeader.slice(7);
  req.accessToken = token;

  try {

    const secCtx = await validateXsuaaToken(token);

    req.securityContext = secCtx;

    next();

  } catch (err) {

    return res
      .status(401)
      .set(
        'WWW-Authenticate',
        'Bearer realm="MCP Server", error="invalid_token"'
      )
      .json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message: 'Invalid or expired token'
        }
      });
  }
}

module.exports = {
  requireAuth,
  sendOAuthChallenge
};