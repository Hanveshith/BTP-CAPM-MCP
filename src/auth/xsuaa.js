const xssec = require('@sap/xssec');
const { xsuaa } = require('../config/env');

function validateXsuaaToken(token) {
  return new Promise((resolve, reject) => {
    xssec.createSecurityContext(token, xsuaa, (err, secCtx) => {
      if (err) return reject(err);
      resolve(secCtx);
    });
  });
}

module.exports = {
  validateXsuaaToken
};