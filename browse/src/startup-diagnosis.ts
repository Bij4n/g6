/**
 * Startup failure diagnosis — names the real cause when the daemon starts
 * but the CLI can't reach it.
 *
 * Motivation (2026-07-29): on a machine whose IPv4 loopback TCP was broken,
 * the daemon started fine but every health probe to 127.0.0.1 timed out.
 * The CLI reported "Server failed to start:" followed by whatever the daemon
 * had written to stderr — an unrelated welcome-page warning — and an hour
 * went to debugging the wrong layer. The raw-TCP probe below separates the
 * three cases, which need three different messages:
 *
 *   TCP connect times out  → loopback networking is broken (machine-level)
 *   TCP connects, no HTTP  → the daemon is wedged
 *   TCP refused            → the listener never came up (genuine startup failure)
 */

import * as net from 'net';

export type TcpProbeResult = 'connected' | 'refused' | 'timeout';

export type StartupFailureKind = 'loopback-broken' | 'daemon-wedged' | 'not-started';

/**
 * Raw TCP connect probe. Unlike fetch(), this distinguishes "nothing is
 * listening" (refused) from "packets go nowhere" (timeout) — the tell that
 * separates a dead daemon from a broken loopback interface.
 */
export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<TcpProbeResult> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (result: TcpProbeResult) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(result);
    };
    sock.setTimeout(timeoutMs, () => done('timeout'));
    sock.once('connect', () => done('connected'));
    sock.once('error', () => done('refused'));
    sock.connect(port, host);
  });
}

export function classifyStartupFailure(pidAlive: boolean, tcp: TcpProbeResult): StartupFailureKind {
  if (!pidAlive) return 'not-started';
  if (tcp === 'timeout') return 'loopback-broken';
  if (tcp === 'connected') return 'daemon-wedged';
  // refused: daemon process is alive but its listener never came up —
  // treat as a genuine startup failure so the caller surfaces stderr.
  return 'not-started';
}

export function startupFailureMessage(kind: Exclude<StartupFailureKind, 'not-started'>, pid: number, port: number): string {
  if (kind === 'loopback-broken') {
    return (
      `The browse daemon started (PID ${pid}) but TCP connections to 127.0.0.1:${port} ` +
      `time out instead of connecting.\n` +
      `This is a machine-level fault — loopback networking is broken — not a browse failure. ` +
      `It also breaks anything else that dials 127.0.0.1 (dev servers, build workers), ` +
      `and a reboot usually fixes it.\n` +
      `Confirm with: curl --max-time 3 http://127.0.0.1:${port}/health ` +
      `(a timeout, not "connection refused", is the tell).\n` +
      `The unreachable daemon was stopped.`
    );
  }
  return (
    `The browse daemon started (PID ${pid}) and accepts TCP on 127.0.0.1:${port}, ` +
    `but /health never answered — the process is wedged.\n` +
    `It was stopped; retry the command. If this repeats, the daemon is hitting a real bug — ` +
    `capture its output by running the server script directly.`
  );
}
