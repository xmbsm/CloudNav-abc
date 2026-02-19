// EdgeOne Pages Function for Auth
// Migrated from Cloudflare Workers auth.ts

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const { password } = body;

      if (!env.PASSWORD) {
        return new Response(JSON.stringify({
          error: '服务器未配置管理员密码'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (password !== env.PASSWORD) {
        return new Response(JSON.stringify({
          error: '密码错误'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Generate Simple Token
      const token = btoa(`${env.PASSWORD}:${Date.now()}`);

      // Calculate Expiration based on Config
      let expirationTtl = 24 * 60 * 60; // Default 1 day
      try {
        const unifiedConfigStr = await CLOUDNAV_KV.get('config');
        if (unifiedConfigStr) {
          const unifiedConfig = JSON.parse(unifiedConfigStr);
          const expiryConfig = unifiedConfig.website?.passwordExpiry;

          if (expiryConfig) {
            const { value = 1, unit = 'week' } = expiryConfig;
            if (unit === 'day') expirationTtl = value * 24 * 60 * 60;
            else if (unit === 'week') expirationTtl = value * 7 * 24 * 60 * 60;
            else if (unit === 'month') expirationTtl = value * 30 * 24 * 60 * 60;
            else if (unit === 'year') expirationTtl = value * 365 * 24 * 60 * 60;
            else if (unit === 'permanent') expirationTtl = null; // No expiration
          }
        }
      } catch (e) {
        console.warn('Failed to read expiry config:', e);
      }

      // Record auth time
      await CLOUDNAV_KV.put('last_auth_time', Date.now().toString());

      // Store token
      const kvOptions = expirationTtl ? { expirationTtl } : {};
      await CLOUDNAV_KV.put(`auth_token:${token}`, 'valid', kvOptions);

      return new Response(JSON.stringify({
        success: true,
        token: token,
        message: '认证成功'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (err) {
      console.error('Auth API error:', err);
      return new Response(JSON.stringify({
        error: '认证请求失败'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
