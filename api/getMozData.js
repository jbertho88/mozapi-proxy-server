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
  const { apiKey, method, params, openaiApiKey } = req.body;

  // OpenAI methods don't need Moz API key
  if (method !== 'extractContent' && method !== 'getEmbeddings' && method !== 'analyzeWithOpenAI') {
    if (!apiKey || !method ) {
      return res.status(400).json({ error: 'Missing API Key or method.' });
    }
    // Special case for getQuota which doesn't need params
    if (method !== 'getQuota' && !params) {
      return res.status(400).json({ error: 'Missing parameters for this method.' });
    }
  }

  // OpenAI methods need OpenAI API key
  if ((method === 'getEmbeddings' || method === 'analyzeWithOpenAI') && !openaiApiKey) {
    return res.status(400).json({ error: 'Missing OpenAI API Key.' });
  }


  try {
    // Content extraction endpoint (no API key needed)
    if (method === 'extractContent') {
      if (!params || !params.url) {
        return res.status(400).json({ error: 'Missing URL parameter.' });
      }
      try {
        const response = await fetch(params.url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        
        // Remove script and style tags using regex
        let cleanedHtml = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
        
        // Extract text content by removing HTML tags
        let text = cleanedHtml
          .replace(/<[^>]+>/g, ' ') // Remove HTML tags
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&[a-z]+;/gi, ' '); // Remove other HTML entities
        
        // Clean up whitespace and limit length
        const cleanedText = text.replace(/\s+/g, ' ').trim().substring(0, 8000);
        
        return res.status(200).json({ content: cleanedText });
      } catch (error) {
        console.error('Content extraction error:', error);
        return res.status(500).json({ error: `Failed to extract content: ${error.message}` });
      }
    }

    // OpenAI embeddings endpoint
    if (method === 'getEmbeddings') {
      if (!params || !params.text) {
        return res.status(400).json({ error: 'Missing text parameter.' });
      }
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: params.text
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || 'Failed to get embeddings');
        }
        
        const data = await response.json();
        return res.status(200).json({ embedding: data.data[0].embedding });
      } catch (error) {
        console.error('OpenAI embeddings error:', error);
        return res.status(500).json({ error: `Failed to get embeddings: ${error.message}` });
      }
    }

    // OpenAI chat completion endpoint
    if (method === 'analyzeWithOpenAI') {
      if (!params || !params.analysisData) {
        return res.status(400).json({ error: 'Missing analysisData parameter.' });
      }
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4-turbo-preview',
            messages: [
              {
                role: 'system',
                content: 'You are an SEO content analysis expert. Analyze URLs, their ranking keywords, and provide actionable insights about content opportunities and consolidation recommendations. Return your analysis as JSON with the following structure: { "opportunities": [{"subtopic": "...", "keywords": ["..."]}], "recommendations": "..." } or as plain text if JSON is not appropriate.'
              },
              {
                role: 'user',
                content: JSON.stringify(params.analysisData, null, 2)
              }
            ],
            temperature: 0.7,
            max_tokens: 2000
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || 'Failed to analyze with OpenAI');
        }
        
        const data = await response.json();
        return res.status(200).json({ analysis: data.choices[0].message.content });
      } catch (error) {
        console.error('OpenAI analysis error:', error);
        return res.status(500).json({ error: `Failed to analyze with OpenAI: ${error.message}` });
      }
    }

    // Single-call endpoints are handled and returned immediately.
    if (method === 'getQuota') {
        const quotaData = await callMozApi("quota.lookup", { data: { path: "api.limits.data.rows" } }, apiKey);
        return res.status(200).json({ quota: quotaData });
    }

    if (method === 'linkIntersect') {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        const options = {
            minimum_matching_targets: params.minimum_matching_targets,
            scope: params.scope,
            sort: params.sort
        };
        const result = await callMozApi("data.site.link.intersect.fetch", { data: { is_linking_to: params.is_linking_to, not_linking_to: params.not_linking_to, options, offset: { limit } } }, apiKey);
        return res.status(200).json([{ status: 'success', data: result }]); 
    }

    if (method === 'linkStatus') {
         const result = await callMozApi("data.site.link.status.fetch", { data: { target_site_query: { query: params.targetQuery, scope: params.targetScope }, source_site_query: { query: params.sourceQuery, scope: params.sourceScope } } }, apiKey);
         return res.status(200).json([{ status: 'success', data: result }]);
    }
      
    if (method === 'filterLinksByDomain') {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        const options = { filters: params.filters };
        const promises = params.targetQueries.flatMap(targetQuery => 
            params.sourceQueries.map(sourceQuery => 
                callMozApi("data.site.link.filter.domain", { data: { site_query: {query: targetQuery, scope: params.targetScope}, domain_site_query: {query: sourceQuery, scope: params.sourceScope}, options, offset: {limit} } }, apiKey)
            )
        );
        const results = await Promise.allSettled(promises);
        const responseData = results.map(result => result.status === 'fulfilled' ? { status: 'success', data: result.value } : { status: 'error', reason: result.reason.message });
        return res.status(200).json(responseData);
    }


    // Multi-target endpoints are looped.
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

      case 'listLinks': {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        const options = { sort: params.sort, filters: params.filters };
        promises = params.targets.map(target => 
          callMozApi("data.site.link.list", { data: { site_query: { query: target, scope: params.scope }, options, offset: { limit } } }, apiKey)
        );
        break;
      }

       case 'filterLinksByAnchor': {
        const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 25));
        const options = { sort: params.sort, filters: params.filters };
        promises = params.targets.map(target => 
          callMozApi("data.site.link.filter.anchor.text", { data: { site_query: { query: target, scope: params.scope }, anchor_text: params.anchorText, options, offset: { limit } } }, apiKey)
        );
        break;
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
  
  const resClone = response.clone();
  try {
    const data = await response.json();
    if (!response.ok || data.error) {
      const errorMessage = data.error ? data.error.message : `API returned status ${response.status}`;
      throw new Error(errorMessage);
    }
    return data.result;
  } catch (e) {
      if (e instanceof SyntaxError) { 
          console.error("Failed to parse JSON from Moz API. The API might be temporarily unavailable.");
          const textResponse = await resClone.text();
          console.error("API Response Text:", textResponse.substring(0, 500)); 
          throw new Error("The Moz API returned an invalid response (likely HTML). It may be temporarily busy. Please try again shortly.");
      }
      throw e;
  }
};