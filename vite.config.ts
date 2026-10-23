/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SECURITY_HEADERS } from './config/securityHeaders.ts';

const MAX_BODY = 210 * 1024;

/**
 * Mounts the /api handlers inside the Vite dev server (ADR-13),
 * so `npm run dev` works without a Vercel account.
 */
function devApi(): Plugin {
  return {
    name: 'mc-dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const k of [
        'ANTHROPIC_API_KEY',
        'APP_PASSCODE',
        'ANALYSIS_MODEL',
        'MAX_CALLS_PER_SESSION',
        'RATE_LIMIT_PER_MIN',
      ]) {
        if (env[k] !== undefined && process.env[k] === undefined) process.env[k] = env[k];
      }
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url ?? '';
          if (!url.startsWith('/api/')) return next();
          const name = url.slice(5).split('?')[0] ?? '';
          const mod = (await server.ssrLoadModule(
            '/api/_lib/routes.ts',
          )) as typeof import('./api/_lib/routes');
          const { normalizeHeaders, clientIp } = (await server.ssrLoadModule(
            '/api/_lib/http.ts',
          )) as typeof import('./api/_lib/http');
          const handler = mod.routes[name];
          const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            res.setHeader('cache-control', 'no-store');
            for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
            res.end(JSON.stringify(body));
          };
          if (!handler) return send(404, { error: 'not_found', message: 'No such route.' });
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > MAX_BODY)
              return send(413, { error: 'too_large', message: 'Request too large.' });
            chunks.push(chunk as Buffer);
          }
          let body: unknown = undefined;
          if (size > 0) {
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              return send(400, { error: 'bad_request', message: 'Body is not valid JSON.' });
            }
          }
          const headers = normalizeHeaders(req.headers);
          try {
            const out = await handler({
              method: req.method ?? 'GET',
              headers,
              body,
              bodyBytes: size,
              ip: clientIp(headers, req.socket.remoteAddress ?? 'local'),
            });
            send(out.status, out.body, out.headers);
          } catch {
            send(500, { error: 'upstream_error', message: 'Unexpected server error.' });
          }
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  server: { port: 5173 },
  preview: { port: 4173, headers: SECURITY_HEADERS },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
  },
});
