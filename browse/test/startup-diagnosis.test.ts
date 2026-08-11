/**
 * Startup failure diagnosis — the fix for the 2026-07-29 misattribution where
 * a broken IPv4 loopback surfaced as "Server failed to start" plus an
 * unrelated welcome-page warning from daemon stderr.
 */
import { describe, test, expect } from 'bun:test';
import * as net from 'net';
import { tcpProbe, classifyStartupFailure, startupFailureMessage } from '../src/startup-diagnosis';

describe('classifyStartupFailure', () => {
  test('dead pid is not-started regardless of probe', () => {
    expect(classifyStartupFailure(false, 'timeout')).toBe('not-started');
    expect(classifyStartupFailure(false, 'refused')).toBe('not-started');
    expect(classifyStartupFailure(false, 'connected')).toBe('not-started');
  });

  test('live pid + TCP timeout means loopback is broken', () => {
    expect(classifyStartupFailure(true, 'timeout')).toBe('loopback-broken');
  });

  test('live pid + TCP connect (but no /health) means the daemon is wedged', () => {
    expect(classifyStartupFailure(true, 'connected')).toBe('daemon-wedged');
  });

  test('live pid + refused means the listener never came up — generic startup failure', () => {
    expect(classifyStartupFailure(true, 'refused')).toBe('not-started');
  });
});

describe('startupFailureMessage', () => {
  test('loopback message names the machine fault, the tell, and the cleanup', () => {
    const msg = startupFailureMessage('loopback-broken', 4242, 34567);
    expect(msg).toContain('PID 4242');
    expect(msg).toContain('127.0.0.1:34567');
    expect(msg).toContain('machine-level');
    expect(msg).toContain('reboot');
    expect(msg).toContain('daemon was stopped');
    // Must NOT read like a browse defect
    expect(msg).toContain('not a browse failure');
  });

  test('wedged message says TCP works but /health does not, and to retry', () => {
    const msg = startupFailureMessage('daemon-wedged', 4242, 34567);
    expect(msg).toContain('PID 4242');
    expect(msg).toContain('accepts TCP on 127.0.0.1:34567');
    expect(msg).toContain('/health');
    expect(msg).toContain('retry');
  });
});

describe('tcpProbe', () => {
  test('reports connected for a live listener', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await tcpProbe('127.0.0.1', port, 2000)).toBe('connected');
    } finally {
      server.close();
    }
  });

  test('reports refused for a closed port', async () => {
    // Bind then close to get a port that is definitely not listening.
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await tcpProbe('127.0.0.1', port, 2000)).toBe('refused');
  });

  test('reports timeout when packets go nowhere', async () => {
    // A listener with backlog 0 whose queue is already saturated is unreliable
    // cross-platform, so simulate the loopback-broken case the portable way:
    // an unroutable RFC 5737 TEST-NET address never answers a SYN.
    expect(await tcpProbe('192.0.2.1', 9, 500)).toBe('timeout');
  });
});
