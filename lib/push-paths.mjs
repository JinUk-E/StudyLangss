import { resolve } from 'node:path';

/** Use one location for server, initial setup, and local delivery commands. */
export function pushPaths(root, env = process.env) {
  const directory = resolve(env.PUSH_DATA_DIR || (env.PORTFOLIO_DATA_DIR ? resolve(env.PORTFOLIO_DATA_DIR, 'push') : resolve(root, 'data/push')));
  return { directory, configFile: resolve(env.PUSH_CONFIG_FILE || resolve(directory, 'vapid.json')) };
}
