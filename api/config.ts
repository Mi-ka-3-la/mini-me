import { configHandler } from './_lib/handlers/config.js';
import { toVercel } from './_lib/vercel.js';

export default toVercel('config', configHandler);
