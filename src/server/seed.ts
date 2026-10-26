import type { Runtime } from './app';
import { seedGlobalAssets } from './seed_assets';
import { seedDemoForAdmin } from './seed_workspace';

export { seedDemoForAdmin };

export function seedIfEmpty(runtime: Runtime) {
  seedGlobalAssets(runtime.db);
}
