/**
 * Security event buffer — the transport between server-side security layers
 * and the sidepanel's banner UI.
 *
 * The original security_event flow rode the /sidebar-chat queue; that whole
 * path was removed in the PTY rewrite, silently orphaning the sidepanel's
 * shield + banner. This module is the queue-free replacement: any layer
 * (canary check, ML classifier verdict, content-security strip) calls
 * emitSecurityEvent(); the sidepanel polls GET /security-events.
 *
 * Severity contract: the sidepanel only raises the full-screen banner for
 * verdict === 'block' (session-terminating events: canary leaks, ensemble
 * BLOCK). Lower-severity entries (verdict 'strip'/'warn') are informational
 * — carried in the feed, never bannered. Keep it that way: a banner that
 * cries wolf on routine content strips trains users to dismiss real alerts.
 *
 * No tokens, no secrets in entries — this feed is readable by any holder of
 * a valid client token (see /health token rule in ARCHITECTURE.md).
 */

export interface SecurityEvent {
  id: number;
  ts: string;
  type: 'security_event';
  verdict: 'block' | 'strip' | 'warn';
  reason: string;
  layer: string;
  confidence: number;
  domain?: string;
  channel?: string;
  signals?: Array<{ layer: string; confidence: number }>;
}

const MAX_EVENTS = 100;
const events: SecurityEvent[] = [];
let nextId = 1;

export function emitSecurityEvent(
  event: Omit<SecurityEvent, 'id' | 'ts' | 'type'> & { ts?: string },
): SecurityEvent {
  const entry: SecurityEvent = {
    type: 'security_event',
    id: nextId++,
    ts: event.ts || new Date().toISOString(),
    verdict: event.verdict,
    reason: event.reason,
    layer: event.layer,
    confidence: event.confidence,
    ...(event.domain ? { domain: event.domain } : {}),
    ...(event.channel ? { channel: event.channel } : {}),
    ...(event.signals ? { signals: event.signals } : {}),
  };
  events.push(entry);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return entry;
}

/** Entries with id > afterId, oldest first. */
export function getSecurityEvents(afterId: number = 0): SecurityEvent[] {
  return events.filter((e) => e.id > afterId);
}

/** Test hook — reset buffer state between tests. */
export function clearSecurityEvents(): void {
  events.length = 0;
  nextId = 1;
}
