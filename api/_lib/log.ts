/**
 * The only logger the server uses. It accepts numbers, booleans and short codes,
 * never free text, so transcript or analysis content cannot reach the logs.
 */
const CODE = /^[a-z0-9_.:-]{1,64}$/i;

export function logEvent(
  fields: { route: string } & Record<string, number | boolean | string | undefined>,
): void {
  const safe: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (typeof v === 'string') {
      // Only short machine codes are allowed through.
      if (CODE.test(v)) safe[k] = v;
      continue;
    }
    safe[k] = v;
  }
  console.info(JSON.stringify({ evt: 'api', ...safe }));
}
