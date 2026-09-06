import { execSync } from 'child_process';
import * as os from 'os';

/**
 * Best-effort local user identity, used to attribute gate approvals and
 * overrides. Prefers the repo's configured git author name (so it matches the
 * `by:` allowlists in gate config), then the OS user, then a generic fallback.
 *
 * @param cwd The store root — the directory whose git config to consult.
 */
export function localIdentity(cwd: string | undefined): string {
  try {
    const name = execSync('git config user.name', {
      cwd: cwd || undefined,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (name) {
      return name;
    }
  } catch {
    /* git missing / not a repo / no user.name — fall through */
  }
  try {
    const username = os.userInfo().username;
    if (username) {
      return username;
    }
  } catch {
    /* ignore */
  }
  return 'user';
}
