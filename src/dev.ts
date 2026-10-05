import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import approveThemeProofV2 from '../base44/functions/approveThemeProofV2/index.ts';
import getPaidDelivery from '../base44/functions/getPaidDelivery/index.ts';
import getPaidDeliveryV2 from '../base44/functions/getPaidDeliveryV2/index.ts';
import renderPaidProduction from '../base44/functions/renderPaidProduction/index.ts';
import renderPaidProductionV2 from '../base44/functions/renderPaidProductionV2/index.ts';

/**
 * Lightweight dev server that mounts the five archived backend function stubs
 * (index.ts) as HTTP endpoints so the preview can start and exercise them.
 *
 * The stubs use a Supabase-style handler signature:
 *   (req: Request, res: Response) => Promise<void>
 * with req.headers.get(), req.json(), req.query and res.status(n).json(body).
 * The adapters below provide that contract over Node's http types.
 */

type FnHandler = (req: any, res: any) => Promise<any>;

interface FnRoute {
  name: string;
  method: string;
  description: string;
  handler: FnHandler;
}

const routes: FnRoute[] = [
  { name: 'approveThemeProofV2', method: 'POST', description: 'Authenticate and process theme proof approvals', handler: approveThemeProofV2 },
  { name: 'getPaidDelivery', method: 'GET', description: 'Retrieve a single paid delivery record by id', handler: getPaidDelivery },
  { name: 'getPaidDeliveryV2', method: 'GET', description: 'Enhanced delivery retrieval with filtering and pagination', handler: getPaidDeliveryV2 },
  { name: 'renderPaidProduction', method: 'POST', description: 'Render production assets for individual deliveries', handler: renderPaidProduction },
  { name: 'renderPaidProductionV2', method: 'POST', description: 'Batch rendering engine for multiple deliveries', handler: renderPaidProductionV2 },
];

class FnRequest {
  headers: { get(name: string): string | null };
  query: Record<string, string>;
  constructor(raw: IncomingMessage, query: Record<string, string>) {
    const h = raw.headers;
    this.headers = { get: (name: string) => h[name.toLowerCase()] ?? null };
    this.query = query;
  }
  async json(): Promise<any> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.raw) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  }
  private raw: IncomingMessage;
}

class FnResponse {
  private statusCode = 200;
  private sent = false;
  constructor(private raw: ServerResponse) {}
  status(code: number): this { this.statusCode = code; return this; }
  json(data: any): this {
    if (this.sent) return this;
    this.sent = true;
    this.raw.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
    this.raw.end(JSON.stringify(data));
    return this;
  }
}

function parseQuery(url: string): Record<string, string> {
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return {};
  const params = new URLSearchParams(url.slice(qIndex + 1));
  const result: Record<string, string> = {};
  params.forEach((v, k) => { result[k] = v; });
  return result;
}

function landingPage(): string {
  const rows = routes.map(r => `
    <tr>
      <td><code>${r.method}</code></td>
      <td><a href="/functions/${r.name}">/functions/${r.name}</a></td>
      <td>${r.description}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Specialty Page Studio — Functions</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 2rem; background: #f8fafc; color: #1e293b; }
    h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
    p.sub { color: #64748b; margin: 0 0 1.5rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    th, td { text-align: left; padding: .75rem 1rem; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
    code { background: #e2e8f0; padding: .15rem .4rem; border-radius: 4px; font-size: .85rem; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: .2rem .6rem; border-radius: 999px; font-size: .75rem; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Specialty Page Studio <span class="badge">running</span></h1>
  <p class="sub">Archived backend function stubs served by the dev server. All endpoints require a <code>Bearer</code> token.</p>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  const path = url.split('?')[0];

  if (path === '/' || path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(landingPage());
    return;
  }

  const match = path.match(/^\/functions\/([^/]+)$/);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path }));
    return;
  }

  const route = routes.find(r => r.name === match[1]);
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown function', name: match[1] }));
    return;
  }

  const fnReq = new FnRequest(req, parseQuery(url));
  (fnReq as any).raw = req;
  const fnRes = new FnResponse(res);

  try {
    await route.handler(fnReq, fnRes);
    if (!(fnRes as any).sent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Handler returned without sending a response' }));
    }
  } catch (err: any) {
    if (!(fnRes as any).sent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: err?.message ?? String(err) }));
    }
  }
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Specialty Page Studio dev server listening on http://0.0.0.0:${PORT}`);
  console.log(`Functions: ${routes.map(r => r.name).join(', ')}`);
});
