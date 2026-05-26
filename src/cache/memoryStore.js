const clients = new Map();
const pendingAuthorizations = new Map();
const authorizationCodes = new Map();

const CODE_TTL_MS = 10 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();

  for (const [k, v] of authorizationCodes) {
    if (now - v.created_at > CODE_TTL_MS) {
      authorizationCodes.delete(k);
    }
  }

  for (const [k, v] of pendingAuthorizations) {
    if (now - v.created_at > STATE_TTL_MS) {
      pendingAuthorizations.delete(k);
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  clients,
  pendingAuthorizations,
  authorizationCodes
};