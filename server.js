Here is the updated server.js file. The key change is a more specific cors configuration that explicitly allows your live front-end's domain.

// Corrected Node.js proxy server with specific CORS configuration for production
const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON
app.use(express.json());

// --- CORS Configuration ---
// This is a more direct approach to handling CORS in a serverless environment like Vercel.
// We are manually setting the headers on every request/response.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://jbmoz-api-tool-ui.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle the preflight request for OPTIONS method
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});


// --- Main Endpoint ---
app.post('/api/getMozData', async (req, res) => {
    // ... the rest of your server code remains exactly the same
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
                const metricMap = { 'all': 'data.keyword.metrics.fetch', 'volume': 'data.keyword.metrics.volume.fetch', 'difficulty': 'data.keyword.metrics.difficulty.fetch', 'opportunity': 'data.keyword.metrics.opportunity.fetch', 'priority': 'data.keyword.metrics.priority.fetch' };
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
                    callMozApi("data.site.ranking.keywords.list", { data: { target_query: { query: target, scope: params.scope, locale: params.locale }, limit: 25 } } }, apiKey)
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
        
        const results = await Promise.allSettled(promises);
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

/**
 * A helper function to make a single, authenticated call to the Moz JSON-RPC API.
 */
const callMozApi = async (apiMethodName, apiParams, apiKey) => {
    const MOZ_API_ENDPOINT = "https://api.moz.com/jsonrpc";
    const payload = { jsonrpc: "2.0", id: crypto.randomUUID(), method: apiMethodName, params: apiParams };

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
        throw new Error(errorMessage);
    }
    
    return data.result;
};

app.listen(PORT, () => {
    console.log(`Corrected V3 proxy server with batch support running on port ${PORT}`);
});
