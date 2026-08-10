/**
 * Shared config for browse CLI + server.
 *
 * Resolution:
 *   1. BROWSE_STATE_FILE env → derive stateDir from parent
 *   2. git rev-parse --show-toplevel → projectDir/.gstack/
 *   3. process.cwd() fallback (non-git environments)
 *
 * The CLI computes the config and passes BROWSE_STATE_FILE to the
 * spawned server. The server derives all paths from that env var.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mkdirSecure } from './file-permissions';
import { isProcessAlive, safeKill, safeUnlinkQuiet } from './error-handling';

export interface BrowseConfig {
  projectDir: string;
  stateDir: string;
  stateFile: string;
  consoleLog: string;
  networkLog: string;
  dialogLog: string;
  auditLog: string;
}

/**
 * Detect the git repository root, or null if not in a repo / git unavailable.
 */
export function getGitRoot(): string | null {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2_000, // Don't hang if .git is broken
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve all browse config paths.
 *
 * If BROWSE_STATE_FILE is set (e.g. by CLI when spawning server, or by
 * tests for isolation), all paths are derived from it. Otherwise, the
 * project root is detected via git or cwd.
 */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): BrowseConfig {
  let stateFile: string;
  let stateDir: string;
  let projectDir: string;

  if (env.BROWSE_STATE_FILE) {
    stateFile = env.BROWSE_STATE_FILE;
    stateDir = path.dirname(stateFile);
    projectDir = path.dirname(stateDir); // parent of .gstack/
  } else {
    projectDir = getGitRoot() || process.cwd();
    stateDir = path.join(projectDir, '.gstack');
    stateFile = path.join(stateDir, 'browse.json');
  }

  return {
    projectDir,
    stateDir,
    stateFile,
    consoleLog: path.join(stateDir, 'browse-console.log'),
    networkLog: path.join(stateDir, 'browse-network.log'),
    dialogLog: path.join(stateDir, 'browse-dialog.log'),
    auditLog: path.join(stateDir, 'browse-audit.jsonl'),
  };
}

/**
 * Create the .gstack/ state directory if it doesn't exist.
 * Throws with a clear message on permission errors.
 */
export function ensureStateDir(config: BrowseConfig): void {
  try {
    mkdirSecure(config.stateDir);
  } catch (err: any) {
    if (err.code === 'EACCES') {
      throw new Error(`Cannot create state directory ${config.stateDir}: permission denied`);
    }
    if (err.code === 'ENOTDIR') {
      throw new Error(`Cannot create state directory ${config.stateDir}: a file exists at that path`);
    }
    throw err;
  }

  // Ensure .gstack/ is in the project's .gitignore
  const gitignorePath = path.join(config.projectDir, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.match(/^\.gstack\/?$/m)) {
      const separator = content.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${separator}.gstack/\n`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      // Write warning to server log (visible even in daemon mode)
      const logPath = path.join(config.stateDir, 'browse-server.log');
      try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Warning: could not update .gitignore at ${gitignorePath}: ${err.message}\n`);
      } catch {
        // stateDir write failed too — nothing more we can do
      }
    }
    // ENOENT (no .gitignore) — skip silently
  }
}

/**
 * Derive a slug from the git remote origin URL (owner-repo format).
 * Falls back to the directory basename if no remote is configured.
 */
export function getRemoteSlug(): string {
  try {
    const proc = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2_000,
    });
    if (proc.exitCode !== 0) throw new Error('no remote');
    const url = proc.stdout.toString().trim();
    // SSH:   git@github.com:owner/repo.git → owner-repo
    // HTTPS: https://github.com/owner/repo.git → owner-repo
    const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return `${match[1]}-${match[2]}`;
    throw new Error('unparseable');
  } catch {
    const root = getGitRoot();
    return path.basename(root || process.cwd());
  }
}

/**
 * Read the binary version (git SHA) from browse/dist/.version.
 * Returns null if the file doesn't exist or can't be read.
 */
