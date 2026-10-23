import type { Handler } from './http.js';

/** Route table used by the local dev server. Vercel uses the files in /api directly. */
export const routes: Record<string, Handler> = {};
