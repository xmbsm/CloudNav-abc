export async function onRequest(context) {
  const result = {
    message: 'Debug Info',
    envKeys: {},
    globalKV: 'Not Found'
  };

  try {
    // Check env
    if (context && context.env) {
      for (const key in context.env) {
        const value = context.env[key];
        result.envKeys[key] = typeof value === 'string' ? 'String (Hidden)' : typeof value;
      }
    }

    // Check Global KV (CLOUDNAV_KV)
    try {
      if (typeof CLOUDNAV_KV !== 'undefined') {
        result.globalKV = 'Present (Global)';
        // test read
        // const test = await CLOUDNAV_KV.get('test_key');
      } else {
         result.globalKV = 'Undefined';
      }
    } catch (e) {
      result.globalKV = `Error: ${e.message}`;
    }

    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Exception in debug function',
      message: e.message,
      stack: e.stack
    }), {
      status: 200, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
