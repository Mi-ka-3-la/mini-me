import { pingHandler } from './_lib/handlers/ping.js';
import { toVercel } from './_lib/vercel.js';

export default toVercel('ping', pingHandler);
