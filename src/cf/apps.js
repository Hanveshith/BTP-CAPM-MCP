const { cfRequest } = require('./cfApi');
const { getCfAccessToken } = require('./cfTokenProvider');

async function getAppsInSpace(spaceGuid) {

  const token = await getCfAccessToken();

  const response = await cfRequest(
    token,
    'GET',
    `/v3/apps?space_guids=${spaceGuid}`
  );

  const apps = response.resources || [];

  return apps.map(app => ({
    guid: app.guid,
    name: app.name,
    state: app.state,
    lifecycle: app.lifecycle?.type || 'unknown'
  }));
}

module.exports = {
  getAppsInSpace
};