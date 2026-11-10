import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const separator = line.indexOf('=');
      const key = line.slice(0, separator).trim();
      if (!process.env[key]) {
        process.env[key] = line.slice(separator + 1).trim();
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

loadEnvFile(path.join(root, '.env.local'));
loadEnvFile(path.join(root, '.env'));

const handlers = new Map(
  ['approvals', 'attendance', 'audit', 'customers', 'employees', 'expenses', 'health', 'payroll', 'privileges', 'revenues']
    .map(name => [name, pathToFileURL(path.join(root, 'api', `${name}.js`)).href])
);
const loadedHandlers = new Map();
const maxBodyBytes = 1024 * 1024;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      const error = new Error('Request body is too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (bytes === 0) return undefined;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.status = 400;
    throw error;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const route = url.pathname.match(/^\/api\/([a-z-]+)\/?$/)?.[1];
  const handlerUrl = handlers.get(route);

  if (!handlerUrl) {
    sendJson(res, 404, { error: 'API route not found' });
    return;
  }

  try {
    let handler = loadedHandlers.get(route);
    if (!handler) {
      handler = (await import(handlerUrl)).default;
      loadedHandlers.set(route, handler);
    }

    const apiResponse = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      setHeader(name, value) {
        res.setHeader(name, value);
        return this;
      },
      send(body) {
        if (!res.headersSent) res.statusCode = this.statusCode;
        res.end(body);
        return this;
      },
    };

    await handler(
      {
        method: req.method,
        headers: req.headers,
        query: Object.fromEntries(url.searchParams.entries()),
        body: await readJsonBody(req),
      },
      apiResponse
    );

    if (!res.writableEnded) res.end();
  } catch (error) {
    if (res.writableEnded) return;
    const status = Number(error.status) || 500;
    sendJson(res, status, { error: status >= 500 ? 'Internal server error' : error.message });
    if (status >= 500) console.error(`[dev-api] ${route}: ${error.message}`);
  }
});

const port = Number(process.env.API_PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('API_PORT must be a valid TCP port');
}

server.listen(port, '127.0.0.1', () => {
  console.log(`Local API listening on http://127.0.0.1:${port}`);
});
