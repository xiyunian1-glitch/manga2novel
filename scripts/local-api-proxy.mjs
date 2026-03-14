import { createServer } from 'node:http';

const HOST = process.env.M2N_PROXY_HOST || '127.0.0.1';
const PORT = Number(process.env.M2N_PROXY_PORT || 8787);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'origin',
]);

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Access-Control-Max-Age', '43200');
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  setCorsHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function getTargetUrl(request, requestUrl) {
  const headerTarget = request.headers['x-target-url'];
  const targetUrl = Array.isArray(headerTarget) ? headerTarget[0] : headerTarget || requestUrl.searchParams.get('url');

  if (!targetUrl) {
    throw new Error('Missing X-Target-URL header.');
  }

  const parsed = new URL(targetUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported target protocol: ${parsed.protocol}`);
  }

  return parsed.toString();
}

function buildUpstreamHeaders(request) {
  const headers = new Headers();

  for (const [name, rawValue] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || lowerName === 'x-target-url') {
      continue;
    }

    if (Array.isArray(rawValue)) {
      rawValue.forEach((value) => headers.append(name, value));
      continue;
    }

    if (typeof rawValue === 'string' && rawValue.length > 0) {
      headers.set(name, rawValue);
    }
  }

  return headers;
}

async function handleProxy(request, response) {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === 'OPTIONS') {
    setCorsHeaders(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (requestUrl.pathname !== '/proxy') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  let targetUrl;
  try {
    targetUrl = getTargetUrl(request, requestUrl);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid target URL' });
    return;
  }

  try {
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await readBody(request);

    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers: buildUpstreamHeaders(request),
      body,
      redirect: 'manual',
    });

    const payload = Buffer.from(await upstreamResponse.arrayBuffer());
    setCorsHeaders(response);
    response.statusCode = upstreamResponse.status;

    upstreamResponse.headers.forEach((value, name) => {
      if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase().startsWith('access-control-')) {
        return;
      }

      response.setHeader(name, value);
    });

    response.setHeader('Content-Length', payload.length);
    response.end(payload);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Upstream request failed',
      targetUrl,
    });
  }
}

const server = createServer((request, response) => {
  void handleProxy(request, response).catch((error) => {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unexpected proxy failure',
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Local API proxy listening on http://${HOST}:${PORT}/proxy`);
});
