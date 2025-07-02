// Vercel Serverless Function to act as a proxy for the Moz API
import fetch from 'node-fetch';
import crypto from 'crypto';

// This is the main handler Vercel will run
export default async function handler(req, res) {
  // --- CORS Configuration ---
  res.setHeader('Access-Control-Allow-Origin', 'https://jbmoz-api-tool-ui.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle the browser's preflight "OPTIONS" request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // --- Main Logic ---
  const { apiKey, method, params } = req.body;

  if (!apiKey || !method || !params) {
    return res.status(400).json({ error: 'Missing API Key, method, or parameters.' });
  }

  try {
    let promises = [];

    switch (method) {
      case 'siteMetrics':
        promises = params.targets.map(target =>
          callMozApi("data.site.metrics.fetch", { data: { site_query: { query: target, scope: params.scope } } }, apiKey)
        );
        break;

      case 'keywordMetrics':
        const metricMap = { 'all': 'data.keyword.metrics.fetch', 'volume': 'data.keyword.metrics.volume.fetch', 'difficulty': 'data.keyword.metrics.difficulty.fetch', 'opportunity': 'data.keyword.metrics.opportunity.fetch', 'priority': 'data.keyword.metrics.priority.fetch' };
        const apiMethod = metricMap[params.metricType] || metricMap['all'];
        promises = params.keywords.map(keyword =>
          callMozApi(apiMethod, { data: { serp_query: { keyword: keyword, locale: params.locale, device: "desktop", engine: "google" } } }, apiKey)
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

      case 'rankingKeywords': {
        const limit = Math.max(1, Math.min(500, parseInt(params.limit, 10) || 25));
        promises = params.targets.map(target =>
          // The limit parameter is now correctly nested inside a "page" object.
          callMozApi("data.site.ranking.keywords.list", {
            data: {
              target_query: { query: target, scope: params.scope, locale: params.locale },
              page: { limit: limit } 
            }
          }, apiKey)
        );
        break;
      }

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
}

/**
 * A helper function to make a single, authenticated call to the Moz JSON-RPC API.
 */
async function callMozApi(apiMethodName, apiParams, apiKey) {
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
