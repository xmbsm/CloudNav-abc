interface Env {
  EDGEONE_KV_NAMESPACE: string;
  EDGEONE_API_KEY: string;
  EDGEONE_API_SECRET: string;
  PASSWORD: string;
}

// EdgeOne KV 客户端类
class EdgeOneKVClient {
  private namespace: string;
  private apiKey: string;
  private apiSecret: string;
  
  constructor(namespace: string, apiKey: string, apiSecret: string) {
    this.namespace = namespace;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }
  
  // 生成签名（腾讯云 API 签名方法）
  private generateSignature(method: string, url: string, timestamp: number): string {
    // 这里需要实现腾讯云 API 签名逻辑
    // 简化版本：直接使用 API Key 作为签名
    // 实际生产环境需要根据腾讯云文档实现完整的签名算法
    return this.apiKey;
  }
  
  async get(key: string): Promise<string | null> {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const url = `https://api.edgeone.qq.com/v1/kv/${this.namespace}/keys/${encodeURIComponent(key)}`;
      
      console.log('EdgeOne KV GET Request:', {
        url,
        namespace: this.namespace,
        key
      });
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `TC3-HMAC-SHA256 Credential=${this.apiKey}/${timestamp}/edgeone/tc3_request`,
          'Content-Type': 'application/json',
          'X-TC-Timestamp': timestamp.toString(),
          'X-TC-Version': '2022-09-01',
          'X-TC-Region': 'ap-guangzhou'
        }
      });
      
      console.log('EdgeOne KV GET Response Status:', response.status);
      
      if (response.status === 404) {
        console.log('EdgeOne KV GET: Key not found:', key);
        return null;
      }
      
      const responseText = await response.text();
      console.log('EdgeOne KV GET Response Body:', responseText);
      
      if (!response.ok) {
        throw new Error(`EdgeOne KV GET error: ${response.status} ${responseText}`);
      }
      
      const data = JSON.parse(responseText);
      console.log('EdgeOne KV GET Parsed Data:', data);
      
      // 检查响应格式
      if (data && typeof data === 'object' && 'value' in data) {
        return data.value;
      } else {
        throw new Error('Invalid EdgeOne KV GET response format');
      }
    } catch (error) {
      console.error('EdgeOne KV GET error:', error);
      return null;
    }
  }
  
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const url = `https://api.edgeone.qq.com/v1/kv/${this.namespace}/keys/${encodeURIComponent(key)}`;
      
      const body = {
        value,
        ...(options?.expirationTtl && { expiration: options.expirationTtl })
      };
      
      console.log('EdgeOne KV PUT Request:', {
        url,
        namespace: this.namespace,
        key,
        body
      });
      
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `TC3-HMAC-SHA256 Credential=${this.apiKey}/${timestamp}/edgeone/tc3_request`,
          'Content-Type': 'application/json',
          'X-TC-Timestamp': timestamp.toString(),
          'X-TC-Version': '2022-09-01',
          'X-TC-Region': 'ap-guangzhou'
        },
        body: JSON.stringify(body)
      });
      
      console.log('EdgeOne KV PUT Response Status:', response.status);
      
      const responseText = await response.text();
      console.log('EdgeOne KV PUT Response Body:', responseText);
      
      if (!response.ok) {
        throw new Error(`EdgeOne KV PUT error: ${response.status} ${responseText}`);
      }
      
      console.log('EdgeOne KV PUT Success:', key);
    } catch (error) {
      console.error('EdgeOne KV PUT error:', error);
      throw error;
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
    
    // 初始化 EdgeOne KV 客户端
    const kvClient = new EdgeOneKVClient(
      env.EDGEONE_KV_NAMESPACE,
      env.EDGEONE_API_KEY,
      env.EDGEONE_API_SECRET
    );
    
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

  // 初始化 EdgeOne KV 客户端
  const kvClient = new EdgeOneKVClient(
    env.EDGEONE_KV_NAMESPACE,
    env.EDGEONE_API_KEY,
    env.EDGEONE_API_SECRET
  );

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