// Corrected Node.js proxy server for the Advanced Moz API Tool (using V3 Token Auth)
// NOW WITH BATCH PROCESSING SUPPORT
const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto'); // Used for UUID only now
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());


/**
 * A helper function to make a single, authenticated call to the Moz JSON-RPC API.
 * @param {string} apiMethodName - The full name of the API method (e.g., "data.site.metrics.fetch").
 * @param {object} apiParams - The parameters object for the specific API call.
 * @param {string} apiKey - The user's Moz API Key for the 'x-moz-token' header.
 * @returns {Promise<object>} - A promise that resolves with the result from the Moz API.
 */
const callMozApi = async (apiMethodName, apiParams, apiKey) => {
    const MOZ_API_ENDPOINT = "https://api.moz.com/jsonrpc";
    const payload = {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: apiMethodName,
        params: apiParams
    };

    const response = await fetch(MOZ_API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-moz-token': apiKey
        },
        body: JSON.stringify(payload)
    });
    
    const data = await response.json();

    if (!response.ok || data.error) {
        const errorMessage = data.error ? data.error.message : `API returned status ${response.status}`;
        // Throw an error to be caught by Promise.allSettled
        throw new Error(errorMessage);
    }
    
    return data.result;
};


// --- Main Endpoint ---
app.post('/api/getMozData', async (req, res) => {
    const { apiKey, method, params } = req.body;

    if (!apiKey || !method || !params) {
        return res.status(400).json({ error: 'Missing API Key, method, or parameters.' });
    }

    try {
        let promises = [];

        switch(method) {
            case 'siteMetrics':
                promises = params.targets.map(target => 
                    callMozApi("data.site.metrics.fetch", { data: { site_query: { query: target, scope: params.scope } } }, apiKey)
                );
                break;

            case 'keywordMetrics':
                const metricMap = {
                    'volume': 'data.keyword.metrics.volume.fetch',
                    'difficulty': 'data.keyword.metrics.difficulty.fetch',
                    'opportunity': 'data.keyword.metrics.opportunity.fetch',
                    'priority': 'data.keyword.metrics.priority.fetch',
                    'all': 'data.keyword.metrics.fetch'
                };
                const apiMethod = metricMap[params.metricType] || metricMap['all'];
                promises = params.keywords.map(keyword => 
                    callMozApi(apiMethod, { data: { serp_query: { keyword: keyword, locale: params.locale, device: params.device, engine: params.engine } } }, apiKey)
                );
                break;
            
            case 'brandAuthority':
                promises = params.targets.map(target => {
                    let brandQuery = target;
                    if (!brandQuery.startsWith('http')) brandQuery = 'https://' + brandQuery;
                    return callMozApi("data.site.metrics.brand.authority.fetch", { data: { site_query: { query: brandQuery, scope: "domain" } } }, apiKey);
                });
                break;

            case 'searchIntent':
                promises = params.keywords.map(keyword => 
                    callMozApi("data.keyword.search.intent.fetch", { data: { serp_query: { keyword: keyword, locale: params.locale, device: "desktop", engine: "google" } } }, apiKey)
                );
                break;
                
            case 'rankingKeywords':
                promises = params.targets.map(target => 
                    callMozApi("data.site.ranking.keywords.list", { data: { target_query: { query: target, scope: params.scope, locale: params.locale }, limit: 25 } }, apiKey)
                );
                break;

            case 'relatedKeywords':
                 promises = params.keywords.map(keyword => 
                    callMozApi("data.keyword.suggestions.list", { data: { serp_query: { keyword: keyword, locale: params.locale, device: "desktop", engine: "google" } } }, apiKey)
                );
                break;

            case 'keywordCount':
                promises = params.targets.map(target => 
                    callMozApi("data.site.ranking-keyword.count", { data: { target_query: { query: target, scope: params.scope, locale: params.locale } } }, apiKey)
                );
                break;

            default:
                return res.status(400).json({ error: 'Invalid API method specified.' });
        }

        // Use Promise.allSettled to ensure all requests complete, even if some fail.
        const results = await Promise.allSettled(promises);
        
        // Map the results to a consistent format for the frontend
        const responseData = results.map(result => {
            if (result.status === 'fulfilled') {
                return { status: 'success', data: result.value };
            } else {
                return { status: 'error', reason: result.reason.message };
            }
        });
        
        res.status(200).json(responseData);

    } catch (error) {
        console.error('Proxy Server Error:', error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

app.listen(PORT, () => {
    console.log(`Corrected V3 proxy server with batch support running on port ${PORT}`);
});
