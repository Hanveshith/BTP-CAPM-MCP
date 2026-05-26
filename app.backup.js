'use strict';

/**
 * SAP BTP Cloud Foundry — MCP Server with XSUAA OAuth
 *
 * Architecture: This server acts as an OAuth proxy/shim between Claude and XSUAA.
 * XSUAA does not support Dynamic Client Registration natively, so we implement
 * a thin OAuth layer on top of XSUAA that:
 *   1. Accepts Claude's dynamic client registration
 *   2. Proxies authorize requests to XSUAA (using our bound service credentials)
 *   3. Handles the XSUAA callback, then redirects to Claude with an internal code
 *   4. At token exchange, swaps the internal code → XSUAA code → real XSUAA JWT
 *   5. Returns the real XSUAA JWT to Claude
 *   6. Validates incoming Bearer tokens with @sap/xssec
 *
 * Full OAuth flow:
 *   Claude → POST /mcp (no token)
 *     ← 401 WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"
 *   Claude → GET /.well-known/oauth-protected-resource
 *     ← { authorization_servers: [APP_URL] }
 *   Claude → GET /.well-known/oauth-authorization-server
 *     ← { authorization_endpoint, token_endpoint, registration_endpoint }
 *   Claude → POST /register
 *     ← { client_id, client_secret }
 *   Claude → GET /oauth/authorize?client_id=...&code_challenge=...&redirect_uri=<claude_cb>
 *     ← 302 → XSUAA /oauth/authorize?client_id=<xsuaa_cid>&redirect_uri=<our_callback>
 *   XSUAA → User Login
 *   XSUAA → GET /oauth/callback?code=<xsuaa_code>&state=<internal_state>
 *     ← 302 → <claude_cb>?code=<internal_code>&state=<original_state>
 *   Claude → POST /oauth/token { code=<internal_code>, code_verifier, redirect_uri }
 *     (we verify PKCE, then exchange internal_code for xsuaa_code with XSUAA)
 *     ← { access_token: <real_xsuaa_jwt>, ... }
 *   Claude → POST /mcp Authorization: Bearer <xsuaa_jwt>
 *     ← MCP JSON-RPC response
 */

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const xsenv   = require('@sap/xsenv');
const xssec   = require('@sap/xssec');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

let xsuaa;
try {
  xsuaa = xsenv.getServices({ xsuaa: { tag: 'xsuaa' } }).xsuaa;
} catch (err) {
  console.error('[FATAL] Cannot load XSUAA service binding:', err.message);
  console.error('        Ensure the XSUAA service is bound and the app is running on BTP CF.');
  process.exit(1);
}

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const PORT    = process.env.PORT || 3000;

if (!APP_URL) {
  console.error('[FATAL] APP_URL environment variable must be set (e.g. https://myapp.cfapps.eu10.hana.ondemand.com)');
  process.exit(1);
}

// The redirect_uri we register with XSUAA — our own callback
const OUR_CALLBACK_URI = `${APP_URL}/oauth/callback`;

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stores  (single-instance; sufficient for MCP use case)
// ─────────────────────────────────────────────────────────────────────────────

/** client_id → { client_id, client_secret, redirect_uris, created_at, ... } */
const clients = new Map();

/**
 * internalState → {
 *   client_id, claude_redirect_uri, original_state,
 *   code_challenge, code_challenge_method, created_at
 * }
 */
const pendingAuthorizations = new Map();

/**
 * internalCode → {
 *   xsuaa_code, client_id, claude_redirect_uri,
 *   code_challenge, code_challenge_method, created_at
 * }
 */
const authorizationCodes = new Map();

// Cleanup expired entries every 5 minutes
const CODE_TTL_MS  = 10 * 60 * 1000; // 10 min
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authorizationCodes)    if (now - v.created_at > CODE_TTL_MS)  authorizationCodes.delete(k);
  for (const [k, v] of pendingAuthorizations) if (now - v.created_at > STATE_TTL_MS) pendingAuthorizations.delete(k);
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// CORS  — Claude issues cross-origin requests to the metadata + token endpoints
// ─────────────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Accept',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version'
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Request logging
// ─────────────────────────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 9728 — OAuth 2.0 Protected Resource Metadata
// ─────────────────────────────────────────────────────────────────────────────
// Claude reads this after receiving the WWW-Authenticate challenge to discover
// the authorization server URL.
//
// CRITICAL: The `authorization_servers` array must point back to THIS server
// (APP_URL), NOT to XSUAA directly.  Claude will then fetch
// APP_URL/.well-known/oauth-authorization-server for endpoint URLs.

