import { createServer } from 'node:http';

if (process.env.M2N_PROXY_USE_ENV_PROXY !== '1') {
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.ALL_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.all_proxy;
}

const HOST = process.env.M2N_PROXY_HOST || '127.0.0.1';
const PORT_START = Number(process.env.M2N_PROXY_PORT_START || process.env.M2N_PROXY_PORT || 8787);
const PORT_END = Number(process.env.M2N_PROXY_PORT_END || Math.max(PORT_START, PORT_START + 10));
const UPSTREAM_RETRY_DELAYS_MS = [500, 1500];
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'origin',
  'expect',
  'referer',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'pragma',
  'priority',
  'dnt',
]);

let activePort = PORT_START;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Access-Control-Expose-Headers', 'X-Manga2Novel-Proxy');
  response.setHeader('Access-Control-Max-Age', '43200');
  response.setHeader('X-Manga2Novel-Proxy', '1');
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
    if (
      HOP_BY_HOP_HEADERS.has(lowerName)
      || lowerName === 'x-target-url'
      || lowerName.startsWith('sec-')
    ) {
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

function extractErrorCode(error) {
  if (error && typeof error === 'object') {
    if ('code' in error && typeof error.code === 'string' && error.code) {
      return error.code;
    }

    if ('cause' in error && error.cause && typeof error.cause === 'object' && 'code' in error.cause && typeof error.cause.code === 'string') {
      return error.cause.code;
    }
  }

  return '';
}

function shouldRetryUpstreamRequest(error) {
  const code = extractErrorCode(error);
  const message = error instanceof Error ? error.message : String(error || '');
  const causeMessage = error && typeof error === 'object' && 'cause' in error && error.cause && typeof error.cause === 'object' && 'message' in error.cause
    ? String(error.cause.message || '')
    : '';
  const normalized = `${message} ${causeMessage}`.toLowerCase();

  return code === 'UND_ERR_SOCKET'
    || code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ETIMEDOUT'
    || code === 'UND_ERR_CONNECT_TIMEOUT'
    || normalized.includes('other side closed')
    || normalized.includes('socket hang up')
    || normalized.includes('connection reset')
    || normalized.includes('unexpected eof');
}

async function fetchUpstreamWithRetry(targetUrl, options) {
  let lastError;

  for (let attempt = 0; attempt <= UPSTREAM_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return {
        response: await fetch(targetUrl, options),
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error;

      if (!shouldRetryUpstreamRequest(error) || attempt >= UPSTREAM_RETRY_DELAYS_MS.length) {
        break;
      }

      await wait(UPSTREAM_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw Object.assign(
    lastError instanceof Error ? lastError : new Error(String(lastError || 'Upstream request failed')),
    { retryAttempts: UPSTREAM_RETRY_DELAYS_MS.length + 1 }
  );
}

async function handleProxy(request, response) {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${activePort}`}`);

  if (request.method === 'OPTIONS') {
    setCorsHeaders(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (requestUrl.pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      host: HOST,
      port: activePort,
    });
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

    const { response: upstreamResponse, attempts } = await fetchUpstreamWithRetry(targetUrl, {
      method: request.method,
      headers: buildUpstreamHeaders(request),
      body,
      redirect: 'manual',
    });

    const payload = Buffer.from(await upstreamResponse.arrayBuffer());
    setCorsHeaders(response);
    response.statusCode = upstreamResponse.status;

    upstreamResponse.headers.forEach((value, name) => {
      const lowerName = name.toLowerCase();
      if (
        HOP_BY_HOP_HEADERS.has(lowerName)
        || lowerName === 'content-encoding'
        || lowerName.startsWith('access-control-')
      ) {
        return;
      }

      response.setHeader(name, value);
    });

    response.setHeader('X-Manga2Novel-Proxy-Attempts', String(attempts));
    response.setHeader('Content-Length', payload.length);
    response.end(payload);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Upstream request failed',
      attempts: error && typeof error === 'object' && 'retryAttempts' in error ? error.retryAttempts : undefined,
      cause: error && typeof error === 'object' && 'cause' in error && error.cause && typeof error.cause === 'object'
        ? {
            name: error.cause.name,
            code: error.cause.code,
            message: error.cause.message,
          }
        : undefined,
      targetUrl,
    });
  }
}

function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off('error', handleError);
      resolve(port);
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port, HOST);
  });
}

async function listenOnAvailablePort(server) {
  for (let port = PORT_START; port <= PORT_END; port += 1) {
    try {
      const nextPort = await listenOnPort(server, port);
      activePort = nextPort;
      return nextPort;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`No available local proxy port found in range ${PORT_START}-${PORT_END}.`);
}

const server = createServer((request, response) => {
  void handleProxy(request, response).catch((error) => {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unexpected proxy failure',
    });
  });
});

void listenOnAvailablePort(server)
  .then((port) => {
    console.log(`Local API proxy listening on http://${HOST}:${port}/proxy`);
    if (port !== PORT_START) {
      console.log(`Default port ${PORT_START} was unavailable, switched to ${port}.`);
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
