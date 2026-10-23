import type { Handler } from './http.js';
import { pingHandler } from './handlers/ping.js';
import { configHandler } from './handlers/config.js';

/** Route table used by the local dev server. Vercel uses the files in /api directly. */
export const routes: Record<string, Handler> = {
  ping: pingHandler,
  config: configHandler,
};