const protectedResourceMetadata = () => ({
  resource                            : `${APP_URL}/mcp`,
  authorization_servers               : [APP_URL],
  bearer_methods_supported            : ['header'],
  resource_signing_alg_values_supported: ['RS256'],
  resource_documentation              : APP_URL
});

// RFC 9728 §3: canonical location
app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.set('Content-Type', 'application/json');
  res.json(protectedResourceMetadata());
});

// RFC 9728 §3 also allows path-suffixed form for sub-resources
app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
  res.set('Content-Type', 'application/json');
  res.json(protectedResourceMetadata());
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 8414 — OAuth 2.0 Authorization Server Metadata
// ─────────────────────────────────────────────────────────────────────────────
// Claude reads this to learn authorize/token/registration endpoints.
// The `issuer` must equal APP_URL exactly (no trailing slash).

app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer                                   : APP_URL,
    authorization_endpoint                   : `${APP_URL}/oauth/authorize`,
    token_endpoint                           : `${APP_URL}/oauth/token`,
    registration_endpoint                    : `${APP_URL}/register`,
    response_types_supported                 : ['code'],
    response_modes_supported                 : ['query'],
    grant_types_supported                    : ['authorization_code'],
    code_challenge_methods_supported         : ['S256'],
    token_endpoint_auth_methods_supported    : ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported                         : ['openid', 'profile', 'email'],
    subject_types_supported                  : ['public'],
    require_pkce                             : true
  });
});

