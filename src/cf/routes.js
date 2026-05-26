const { cfRequest } = require('./cfApi');
const { getCfAccessToken } = require('./cfTokenProvider');

async function getRoutesForApp(appGuid) {

  const token = await getCfAccessToken();

  const response = await cfRequest(
    token,
    'GET',
    `/v3/apps/${appGuid}/routes`
  );

  const routes = response.resources || [];

  const finalRoutes = [];

  for (const route of routes) {

    try {

      const host =
        route.host || '';

      const path =
        route.path || '';

      const domainGuid =
        route.relationships?.domain?.data?.guid;

      if (!domainGuid) {
        continue;
      }

      // Fetch domain details
      const domainResponse = await cfRequest(
        token,
        'GET',
        `/v3/domains/${domainGuid}`
      );

      const domainName =
        domainResponse.name;

      let fullUrl = host;

      if (path) {
        fullUrl += path;
      }

      fullUrl += `.${domainName}`;

      finalRoutes.push({
        guid: route.guid,
        host,
        domain: domainName,
        path,
        url: fullUrl
      });

    } catch (_) {

      // ignore bad routes
    }
  }

  return finalRoutes;
}

module.exports = {
  getRoutesForApp
};