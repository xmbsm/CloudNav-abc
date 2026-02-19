// 统一配置接口
// EdgeOne Pages Function for Storage API
// Migrated from Cloudflare Workers storage.ts

// 存储键常量
const STORAGE_KEYS = {
  CONFIG_KEY: 'config',
  SEARCH_CONFIG_KEY: 'search_config',
  CATEGORIES_CONFIG_KEY: 'cate_config',
  LINKS_CONFIG_KEY: 'links_config',
};

// 统一的响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle OPTIONS request for CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Handle GET requests
  if (request.method === 'GET') {
    try {
      const checkAuth = url.searchParams.get('checkAuth');
      const getConfig = url.searchParams.get('getConfig');
      const key = url.searchParams.get('key');
      
      // console.log('Storage API GET request:', {
      //   url: request.url,
      //   hasKV: !!env.CLOUDNAV_KV,
      //   hasPassword: !!env.PASSWORD,
      //   searchParams: Object.fromEntries(url.searchParams)
      // });

      // Check Auth
      if (checkAuth === 'true') {
        const serverPassword = env.PASSWORD;
        return new Response(JSON.stringify({
          hasPassword: !!serverPassword,
          requiresAuth: !!serverPassword,
          readOnlyAccess: true
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // Get Config
      if (['ai', 'website', 'search', 'mastodon', 'weather'].includes(getConfig)) {
        const unifiedConfigStr = await CLOUDNAV_KV.get('config');
        const config = unifiedConfigStr ? JSON.parse(unifiedConfigStr) : {};

        let response = {};
        if (getConfig === 'ai') response = config.ai || {};
        else if (getConfig === 'website') response = config.website || { passwordExpiry: { value: 1, unit: 'week' } };
        else if (getConfig === 'search') response = config.search || {};
        else if (getConfig === 'mastodon') response = config.mastodon || {};
        else if (getConfig === 'weather') response = config.weather || {};

        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // Get Favicon
      if (getConfig === 'favicon') {
        const domain = url.searchParams.get('domain');
        if (!domain) {
          return new Response(JSON.stringify({ error: 'Domain parameter is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        
        const cachedIcon = await CLOUDNAV_KV.get(`favicon:${domain}`);
        return new Response(JSON.stringify({ icon: cachedIcon || null, cached: !!cachedIcon }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // Get Categories
      if (getConfig === 'categories') {
        const categoriesData = await CLOUDNAV_KV.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        return new Response(categoriesData || '[]', {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Get Links
      if (getConfig === 'links') {
        const linksData = await CLOUDNAV_KV.get(STORAGE_KEYS.LINKS_CONFIG_KEY);
        return new Response(linksData || '[]', {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Read by Key
      if (key) {
        if (key === STORAGE_KEYS.CONFIG_KEY) {
          const config = await CLOUDNAV_KV.get('config');
          return new Response(JSON.stringify({ key, value: config || '{}' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const value = await CLOUDNAV_KV.get(key);
        return new Response(JSON.stringify({ key, value }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Get All Data
      if (getConfig === 'true') {
        const linksData = await CLOUDNAV_KV.get(STORAGE_KEYS.LINKS_CONFIG_KEY);
        const categoriesData = await CLOUDNAV_KV.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);

        const combinedData = {
          links: linksData ? JSON.parse(linksData) : [],
          categories: categoriesData ? JSON.parse(categoriesData) : []
        };

        return new Response(JSON.stringify(combinedData), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({ links: [], categories: [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (err) {
      console.error('Storage API error:', err);
      return new Response(JSON.stringify({
        error: 'Failed to fetch data',
        details: err.message
      }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  // Handle POST requests
  if (request.method === 'POST') {
    const providedPassword = request.headers.get('x-auth-password');
    const serverPassword = env.PASSWORD;

    try {
      const body = await request.json();
      const readOnlyOperations = ['favicon'];

      // Anonymous allowed operations
      if (readOnlyOperations.includes(body.operation)) {
        if (body.saveConfig === 'favicon') {
          const { domain, icon } = body;
          if (!domain || !icon) {
            return new Response(JSON.stringify({ error: 'Domain and icon are required' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          await CLOUDNAV_KV.put(`favicon:${domain}`, icon, { expirationTtl: 30 * 24 * 60 * 60 });
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // Auth Check for other operations
      let isAuthenticated = false;
      if (serverPassword && providedPassword === serverPassword) {
        isAuthenticated = true;
      } else if (providedPassword) {
        // Check if it is a valid token
        const tokenVal = await CLOUDNAV_KV.get(`auth_token:${providedPassword}`);
        if (tokenVal === 'valid') {
          isAuthenticated = true;
        }
      }

      if (!isAuthenticated) {
        return new Response(JSON.stringify({ error: '管理操作需要密码验证' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Auth Only Check
      if (body.authOnly) {
        await CLOUDNAV_KV.put('last_auth_time', Date.now().toString());
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
  
      // Save Config (Search, AI, Website, Mastodon, Weather)
      if (['search', 'ai', 'website', 'mastodon', 'weather'].includes(body.saveConfig)) {
        let unifiedConfig = {};
        const existingConfig = await CLOUDNAV_KV.get('config');
        if (existingConfig) unifiedConfig = JSON.parse(existingConfig);

        unifiedConfig[body.saveConfig] = body.config;
        await CLOUDNAV_KV.put('config', JSON.stringify(unifiedConfig));

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Save Categories
      if (body.saveConfig === 'categories') {
        await CLOUDNAV_KV.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Save Links
      if (body.saveConfig === 'links') {
        await CLOUDNAV_KV.put(STORAGE_KEYS.LINKS_CONFIG_KEY, JSON.stringify(body.links));
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Sync To KV (Unified Config)
      if (body.key === STORAGE_KEYS.CONFIG_KEY && body.value) {
        await CLOUDNAV_KV.put('config', body.value);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Save Combined Links and Categories
      if (body.links && body.categories) {
        await CLOUDNAV_KV.put(STORAGE_KEYS.LINKS_CONFIG_KEY, JSON.stringify(body.links));
        await CLOUDNAV_KV.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } else if (body.links) {
        await CLOUDNAV_KV.put(STORAGE_KEYS.LINKS_CONFIG_KEY, JSON.stringify(body.links));
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } else if (body.categories) {
        await CLOUDNAV_KV.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } else {
        return new Response(JSON.stringify({ error: 'Invalid data format' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: 'Failed to save data' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
