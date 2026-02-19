
interface Env {
  // 根据文档，EdgeOne KV 应该通过绑定的环境变量直接访问
  CLOUDNAV_KV: any; // 这是绑定到 EdgeOne KV 命名空间的环境变量
  PASSWORD: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
  'Access-Control-Max-Age': '86400',
};

// 简化的 KV 操作函数
async function getKVValue(kv: any, key: string): Promise<string | null> {
  try {
    console.log('EdgeOne KV GET Request:', { key });
    const value = await kv.get(key);
    console.log('EdgeOne KV GET Response:', { key, value });
    return value;
  } catch (error) {
    console.error('EdgeOne KV GET error:', error);
    return null;
  }
}

async function putKVValue(kv: any, key: string, value: string): Promise<void> {
  try {
    console.log('EdgeOne KV PUT Request:', { key, value });
    await kv.put(key, value);
    console.log('EdgeOne KV PUT Success:', key);
  } catch (error) {
    console.error('EdgeOne KV PUT error:', error);
    // 不抛出错误，允许操作继续
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
    const currentDataStr = await getKVValue(env.CLOUDNAV_KV, 'app_data');
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
    await putKVValue(env.CLOUDNAV_KV, 'app_data', JSON.stringify(currentData));

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
