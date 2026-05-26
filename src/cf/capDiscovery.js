const axios = require('axios');

const { getAppsInSpace } = require('./apps');
const { getRoutesForApp } = require('./routes');
const {
  getXsuaaBinding
} = require('./serviceBindings');
const {
  exchangeUserToken
} = require('./tokenExchange');

async function discoverCapServices(spaceGuid, userToken) {

  const apps = await getAppsInSpace(spaceGuid);

  const probableSrvApps = apps.filter(app =>
    app.state === 'STARTED' &&
    (
      app.name.endsWith('-srv') ||
      app.name.includes('srv')
    )
  );

  const discovered = [];

  for (const app of probableSrvApps) {

    try {
      const binding =
        await getXsuaaBinding(app.guid);
      const exchangedToken =
        await exchangeUserToken(
          userToken,
          binding.xsuaa,
          app.guid
        )

      const routes =
        await getRoutesForApp(app.guid);

      for (const route of routes) {

        if (!route.url) {
          continue;
        }

        const baseUrl =
          `https://${route.url}`;

        const candidateRoots = [
          '/mainService'
        ];

        for (const rootPath of candidateRoots) {

          const serviceRoot =
            `${baseUrl}${rootPath}`;
          console.log('PROBING:', serviceRoot);

          try {

            const response = await axios.get(
              serviceRoot,
              {
                timeout: 5000,
                maxRedirects: 5,
                validateStatus: () => true,
                headers: {
                  Authorization:
                    `Bearer ${exchangedToken}`
                }
              }
            );
            const services =
              response.data?.value || [];

            if (
              Array.isArray(services) &&
              services.length > 0
            ) {

              discovered.push({
                app_name: app.name,
                app_guid: app.guid,
                route: baseUrl,
                service_root: serviceRoot,
                services: services.map(service => ({
                  name: service.name,
                  url: service.url
                })),
                type: 'odata'
              });

              break;
            }

          } catch (err) {

            console.log(
              'PROBE ERROR:',
              err.message,
              serviceRoot
            );
          }
        }
      }

    } catch (err) {

      console.log(
        'APP DISCOVERY ERROR:',
        err.message,
        app.name
      );
    }
  }

  return discovered;
}

module.exports = {
  discoverCapServices
};