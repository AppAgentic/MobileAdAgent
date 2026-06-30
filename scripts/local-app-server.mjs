import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSampleState, exportManifest, runLocalCreativePipeline } from '../lib/local-pipeline.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(rootDir, 'local-app');
const port = Number(process.env.PORT || process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] || 3107);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/api/health') {
      sendJson(response, {
        ok: true,
        app: 'Mobile Ad Agent local prototype',
        providerMutations: 0,
      });
      return;
    }

    if (url.pathname === '/api/sample-state') {
      sendJson(response, createSampleState());
      return;
    }

    if (url.pathname === '/api/jobs/generate' && request.method === 'POST') {
      const body = await readJson(request);
      const job = runLocalCreativePipeline(body);
      sendJson(response, job);
      return;
    }

    if (url.pathname === '/api/jobs/manifest' && request.method === 'POST') {
      const body = await readJson(request);
      const job = body.jobId && body.qaReport ? body : runLocalCreativePipeline(body);
      sendJson(response, exportManifest(job));
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, { ok: false, error: error.message }, 500);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mobile Ad Agent local prototype running at http://127.0.0.1:${port}`);
});

async function serveStatic(pathname, response) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(response, { ok: false, error: 'Invalid path' }, 400);
    return;
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(data);
  } catch {
    sendJson(response, { ok: false, error: 'Not found' }, 404);
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}
