const { cfRequest } = require('./cfApi');
const { getCfAccessToken } = require('./cfTokenProvider');

async function getUserSpaces() {

  const token = await getCfAccessToken();

  const response = await cfRequest(
    token,
    'GET',
    '/v3/spaces'
  );

  const spaces = response.resources || [];

  return spaces.map(space => ({
    guid: space.guid,
    name: space.name
  }));
}

module.exports = {
  getUserSpaces
};