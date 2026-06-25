// const axios = require('axios');

// const { getAppsInSpace } = require('./apps');
// const { getRoutesForApp } = require('./routes');
// const {
//   getXsuaaBinding
// } = require('./serviceBindings');
// const {
//   exchangeUserToken
// } = require('./tokenExchange');

// async function discoverCapServices(spaceGuid, userToken) {

//   const apps = await getAppsInSpace(spaceGuid);

//   const probableSrvApps = apps.filter(app =>
//     app.state === 'STARTED' &&
//     (
//       app.name.endsWith('-srv') ||
//       app.name.includes('srv')
//     )
//   );

//   const discovered = [];

//   for (const app of probableSrvApps) {

//     try {
//       const binding =
//         await getXsuaaBinding(app.guid);
//       const exchangedToken =
//         await exchangeUserToken(
//           userToken,
//           binding.xsuaa,
//           app.guid
//         )

//       const routes =
//         await getRoutesForApp(app.guid);

//       for (const route of routes) {

//         if (!route.url) {
//           continue;
//         }

//         const baseUrl =
//           `https://${route.url}`;

//         const candidateRoots = [
//           '/mainService'
//         ];

//         for (const rootPath of candidateRoots) {

//           const serviceRoot =
//             `${baseUrl}${rootPath}`;
//           console.log('PROBING:', serviceRoot);

//           try {

//             const response = await axios.get(
//               serviceRoot,
//               {
//                 timeout: 5000,
//                 maxRedirects: 5,
//                 validateStatus: () => true,
//                 headers: {
//                   Authorization:
//                     `Bearer ${exchangedToken}`
//                 }
//               }
//             );
//             const services =
//               response.data?.value || [];

//             if (
//               Array.isArray(services) &&
//               services.length > 0
//             ) {

//               discovered.push({
//                 app_name: app.name,
//                 app_guid: app.guid,
//                 route: baseUrl,
//                 service_root: serviceRoot,
//                 services: services.map(service => ({
//                   name: service.name,
//                   url: service.url
//                 })),
//                 type: 'odata'
//               });

//               break;
//             }

//           } catch (err) {

//             console.log(
//               'PROBE ERROR:',
//               err.message,
//               serviceRoot
//             );
//           }
//         }
//       }

//     } catch (err) {

//       console.log(
//         'APP DISCOVERY ERROR:',
//         err.message,
//         app.name
//       );
//     }
//   }

//   return discovered;
// }

// module.exports = {
//   discoverCapServices
// };

const axios = require('axios');
const cheerio = require('cheerio');

const { getAppsInSpace } = require('./apps');
const { getRoutesForApp } = require('./routes');

const {
  getXsuaaBinding
} = require('./serviceBindings');

const {
  exchangeUserToken
} = require('./tokenExchange');

