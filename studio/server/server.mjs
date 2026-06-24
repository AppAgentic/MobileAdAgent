// Studio local control-plane server — Claude scratch build.
// Zero external dependencies. Serves the Studio web UI and a small JSON API on
// port 3108 (distinct from the sibling prototype's 3107). No provider calls,
// no filesystem writes, providerMutations stays 0.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStudioPipeline, sampleIntake, STAGE_ORDER } from '../engine/pipeline.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const webDir = join(rootDir, 'web');
const port = Number(
  process.env.PORT || process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 3108,
);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

function sendJson(res, body, status = 200) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // --- API ---
    if (url.pathname === '/api/health') {
      return sendJson(res, {
        ok: true,
        app: 'Mobile Ad Agent — Studio (Claude scratch build)',
        port,
        stageOrder: STAGE_ORDER,
        providerMutations: 0,
      });
    }

    if (url.pathname === '/api/sample-intake') {
      return sendJson(res, sampleIntake());
    }

    if (url.pathname === '/api/run' && req.method === 'POST') {
      const body = await readBody(req);
      const job = runStudioPipeline(body);
      // Defensive: never leak a non-zero mutation count.
      if (job.providerMutations !== 0) return sendJson(res, { error: 'invariant_violation' }, 500);
      return sendJson(res, job);
    }

    if (url.pathname === '/api/run-sample' && req.method === 'POST') {
      return sendJson(res, runStudioPipeline(sampleIntake()));
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, { error: 'not_found' }, 404);
    }

    // --- Static web UI ---
    await serveStatic(url, res);
  } catch (err) {
    sendJson(res, { error: 'server_error', message: String(err && err.message) }, 500);
  }
});

async function serveStatic(url, res) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(webDir, safePath);
  if (!filePath.startsWith(webDir)) {
    return sendJson(res, { error: 'forbidden' }, 403);
  }
  try {
    const data = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': data.length });
    res.end(data);
  } catch {
    sendJson(res, { error: 'not_found' }, 404);
  }
}

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Studio (Claude scratch build) listening on http://127.0.0.1:${port}`);
  console.log('Provider-safe: no Firebase/R2/HeyGen/model/ad-network calls. providerMutations=0.');
});