// Some Claude versions probe OpenID Connect discovery instead
app.get('/.well-known/openid-configuration', (_req, res) => {
  res.json({
    issuer                               : APP_URL,
    authorization_endpoint               : `${APP_URL}/oauth/authorize`,
    token_endpoint                       : `${APP_URL}/oauth/token`,
    registration_endpoint                : `${APP_URL}/register`,
    response_types_supported             : ['code'],
    grant_types_supported                : ['authorization_code'],
    code_challenge_methods_supported     : ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported                     : ['openid', 'profile', 'email']
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Client Registration — RFC 7591
// ─────────────────────────────────────────────────────────────────────────────
// Claude REQUIRES this endpoint.  Without it the OAuth flow never starts.
// We create virtual clients (stored in memory) backed by our single XSUAA binding.

app.post('/register', (req, res) => {
  const {
    redirect_uris,
    client_name,
    grant_types,
    response_types,
    token_endpoint_auth_method
  } = req.body;

  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({
      error            : 'invalid_client_metadata',
      error_description: 'redirect_uris is required and must be a non-empty array'
    });
  }

  const clientId     = `mcp_${crypto.randomBytes(12).toString('hex')}`;
  const clientSecret = crypto.randomBytes(24).toString('hex');

  const record = {
    client_id                 : clientId,
    client_secret             : clientSecret,
    redirect_uris,
    client_name               : client_name || 'Claude MCP Client',
    grant_types               : grant_types   || ['authorization_code'],
    response_types            : response_types || ['code'],
    token_endpoint_auth_method: token_endpoint_auth_method || 'client_secret_post',
    created_at                : Date.now()
  };

  clients.set(clientId, record);
  console.log(`[REGISTER] client_id=${clientId}  redirect_uris=${redirect_uris.join(', ')}`);

  return res.status(201).json({
    client_id                 : clientId,
    client_secret             : clientSecret,
    client_id_issued_at       : Math.floor(Date.now() / 1000),
    redirect_uris,
    client_name               : record.client_name,
    grant_types               : record.grant_types,
    response_types            : record.response_types,
    token_endpoint_auth_method: record.token_endpoint_auth_method
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /oauth/authorize
// ─────────────────────────────────────────────────────────────────────────────
// Claude's browser lands here after the user is redirected.
// We validate the virtual client, store the PKCE data, then forward to XSUAA.
//
// CRITICAL: We do NOT forward Claude's code_challenge to XSUAA.
//           PKCE is handled ENTIRELY between Claude and this server.
//           We use a NEW, separate state for the XSUAA leg.

app.get('/oauth/authorize', (req, res) => {
  const {
    client_id,
    redirect_uri,
    state            : originalState,
    response_type,
    code_challenge,
    code_challenge_method,
    scope
  } = req.query;

  // ── Validate client ──────────────────────────────────────────────────────
  const client = clients.get(client_id);
  if (!client) {
    console.warn(`[AUTHORIZE] Unknown client_id: ${client_id}`);
    return res.status(400).send('<h2>OAuth Error</h2><p>Unknown client_id</p>');
  }

  // ── Validate redirect_uri ────────────────────────────────────────────────
  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
    console.warn(`[AUTHORIZE] Invalid redirect_uri: ${redirect_uri}`);
    return res.status(400).send('<h2>OAuth Error</h2><p>redirect_uri not registered for this client</p>');
  }

  if (response_type !== 'code') {
    return res.status(400).send('<h2>OAuth Error</h2><p>Only response_type=code is supported</p>');
  }

  // ── Generate internal state for XSUAA leg ────────────────────────────────
  const internalState = crypto.randomBytes(20).toString('hex');

  pendingAuthorizations.set(internalState, {
    client_id,
    claude_redirect_uri  : redirect_uri,   // where we must send Claude after login
    original_state       : originalState,  // Claude's state — MUST be returned unchanged
    code_challenge       : code_challenge  || null,
    code_challenge_method: code_challenge_method || 'S256',
    created_at           : Date.now()
  });

  // ── Build XSUAA authorization URL ────────────────────────────────────────
  // We use our XSUAA service-binding credentials and our own callback URI.
  const xsuaaUrl = new URL(`${xsuaa.url}/oauth/authorize`);
  xsuaaUrl.searchParams.set('response_type', 'code');
  xsuaaUrl.searchParams.set('client_id',     xsuaa.clientid);
  xsuaaUrl.searchParams.set('redirect_uri',  OUR_CALLBACK_URI);
  xsuaaUrl.searchParams.set('state',         internalState);
  // Only request openid scope if XSUAA supports it — fall back to nothing
//   if (scope) xsuaaUrl.searchParams.set('scope', scope);

  console.log(`[AUTHORIZE] → XSUAA for client ${client_id}`);
  return res.redirect(302, xsuaaUrl.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /oauth/callback   (XSUAA redirects here after user login)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/oauth/callback', (req, res) => {
  const {
    code  : xsuaaCode,
    state : internalState,
    error,
    error_description
  } = req.query;

  if (error) {
    console.error(`[CALLBACK] XSUAA error: ${error} — ${error_description}`);
    return res.status(400).send(`<h2>Login Failed</h2><p>${error}: ${error_description || ''}</p>`);
  }

  const pending = pendingAuthorizations.get(internalState);
  if (!pending) {
    console.error(`[CALLBACK] No pending auth for state ${internalState}`);
    return res.status(400).send('<h2>OAuth Error</h2><p>State parameter invalid or expired. Please try again.</p>');
  }

  // Consume the pending entry — single use
  pendingAuthorizations.delete(internalState);

  // ── Generate an internal authorization code to hand to Claude ─────────────
  const internalCode = crypto.randomBytes(32).toString('hex');

  authorizationCodes.set(internalCode, {
    xsuaa_code          : xsuaaCode,
    client_id           : pending.client_id,
    claude_redirect_uri : pending.claude_redirect_uri,
    code_challenge      : pending.code_challenge,
    code_challenge_method: pending.code_challenge_method,
    created_at          : Date.now()
  });

  console.log(`[CALLBACK] Code generated for client ${pending.client_id} → redirecting to Claude`);

  // ── Redirect Claude to its redirect_uri with our internal code ───────────
  const dest = new URL(pending.claude_redirect_uri);
  dest.searchParams.set('code', internalCode);
  if (pending.original_state) dest.searchParams.set('state', pending.original_state);

  return res.redirect(302, dest.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /oauth/token
// ─────────────────────────────────────────────────────────────────────────────
// Claude POSTs here with its internal code + code_verifier.
// We verify PKCE, look up the XSUAA code, exchange it for a real XSUAA JWT,
// and return that JWT verbatim to Claude.
//
// CRITICAL: Return the raw XSUAA token response — do NOT wrap or reissue.
//           @sap/xssec at /mcp validates against xsuaa.url issuer.

app.post('/oauth/token', async (req, res) => {
  // ── Extract client credentials (body or Basic Auth) ───────────────────────
  let clientId     = req.body.client_id;
  let clientSecret = req.body.client_secret;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const [id, secret] = Buffer.from(authHeader.slice(6), 'base64').toString('utf8').split(':');
      if (!clientId)     clientId     = id;
      if (!clientSecret) clientSecret = secret;
    } catch (_) { /* ignore malformed basic auth */ }
  }

  const { grant_type, code, redirect_uri, code_verifier } = req.body;

  console.log(`[TOKEN] grant_type=${grant_type} client_id=${clientId}`);

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  if (!code) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'code is required' });
  }

  // ── Look up internal code ─────────────────────────────────────────────────
  const codeData = authorizationCodes.get(code);
  if (!codeData) {
    console.warn(`[TOKEN] Unknown or expired code: ${code.substring(0, 8)}…`);
    return res.status(400).json({
      error            : 'invalid_grant',
      error_description: 'Authorization code not found or expired'
    });
  }

  // ── Validate client ───────────────────────────────────────────────────────
  const effectiveClientId = clientId || codeData.client_id;
  const client = clients.get(effectiveClientId);
  if (!client) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client' });
  }

  // ── Validate redirect_uri ─────────────────────────────────────────────────
  // RFC 6749 §4.1.3: redirect_uri MUST match if it was included in the auth request
  if (redirect_uri && redirect_uri !== codeData.claude_redirect_uri) {
    console.warn(`[TOKEN] redirect_uri mismatch. Got: ${redirect_uri} | Expected: ${codeData.claude_redirect_uri}`);
    return res.status(400).json({
      error            : 'invalid_grant',
      error_description: 'redirect_uri does not match authorization request'
    });
  }

  // ── Verify PKCE (S256) ────────────────────────────────────────────────────
  if (codeData.code_challenge) {
    if (!code_verifier) {
      return res.status(400).json({
        error            : 'invalid_grant',
        error_description: 'code_verifier is required (PKCE)'
      });
    }
    const computed = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (computed !== codeData.code_challenge) {
      console.warn('[TOKEN] PKCE verification failed');
      return res.status(400).json({
        error            : 'invalid_grant',
        error_description: 'PKCE code_verifier verification failed'
      });
    }
    console.log('[TOKEN] PKCE verified ✓');
  }

  // Single-use: delete now (before network call to prevent replay under failure)
  authorizationCodes.delete(code);

  // ── Exchange XSUAA code for real tokens ───────────────────────────────────
  // We use our XSUAA service binding credentials (clientid / clientsecret)
  // and the redirect_uri we sent to XSUAA originally (OUR_CALLBACK_URI).
  try {
    const params = new URLSearchParams({
      grant_type   : 'authorization_code',
      code         : codeData.xsuaa_code,
      redirect_uri : OUR_CALLBACK_URI,       // must match what we sent to XSUAA
      client_id    : xsuaa.clientid,
      client_secret: xsuaa.clientsecret
    });

    console.log(`[TOKEN] Exchanging with XSUAA: ${xsuaa.url}/oauth/token`);

    const xsuaaResp = await axios.post(
      `${xsuaa.url}/oauth/token`,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept'      : 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('[TOKEN] XSUAA exchange successful ✓');
    // Return XSUAA token response verbatim to Claude
    return res.status(200).json(xsuaaResp.data);

  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[TOKEN] XSUAA exchange failed:', detail);
    return res.status(400).json({
      error            : 'invalid_grant',
      error_description: 'Token exchange with authorization server failed'
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// JWT Validation helper  (@sap/xssec)
// ─────────────────────────────────────────────────────────────────────────────

function validateXsuaaToken(token) {
  return new Promise((resolve, reject) => {
    // @sap/xssec v3 callback-based API
    // Validates: signature, iss (XSUAA tenant), aud (xsappname), exp
    xssec.createSecurityContext(token, xsuaa, (err, secCtx) => {
      if (err) return reject(err);
      resolve(secCtx);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WWW-Authenticate helper
// ─────────────────────────────────────────────────────────────────────────────
// RFC 9728 §3 — the resource_metadata URL tells Claude exactly where to discover
// the authorization server.  This is the single most important header.
// If this header is wrong or missing, Claude will never start the OAuth flow.

function sendOAuthChallenge(res, body = {}) {
  return res
    .status(401)
    .set('WWW-Authenticate',
      `Bearer realm="MCP Server", ` +
      `resource_metadata="${APP_URL}/.well-known/oauth-protected-resource"`)
    .json({ jsonrpc: '2.0', id: null, ...body });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST/GET /mcp  — MCP JSON-RPC endpoint
// ─────────────────────────────────────────────────────────────────────────────

app.all('/mcp', async (req, res) => {
  // ── Step 1: Require Bearer token ────────────────────────────────────────
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[MCP] No Bearer token — issuing OAuth challenge');
    return sendOAuthChallenge(res, { error: { code: -32001, message: 'Unauthorized' } });
  }

  const token = authHeader.slice(7);

  // ── Step 2: Validate XSUAA JWT ──────────────────────────────────────────
  let secCtx;
  try {
    secCtx = await validateXsuaaToken(token);
    const identity =
      (typeof secCtx.getEmail   === 'function' && secCtx.getEmail())   ||
      (typeof secCtx.getLogonName === 'function' && secCtx.getLogonName()) ||
      'unknown';
    console.log(`[MCP] Token valid — user: ${identity}`);
  } catch (err) {
    console.warn('[MCP] Token validation failed:', err.message);
    return res
      .status(401)
      .set('WWW-Authenticate',
        `Bearer realm="MCP Server", ` +
        `error="invalid_token", ` +
        `error_description="Token validation failed"`)
      .json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid or expired token' } });
  }

  // ── Step 3: Handle GET (health / SSE ping from Claude) ──────────────────
  if (req.method === 'GET') {
    return res.json({ status: 'ok', server: 'SAP BTP MCP Server', version: '1.0.0' });
  }

  // ── Step 4: Handle JSON-RPC ─────────────────────────────────────────────
  const body   = req.body || {};
  const { method, params, id } = body;

  console.log(`[MCP] method=${method}  id=${id}`);

  // Notifications are fire-and-forget — no JSON-RPC response needed
  if (typeof method === 'string' && method.startsWith('notifications/')) {
    return res.status(202).end();
  }

  switch (method) {

    // ── initialize ─────────────────────────────────────────────────────────
    case 'initialize':
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: {
            name   : 'sap-btp-mcp-server',
            version: '1.0.0'
          },
          instructions: 'SAP BTP MCP Server running on Cloud Foundry. Authenticated via XSUAA.'
        }
      });

    // ── ping ───────────────────────────────────────────────────────────────
    case 'ping':
      return res.json({ jsonrpc: '2.0', id, result: {} });

    // ── tools/list ─────────────────────────────────────────────────────────
    case 'tools/list':
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name       : 'hello_btp',
              description: 'Greet a user from SAP BTP Cloud Foundry',
              inputSchema: {
                type      : 'object',
                properties: {
                  name: {
                    type       : 'string',
                    description: 'Name to greet'
                  }
                },
                required: []
              }
            },
            {
              name       : 'get_server_info',
              description: 'Returns information about this MCP server and its BTP environment',
              inputSchema: {
                type      : 'object',
                properties: {},
                required  : []
              }
            }
          ]
        }
      });

    // ── tools/call ─────────────────────────────────────────────────────────
    case 'tools/call': {
      const toolName = params?.name;
      const args     = params?.arguments || {};

      if (toolName === 'hello_btp') {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: `Hello from SAP BTP Cloud Foundry, ${args.name || 'World'}! 🚀\nAuthenticated via XSUAA.`
            }],
            isError: false
          }
        });
      }

      if (toolName === 'get_server_info') {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                server      : 'sap-btp-mcp-server',
                version     : '1.0.0',
                platform    : 'SAP BTP Cloud Foundry',
                auth        : 'XSUAA',
                xsuaa_url   : xsuaa.url,
                timestamp   : new Date().toISOString()
              }, null, 2)
            }],
            isError: false
          }
        });
      }

      return res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` }
      });
    }

    // ── unknown method ─────────────────────────────────────────────────────
    default:
      return res.json({
        jsonrpc: '2.0',
        id    : id ?? null,
        error : { code: -32601, message: `Method not found: ${method}` }
      });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status    : 'ok',
    timestamp : new Date().toISOString(),
    app_url   : APP_URL,
    xsuaa_url : xsuaa.url
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' SAP BTP MCP Server (XSUAA OAuth)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(` Port    : ${PORT}`);
  console.log(` APP_URL : ${APP_URL}`);
  console.log(` XSUAA   : ${xsuaa.url}`);
  console.log('─────────────────────────────────────────────────────────');
  console.log(` Protected Resource : ${APP_URL}/.well-known/oauth-protected-resource`);
  console.log(` Auth Server Meta   : ${APP_URL}/.well-known/oauth-authorization-server`);
  console.log(` Register           : ${APP_URL}/register`);
  console.log(` Authorize          : ${APP_URL}/oauth/authorize`);
  console.log(` Token              : ${APP_URL}/oauth/token`);
  console.log(` MCP                : ${APP_URL}/mcp`);
  console.log('═══════════════════════════════════════════════════════════');
});