function joinUrl(base, path) {

  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

async function discoverCapServices(
  spaceGuid,
  userToken
) {

  const apps =
    await getAppsInSpace(spaceGuid);

  const probableSrvApps =
    apps.filter(app =>

      app.state === 'STARTED' &&

      (
        app.name.endsWith('-srv') ||
        app.name.includes('srv')
      )
    );

  const discovered = [];

  for (const app of probableSrvApps) {

    try {

      console.log(
        'DISCOVERING APP:',
        app.name
      );

      // discover xsuaa
      const binding =
        await getXsuaaBinding(app.guid);

      if (!binding?.xsuaa) {

        console.log(
          'NO XSUAA FOUND:',
          app.name
        );

        continue;
      }

      // exchanged token
      const exchangedToken =
        await exchangeUserToken(
          userToken,
          binding.xsuaa,
          app.guid
        );

      console.log(
        'TOKEN READY:',
        app.name
      );

      // fetch routes
      const routes =
        await getRoutesForApp(app.guid);

      for (const route of routes) {

        if (!route.url) {
          continue;
        }

        const baseUrl =
          `https://${route.url}`;

        console.log(
          'PROBING APP:',
          baseUrl
        );

        /*
        ============================================
        STEP 1:
        TRY EXPLICIT SERVICES REGISTRY
        ============================================
        */

        try {

          const registryUrl =
            joinUrl(
              baseUrl,
              '/services/getServices'
            );

          console.log(
            'TRYING REGISTRY:',
            registryUrl
          );

          const registryResponse =
            await axios.get(
              registryUrl,
              {
                timeout: 5000,

                headers: {
                  Authorization:
                    `Bearer ${exchangedToken}`
                }
              }
            );

          const registryServices =
            registryResponse.data?.value || [];

          if (
            Array.isArray(registryServices) &&
            registryServices.length > 0
          ) {

            console.log(
              'REGISTRY SERVICES FOUND:',
              registryServices
            );

            discovered.push({

              app_name:
                app.name,

              app_guid:
                app.guid,

              route:
                baseUrl,

              service_root:
                baseUrl,

              services:
                registryServices.map(service => ({

                  name:
                    service.name,

                  url:
                    joinUrl(
                      baseUrl,
                      service.path
                    )
                })),

              type:
                'odata'
            });

            // registry successful
            continue;
          }

        } catch (err) {

          console.log(
            'REGISTRY NOT AVAILABLE:',
            err.message
          );
        }

        /*
        ============================================
        STEP 2:
        FALLBACK HTML DISCOVERY
        ============================================
        */

        try {

          console.log(
            'FALLBACK HTML DISCOVERY:',
            baseUrl
          );

          const rootResponse =
            await axios.get(
              baseUrl,
              {
                timeout: 5000,

                maxRedirects: 5,

                headers: {
                  Authorization:
                    `Bearer ${exchangedToken}`
                }
              }
            );

          const contentType =
            rootResponse.headers[
            'content-type'
            ] || '';

          const isHtml =
            contentType.includes(
              'text/html'
            );

          if (!isHtml) {

            console.log(
              'ROOT NOT HTML:',
              baseUrl
            );

            continue;
          }

          const html =
            rootResponse.data;

          const $ =
            cheerio.load(html);

          const links =
            new Set();

          $('a').each((_, el) => {

            const href =
              $(el).attr('href');

            if (!href) {
              return;
            }

            // skip metadata links
            if (
              href.includes('$metadata')
            ) {
              return;
            }

            // skip static assets
            if (
              href.includes('.css') ||
              href.includes('.js') ||
              href.includes('.png') ||
              href.includes('.ico')
            ) {
              return;
            }

            links.add(href);
          });

          console.log(
            'DISCOVERED LINKS:',
            [...links]
          );

          for (const href of links) {

            try {

              const serviceRoot =
                href.startsWith('http')

                  ? href

                  : joinUrl(
                    baseUrl,
                    href
                  );

              console.log(
                'PROBING SERVICE:',
                serviceRoot
              );

              const response =
                await axios.get(
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

              const isOData =
                response.data &&
                response.data[
                '@odata.context'
                ];

              if (!isOData) {
                continue;
              }

              const services =
                response.data?.value || [];

              discovered.push({

                app_name:
                  app.name,

                app_guid:
                  app.guid,

                route:
                  baseUrl,

                service_root:
                  serviceRoot,

                services:
                  services.map(service => ({

                    name:
                      service.name,

                    url:
                      service.url.startsWith('http')

                        ? service.url

                        : joinUrl(
                          serviceRoot,
                          service.url
                        )
                  })),

                type:
                  'odata'
              });

              console.log(
                'ODATA SERVICE FOUND:',
                serviceRoot
              );

            } catch (err) {

              console.log(
                'SERVICE PROBE ERROR:',
                err.message
              );
            }
          }

        } catch (err) {

          console.log(
            'ROOT PROBE ERROR:',
            err.message,
            baseUrl
          );
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