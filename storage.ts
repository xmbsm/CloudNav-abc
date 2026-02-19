interface Env {
  // 根据文档，EdgeOne KV 应该通过绑定的环境变量直接访问
  CLOUDNAV_KV: any; // 这是绑定到 EdgeOne KV 命名空间的环境变量
  PASSWORD: string;
}

// EdgeOne KV 客户端类（使用文档推荐的方式）
class EdgeOneKVClient {
  private kv: any;
  private isAvailable: boolean;
  
  constructor(kv: any) {
    this.kv = kv;
    this.isAvailable = !!kv;
    console.log('EdgeOne KV Client initialized:', { isAvailable: this.isAvailable });
  }
  
  async get(key: string): Promise<string | null> {
    try {
      if (!this.isAvailable || !this.kv) {
        console.warn('EdgeOne KV is not available, returning null for key:', key);
        return null;
      }
      
      console.log('EdgeOne KV GET Request:', { key });
      
      // 使用文档推荐的方式：直接调用 kv.get()
      const value = await this.kv.get(key);
      
      console.log('EdgeOne KV GET Response:', { key, value });
      
      return value;
    } catch (error) {
      console.error('EdgeOne KV GET error:', error);
      return null;
    }
  }
  
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    try {
      if (!this.isAvailable || !this.kv) {
        console.warn('EdgeOne KV is not available, skipping put for key:', key);
        return;
      }
      
      console.log('EdgeOne KV PUT Request:', { key, value, options });
      
      // 使用文档推荐的方式：直接调用 kv.put()
      await this.kv.put(key, value);
      
      console.log('EdgeOne KV PUT Success:', key);
    } catch (error) {
      console.error('EdgeOne KV PUT error:', error);
      // 不抛出错误，允许操作继续
    }
  }
}

// 统一的响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
};

// 处理 OPTIONS 请求（解决跨域预检）
export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

// GET: 获取数据
export const onRequestGet = async (context: { env: Env; request: Request }) => {
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const checkAuth = url.searchParams.get('checkAuth');
    const getConfig = url.searchParams.get('getConfig');
    
    // 初始化 EdgeOne KV 客户端（使用绑定的环境变量）
    const kvClient = new EdgeOneKVClient(env.CLOUDNAV_KV);
    
    // 如果是检查认证请求，返回是否设置了密码
    if (checkAuth === 'true') {
      const serverPassword = env.PASSWORD;
      return new Response(JSON.stringify({ 
        hasPassword: !!serverPassword,
        requiresAuth: !!serverPassword 
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取配置请求
    if (getConfig === 'ai') {
      const aiConfig = await kvClient.get('ai_config');
      return new Response(aiConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取搜索配置请求
    if (getConfig === 'search') {
      const searchConfig = await kvClient.get('search_config');
      return new Response(searchConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取网站配置请求
    if (getConfig === 'website') {
      const websiteConfig = await kvClient.get('website_config');
      return new Response(websiteConfig || JSON.stringify({ passwordExpiryDays: 7 }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取图标请求
    if (getConfig === 'favicon') {
      const domain = url.searchParams.get('domain');
      if (!domain) {
        return new Response(JSON.stringify({ error: 'Domain parameter is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 从KV中获取缓存的图标
      const cachedIcon = await kvClient.get(`favicon:${domain}`);
      if (cachedIcon) {
        return new Response(JSON.stringify({ icon: cachedIcon, cached: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 如果没有缓存，返回空结果
      return new Response(JSON.stringify({ icon: null, cached: false }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 从 KV 中读取数据
    const data = await kvClient.get('app_data');
    
    // 如果是获取数据请求，需要密码验证
    if (url.searchParams.get('getConfig') === 'true') {
      const password = request.headers.get('x-auth-password');
      if (!password || password !== env.PASSWORD) {
        return new Response(JSON.stringify({ error: '密码错误' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 检查密码是否过期
      const websiteConfigStr = await kvClient.get('website_config');
      const websiteConfig = websiteConfigStr ? JSON.parse(websiteConfigStr) : { passwordExpiryDays: 7 };
      const passwordExpiryDays = websiteConfig.passwordExpiryDays || 7;
      
      // 如果设置了密码过期时间，检查是否过期
      if (passwordExpiryDays > 0) {
        const lastAuthTime = await kvClient.get('last_auth_time');
        if (lastAuthTime) {
          const lastTime = parseInt(lastAuthTime);
          const now = Date.now();
          const expiryMs = passwordExpiryDays * 24 * 60 * 60 * 1000;
          
          // 如果已过期，返回错误
          if (now - lastTime > expiryMs) {
            return new Response(JSON.stringify({ error: '密码已过期，请重新输入' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
        }
      }
      
      // 更新最后认证时间
      await kvClient.put('last_auth_time', Date.now().toString());
    }
    
    if (!data) {
      // 如果没有数据，返回空结构
      return new Response(JSON.stringify({ links: [], categories: [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(data, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    console.error('Error in onRequestGet:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
};

// POST: 保存数据
export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  // 初始化 EdgeOne KV 客户端（使用绑定的环境变量）
  const kvClient = new EdgeOneKVClient(env.CLOUDNAV_KV);

  // 1. 验证密码（对于敏感操作需要密码）
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;

  try {
    const body = await request.json();
    
    // 如果只是验证密码，不更新数据
    if (body.authOnly) {
      if (!serverPassword) {
        return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      if (providedPassword !== serverPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 更新最后认证时间
      await kvClient.put('last_auth_time', Date.now().toString());
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存搜索配置（允许无密码访问，因为搜索配置不包含敏感数据）
    if (body.saveConfig === 'search') {
      // 如果服务器设置了密码，需要验证密码
      if (serverPassword) {
        if (!providedPassword || providedPassword !== serverPassword) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }
      
      await kvClient.put('search_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存图标（允许无密码访问）
    if (body.saveConfig === 'favicon') {
      const { domain, icon } = body;
      if (!domain || !icon) {
        return new Response(JSON.stringify({ error: 'Domain and icon are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 保存图标到KV，设置过期时间为30天
      await kvClient.put(`favicon:${domain}`, icon, { expirationTtl: 30 * 24 * 60 * 60 });
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 对于其他操作（保存AI配置、应用数据等），需要密码验证
    if (serverPassword) {
      if (!providedPassword || providedPassword !== serverPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存AI配置
    if (body.saveConfig === 'ai') {
      await kvClient.put('ai_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存网站配置
    if (body.saveConfig === 'website') {
      await kvClient.put('website_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 将数据写入 KV
    await kvClient.put('app_data', JSON.stringify(body));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    console.error('Error in onRequestPost:', err);
    return new Response(JSON.stringify({ error: 'Failed to save data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};