export function readVersionHash(execPath: string = process.execPath): string | null {
  try {
    const versionFile = path.resolve(path.dirname(execPath), '.version');
    return fs.readFileSync(versionFile, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the gstack home directory.
 *
 * Honors the existing convention used by telemetry.ts and domain-skills.ts:
 *   1. G6_HOME env (explicit override, preferred name)
 *   2. GSTACK_HOME env (legacy override, still honored)
 *   3. $HOME/.gstack (default — post-v1.44 this is a symlink to $HOME/.g6,
 *      so the literal spelling keeps working everywhere)
 */
export function resolveGstackHome(): string {
  return process.env.G6_HOME || process.env.GSTACK_HOME || path.join(os.homedir(), '.gstack');
}

/**
 * Resolve the Chromium profile directory.
 *
 * Resolution order:
 *   1. `explicit` arg (passed via ServerConfig.chromiumProfile by embedders)
 *   2. CHROMIUM_PROFILE env (used by gbrowser's gbd per-workspace)
 *   3. <resolveGstackHome()>/chromium-profile (default)
 */
export function resolveChromiumProfile(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  const env = process.env.CHROMIUM_PROFILE;
  if (env && env.length > 0) return env;
  return path.join(resolveGstackHome(), 'chromium-profile');
}

/**
 * Pre-launch / shutdown cleanup of stale Chromium singleton lockfiles
 * (SingletonLock, SingletonSocket, SingletonCookie). Chromium's
 * ProcessSingleton refuses to start when these exist from a prior crash
 * (SIGKILL, hard crash, etc.) since they point at a PID that no longer exists.
 *
 * Defensive guard: refuses to operate unless ALL of these hold:
 *   1. `userDataDir` is an absolute path (no CWD-relative footguns)
 *   2. basename is exactly 'chromium-profile' OR the absolute path matches
 *      the absolute form of $CHROMIUM_PROFILE env value
 *
 * Prevents accidentally deleting lock files from an unrelated directory if
 * profile resolution is misconfigured upstream (CWD drift, env injection).
 *
 * Caller MUST ensure external coordination has already guaranteed no live
 * peer is using this profile (gbd.lock for gbrowser; single-instance CLI
 * check for gstack).
 */
function isRecognizedProfileDir(resolved: string): boolean {
  const explicitProfile = process.env.CHROMIUM_PROFILE;
  const explicitAbs = explicitProfile && path.isAbsolute(explicitProfile)
    ? path.resolve(explicitProfile)
    : null;
  return path.basename(resolved) === 'chromium-profile' || (explicitAbs !== null && resolved === explicitAbs);
}

export function cleanSingletonLocks(userDataDir: string): void {
  if (!path.isAbsolute(userDataDir)) {
    console.warn(`[browse] cleanSingletonLocks: refusing relative path: ${userDataDir}`);
    return;
  }
  const resolved = path.resolve(userDataDir);
  if (!isRecognizedProfileDir(resolved)) {
    console.warn(`[browse] cleanSingletonLocks: refusing to clean unrecognized profile dir: ${resolved}`);
    return;
  }
  for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    safeUnlinkQuiet(path.join(resolved, lockFile));
  }
}

/**
 * Return whether a process command belongs to Chromium using this exact
 * profile. Exported so the security-sensitive matcher can be unit tested
 * without sending signals to arbitrary processes.
 */
export function processCommandMatchesChromiumProfile(
  command: readonly string[] | string,
  userDataDir: string,
): boolean {
  const expectedProfileArg = `--user-data-dir=${path.resolve(userDataDir)}`;
  if (typeof command === 'string') {
    const profileIndex = command.indexOf(expectedProfileArg);
    if (profileIndex < 0) return false;
    const before = profileIndex === 0 ? '' : command[profileIndex - 1];
    const afterIndex = profileIndex + expectedProfileArg.length;
    const after = afterIndex >= command.length ? '' : command[afterIndex];
    const isWholeArgument = (!before || /\s|["']/.test(before))
      && (!after || /\s|["']/.test(after));
    if (!isWholeArgument) return false;

    // Only argv[0] may establish Chromium identity. Do not accept a node/python
    // process merely because a later script path or argument contains "chrome".
    const launchPrefix = command.slice(0, profileIndex).trimStart();
    const quotedExecutable = /^(?:"([^"]+)"|'([^']+)')/.exec(launchPrefix);
    const executable = quotedExecutable
      ? (quotedExecutable[1] || quotedExecutable[2])
      : (launchPrefix.match(/^\S+/)?.[0] || '');
    const executableName = path.basename(executable).toLowerCase();
    const isChromium = /^(?:google[- ]chrome(?:[- ](?:stable|beta|unstable|for[- ]testing))?|chromium(?:-browser)?|chrome|chrome-headless-shell|headless[_-]shell)(?:\.exe)?$/
      .test(executableName);
    // `ps -o command=` does not quote macOS app bundle paths, whose executable
    // names can contain spaces (for example, "Google Chrome for Testing").
    const isUnquotedMacBundle = /^\S*\/(?:google chrome(?: for testing)?|chromium)\.app\/contents\/macos\/(?:google chrome(?: for testing)?|chromium)(?:\s|$)/i
      .test(launchPrefix);
    return isChromium || isUnquotedMacBundle;
  }
  // Bun can surface Linux /proc/<pid>/cmdline as one packed command string
  // for Chromium's zygote launcher rather than one NUL-delimited entry per
  // argument. Treat that shape like the ps output below.
  if (command.length === 1 && command[0].includes(' ')) {
    return processCommandMatchesChromiumProfile(command[0], userDataDir);
  }
  const executable = path.basename(command[0] || '').toLowerCase();
  const isChromium = /chrom(?:e|ium)|headless[_-]shell/.test(executable);
  return isChromium && command.includes(expectedProfileArg);
}

function isChromiumProfileProcess(pid: number, userDataDir: string): boolean {
  if (!isProcessAlive(pid) || process.platform === 'win32') return false;

  if (process.platform === 'linux') {
    try {
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8')
        .split('\0')
        .filter(Boolean);
      return processCommandMatchesChromiumProfile(args, userDataDir);
    } catch {
      return false;
    }
  }

  try {
    const proc = Bun.spawnSync(['ps', '-ww', '-p', String(pid), '-o', 'command='], {
      stdout: 'pipe', stderr: 'pipe', timeout: 2000,
    });
    if (proc.exitCode !== 0) return false;
    return processCommandMatchesChromiumProfile(proc.stdout.toString().trim(), userDataDir);
  } catch {
    return false;
  }
}

/**
 * Kill a live orphan Chromium that still owns this profile's ProcessSingleton.
 * SingletonLock is a symlink to "hostname-PID"; while that PID is alive, a new
 * launchPersistentContext() on the same profile defers to the existing
 * instance and exits, which Playwright surfaces as CDP errors like
 * "Target.createTarget: Failed to open a new tab". Orphans happen when a
 * daemon dies (SIGKILL, crash) without taking its Chromium child along.
 *
 * Same recognized-dir guard as cleanSingletonLocks(). Never throws: if the
 * orphan can't be identified or killed, the launch fails with the same error
 * this cleanup exists to prevent, and the caller reports that.
 */
export async function killSingletonOrphan(
  userDataDir: string,
  processMatchesProfile: (pid: number, profileDir: string) => boolean = isChromiumProfileProcess,
): Promise<void> {
  if (!path.isAbsolute(userDataDir)) return;
  const resolved = path.resolve(userDataDir);
  if (!isRecognizedProfileDir(resolved)) return;
  let lockTarget = '';
  try {
    lockTarget = fs.readlinkSync(path.join(resolved, 'SingletonLock')); // "hostname-12345"
  } catch {
    return; // no lock (ENOENT) or not a symlink (EINVAL) — nothing holds the profile
  }

  const separator = lockTarget.lastIndexOf('-');
  if (separator <= 0) return;
  const lockHost = lockTarget.slice(0, separator);
  const pidText = lockTarget.slice(separator + 1);
  if (lockHost !== os.hostname() || !/^\d+$/.test(pidText)) return;

  const orphanPid = Number.parseInt(pidText, 10);
  if (!orphanPid || !processMatchesProfile(orphanPid, resolved)) return;
  safeKill(orphanPid, 'SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 1000));
  // Re-check ownership before escalating. The original Chromium may have
  // exited and its PID may already belong to an unrelated process.
  if (isProcessAlive(orphanPid) && processMatchesProfile(orphanPid, resolved)) {
    safeKill(orphanPid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
