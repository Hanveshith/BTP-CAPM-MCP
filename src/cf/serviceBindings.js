    const { cfRequest } = require('./cfApi');

    const {
    getCfAccessToken
    } = require('./cfTokenProvider');

    const xsuaaCache =
    require('../cache/xsuaaCache');

    async function getXsuaaBinding(appGuid) {

    // cache hit
    if (xsuaaCache.has(appGuid)) {

        console.log(
        'XSUAA CACHE HIT:',
        appGuid
        );

        return xsuaaCache.get(appGuid);
    }

    const token =
        await getCfAccessToken();

    // fetch ALL credential bindings
    const bindingsResponse =
        await cfRequest(
        token,
        'GET',
        '/v3/service_credential_bindings'
        );

    // filter bindings for THIS app
    const bindings =
        (bindingsResponse.resources || [])
        .filter(binding =>
            binding.relationships
            ?.app
            ?.data
            ?.guid === appGuid
        );

    console.log(
        'FILTERED BINDINGS:',
        JSON.stringify(bindings, null, 2)
    );

    for (const binding of bindings) {

        try {

        // service instance guid
        const serviceInstanceGuid =
            binding.relationships
            ?.service_instance
            ?.data
            ?.guid;

        if (!serviceInstanceGuid) {
            continue;
        }

        // fetch service instance
        const serviceInstance =
            await cfRequest(
            token,
            'GET',
            `/v3/service_instances/${serviceInstanceGuid}`
            );

        console.log(
            'SERVICE INSTANCE:',
            JSON.stringify(serviceInstance, null, 2)
        );

        // get service plan guid
        const servicePlanGuid =
            serviceInstance
            ?.relationships
            ?.service_plan
            ?.data
            ?.guid;

        if (!servicePlanGuid) {
            continue;
        }

        // fetch service plan
        const servicePlan =
            await cfRequest(
            token,
            'GET',
            `/v3/service_plans/${servicePlanGuid}`
            );

        console.log(
            'SERVICE PLAN:',
            JSON.stringify(servicePlan, null, 2)
        );

        // get service offering guid
        const serviceOfferingGuid =
            servicePlan
            ?.relationships
            ?.service_offering
            ?.data
            ?.guid;

        if (!serviceOfferingGuid) {
            continue;
        }

        // fetch service offering
        const serviceOffering =
            await cfRequest(
            token,
            'GET',
            `/v3/service_offerings/${serviceOfferingGuid}`
            );

        console.log(
            'SERVICE OFFERING:',
            JSON.stringify(serviceOffering, null, 2)
        );

        // identify xsuaa
        const offeringName =
            serviceOffering?.name || '';

        const looksLikeXsuaa =
            offeringName.includes('xsuaa');

        if (!looksLikeXsuaa) {
            continue;
        }

        console.log(
            'XSUAA OFFERING FOUND:',
            offeringName
        );

        // fetch credential details
        const details =
            await cfRequest(
            token,
            'GET',
            `/v3/service_credential_bindings/${binding.guid}/details`
            );

        console.log(
            'BINDING DETAILS:',
            JSON.stringify(details, null, 2)
        );

        const credentials =
            details.credentials || {};

        const result = {

            binding_guid:
            binding.guid,

            service_instance_guid:
            serviceInstanceGuid,

            xsuaa: {

            url:
                credentials.url,

            clientid:
                credentials.clientid,

            clientsecret:
                credentials.clientsecret,

            xsappname:
                credentials.xsappname
            }
        };

        // cache result
        xsuaaCache.set(
            appGuid,
            result
        );

        console.log(
            'XSUAA CACHE SET:',
            appGuid
        );

        return result;

        } catch (err) {

        console.log(
            'BINDING ERROR:',
            err.message
        );
        }
    }

    console.log(
        'NO XSUAA BINDING FOUND:',
        appGuid
    );

    return null;
    }

    module.exports = {
    getXsuaaBinding
    };