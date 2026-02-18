
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
  
  async get(key: string): Promise<string | null> {
    try {
      const response = await fetch(
        `https://api.edgeone.qq.com/v1/kv/${this.namespace}/keys/${encodeURIComponent(key)}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        throw new Error(`EdgeOne KV GET error: ${response.status} ${await response.text()}`);
      }
      
      const data = await response.json();
      return data.value;
    } catch (error) {
      console.error('EdgeOne KV GET error:', error);
      return null;
    }
  }
  
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    try {
      const body = {
        value,
        ...(options?.expirationTtl && { expiration: options.expirationTtl })
      };
      
      const response = await fetch(
        `https://api.edgeone.qq.com/v1/kv/${this.namespace}/keys/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );
      
      if (!response.ok) {
        throw new Error(`EdgeOne KV PUT error: ${response.status} ${await response.text()}`);
      }
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
