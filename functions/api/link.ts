
interface Env {
  EDGEONE_KV_NAMESPACE: string;
  EDGEONE_API_KEY: string;
  EDGEONE_API_SECRET: string;
  PASSWORD: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
  'Access-Control-Max-Age': '86400',
};

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

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  // 初始化 EdgeOne KV 客户端
  const kvClient = new EdgeOneKVClient(
    env.EDGEONE_KV_NAMESPACE,
    env.EDGEONE_API_KEY,
    env.EDGEONE_API_SECRET
  );

  // 1. Auth Check
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;

  if (!serverPassword || providedPassword !== serverPassword) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const newLinkData = await request.json() as any;
    
    // Validate input
    if (!newLinkData.title || !newLinkData.url) {
        return new Response(JSON.stringify({ error: 'Missing title or url' }), { status: 400, headers: corsHeaders });
    }

    // 2. Fetch current data from KV
    const currentDataStr = await kvClient.get('app_data');
    let currentData = { links: [], categories: [] };
    
    if (currentDataStr) {
        currentData = JSON.parse(currentDataStr);
    }

    // 3. Determine Category
    let targetCatId = '';
    let targetCatName = '';

    // 3a. Check for explicit categoryId from request
    if (newLinkData.categoryId) {
        const explicitCat = currentData.categories.find((c: any) => c.id === newLinkData.categoryId);
        if (explicitCat) {
            targetCatId = explicitCat.id;
            targetCatName = explicitCat.name;
        }
    }

    // 3b. Fallback: Auto-detect if no explicit category or explicit one not found
    if (!targetCatId) {
        if (currentData.categories && currentData.categories.length > 0) {
            // Try to find specific keywords
            const keywords = ['收集', '未分类', 'inbox', 'temp', 'later'];
            const match = currentData.categories.find((c: any) => 
                keywords.some(k => c.name.toLowerCase().includes(k))
            );

            if (match) {
                targetCatId = match.id;
                targetCatName = match.name;
            } else {
                // Fallback to 'common' if exists, else first category
                const common = currentData.categories.find((c: any) => c.id === 'common');
                if (common) {
                    targetCatId = 'common';
                    targetCatName = common.name;
                } else {
                    targetCatId = currentData.categories[0].id;
                    targetCatName = currentData.categories[0].name;
                }
            }
        } else {
            // No categories exist at all
            targetCatId = 'common';
            targetCatName = '默认';
        }
    }

    // 4. Create new link object
    const newLink = {
        id: Date.now().toString(),
        title: newLinkData.title,
        url: newLinkData.url,
        description: newLinkData.description || '',
        categoryId: targetCatId, 
        createdAt: Date.now(),
        pinned: false,
        icon: undefined
    };

    // 5. Append
    // @ts-ignore
    currentData.links = [newLink, ...(currentData.links || [])];

    // 6. Save back to KV
    await kvClient.put('app_data', JSON.stringify(currentData));

    return new Response(JSON.stringify({ 
        success: true, 
        link: newLink,
        categoryName: targetCatName 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (err: any) {
    console.error('Error in onRequestPost:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
