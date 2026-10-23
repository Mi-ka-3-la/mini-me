import { analyzeHandler } from './_lib/handlers/analyze.js';
import { toVercel } from './_lib/vercel.js';

export default toVercel('analyze', analyzeHandler);
