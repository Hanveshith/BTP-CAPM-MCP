// ─────────────────────────────────────────────────────────────────────────────
// RFC 9728 — OAuth 2.0 Protected Resource Metadata
// ─────────────────────────────────────────────────────────────────────────────
// Claude reads this after receiving the WWW-Authenticate challenge to discover
// the authorization server URL.
//
// CRITICAL: The `authorization_servers` array must point back to THIS server
// (APP_URL), NOT to XSUAA directly.  Claude will then fetch
// APP_URL/.well-known/oauth-authorization-server for endpoint URLs.

const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');

const {
  xsuaa,
  APP_URL,
  OUR_CALLBACK_URI
} = require('../config/env');

const {
  clients,
  pendingAuthorizations,
  authorizationCodes
} = require('../cache/memoryStore');

const protectedResourceMetadata = () => ({
  resource                            : `${APP_URL}/mcp`,
  authorization_servers               : [APP_URL],
  bearer_methods_supported            : ['header'],
  resource_signing_alg_values_supported: ['RS256'],
  resource_documentation              : APP_URL
});

// RFC 9728 §3: canonical location
router.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.set('Content-Type', 'application/json');
  res.json(protectedResourceMetadata());
});

// RFC 9728 §3 also allows path-suffixed form for sub-resources
router.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
  res.set('Content-Type', 'application/json');
  res.json(protectedResourceMetadata());
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 8414 — OAuth 2.0 Authorization Server Metadata
// ─────────────────────────────────────────────────────────────────────────────
// Claude reads this to learn authorize/token/registration endpoints.
// The `issuer` must equal APP_URL exactly (no trailing slash).

router.get('/.well-known/oauth-authorization-server', (_req, res) => {
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
router.get('/.well-known/openid-configuration', (_req, res) => {
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

router.post('/register', (req, res) => {
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

router.get('/oauth/authorize', (req, res) => {
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

router.get('/oauth/callback', (req, res) => {
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

router.post('/oauth/token', async (req, res) => {
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

module.exports = router;