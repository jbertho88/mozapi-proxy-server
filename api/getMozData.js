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

  if (!apiKey || !method ) {
    return res.status(400).json({ error: 'Missing API Key or method.' });
  }
   // Special case for getQuota which doesn't need params
  if (method !== 'getQuota' && !params) {
    return res.status(400).json({ error: 'Missing parameters for this method.' });
  }


  try {
    let promises = [];

    switch (method) {
      case 'getQuota':
        const quotaData = await callMozApi("quota.lookup", { data: { path: "api.limits.data.rows" } }, apiKey);
        return res.status(200).json({ quota: quotaData });

      case 'siteMetrics':
        promises = params.targets.map(target =>
          callMozApi("data.site.metrics.fetch", { data: { site_query: { query: target, scope: params.scope } } }, apiKey)
        );
        break;

      case 'keywordMetrics':
        const metricMap = { 'all': 'data.keyword.metrics.fetch', 'volume': 'data.keyword.metrics.volume.fetch', 'difficulty': 'data.keyword.metrics.difficulty.fetch', 'opportunity': 'data.keyword.metrics.opportunity.fetch', 'priority': 'data.keyword.metrics.priority.fetch' };
        const apiMethod = metricMap[params.metricType] || metricMap['all'];
        promises = params.keywords.map(keyword =>
          callMozApi(apiMethod, { data: { serp_query: { keyword: keyword, locale: params.locale, device: params.device || 'desktop', engine: params.engine || 'google' } } }, apiKey)
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
      
      case 'anchorText': {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        promises = params.targets.map(target => 
          callMozApi("data.site.anchor-text.list", { data: { site_query: { query: target, scope: params.scope }, offset: { limit } } }, apiKey)
        );
        break;
      }

      case 'recentlyGainedLinks': {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        const options = {};
        if (params.beginDate) options.begin_date = params.beginDate;
        if (params.endDate) options.end_date = params.endDate;
        promises = params.targets.map(target => 
          callMozApi("data.site.linking-domain.filter.recently-gained", { data: { site_query: { query: target, scope: params.scope }, options, offset: { limit } } }, apiKey)
        );
        break;
      }

      case 'recentlyLostLinks': {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        const options = {};
        if (params.beginDate) options.begin_date = params.beginDate;
        if (params.endDate) options.end_date = params.endDate;
        promises = params.targets.map(target => 
          callMozApi("data.site.linking-domain.filter.recently-lost", { data: { site_query: { query: target, scope: params.scope }, options, offset: { limit } } }, apiKey)
        );
        break;
      }
      
      case 'linkingDomains': {
          const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
          const options = { sort: params.sort, filters: params.filters };
          promises = params.targets.map(target =>
              callMozApi("data.site.linking-domain.list", { data: { site_query: { query: target, scope: params.scope }, options, offset: { limit } } }, apiKey)
          );
          break;
      }
      
      case 'finalRedirect':
        promises = params.targets.map(target => 
          callMozApi("data.site.redirect.fetch", { data: { site_query: { query: target, scope: params.scope } } }, apiKey)
        );
        break;
        
      case 'topPages': {
          const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
          const options = { sort: params.sort };
          if (params.filter && params.filter !== 'all') {
            options.filter = params.filter;
          }
          promises = params.targets.map(target =>
              callMozApi("data.site.top-page.list", { data: { site_query: { query: target, scope: params.scope }, options, offset: { limit } } }, apiKey)
          );
          break;
      }

      case 'linkIntersect': {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        const options = {
            minimum_matching_targets: params.minimum_matching_targets,
            scope: params.scope,
            sort: params.sort
        };
        const promise = callMozApi("data.site.link.intersect.fetch", { data: { is_linking_to: params.is_linking_to, not_linking_to: params.not_linking_to, options, offset: { limit } } }, apiKey);
        const result = await Promise.resolve(promise);
        return res.status(200).json([{ status: 'success', data: result }]); 
      }

      case 'listLinks': {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        const options = { sort: params.sort, filters: params.filters };
        promises = params.targets.map(target => 
          callMozApi("data.site.link.list", { data: { site_query: { query: target, scope: params.scope }, options, offset: { limit } } }, apiKey)
        );
        break;
      }

      case 'linkStatus': {
         const promise = callMozApi("data.site.link.status.fetch", { data: { target_site_query: { query: params.targetQuery, scope: params.targetScope }, source_site_query: { query: params.sourceQuery, scope: params.sourceScope } } }, apiKey);
         const result = await Promise.resolve(promise);
         return res.status(200).json([{ status: 'success', data: result }]);
      }

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
  
  // Clone the response to safely read it twice
  const resClone = response.clone();
  try {
    const data = await response.json();
    if (!response.ok || data.error) {
      const errorMessage = data.error ? data.error.message : `API returned status ${response.status}`;
      throw new Error(errorMessage);
    }
    return data.result;
  } catch (e) {
      if (e instanceof SyntaxError) { // This will catch the "Unexpected token '<'" error
          console.error("Failed to parse JSON from Moz API. The API might be temporarily unavailable.");
          const textResponse = await resClone.text();
          console.error("API Response Text:", textResponse.substring(0, 500)); // Log the first 500 chars
          throw new Error("The Moz API returned an invalid response (likely HTML). It may be temporarily busy. Please try again shortly.");
      }
      throw e; // Re-throw other errors
  }
};

