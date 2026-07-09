/**
 * security-events buffer — transport between server security layers and the
 * sidepanel shield/banner. Cursor semantics matter: the sidepanel polls with
 * ?after=<last id> and must never re-banner an already-seen event.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  emitSecurityEvent,
  getSecurityEvents,
  clearSecurityEvents,
} from '../src/security-events';

beforeEach(() => clearSecurityEvents());

describe('security-events buffer', () => {
  test('emits monotonically increasing ids with timestamps', () => {
    const a = emitSecurityEvent({ verdict: 'strip', reason: 'r', layer: 'content_security', confidence: 1 });
    const b = emitSecurityEvent({ verdict: 'block', reason: 'canary_leaked', layer: 'canary', confidence: 1 });
    expect(b.id).toBe(a.id + 1);
    expect(a.type).toBe('security_event');
    expect(Date.parse(a.ts)).toBeGreaterThan(0);
  });

  test('after-cursor returns only unseen events', () => {
    emitSecurityEvent({ verdict: 'strip', reason: 'r1', layer: 'content_security', confidence: 1 });
    const second = emitSecurityEvent({ verdict: 'block', reason: 'r2', layer: 'canary', confidence: 1 });
    expect(getSecurityEvents(0).length).toBe(2);
    const unseen = getSecurityEvents(second.id - 1);
    expect(unseen.length).toBe(1);
    expect(unseen[0].reason).toBe('r2');
    expect(getSecurityEvents(second.id)).toEqual([]);
  });

  test('ring buffer caps at 100 without breaking cursor ids', () => {
    for (let i = 0; i < 130; i++) {
      emitSecurityEvent({ verdict: 'strip', reason: `r${i}`, layer: 'content_security', confidence: 1 });
    }
    const all = getSecurityEvents(0);
    expect(all.length).toBe(100);
    expect(all[0].reason).toBe('r30');
    expect(all[99].reason).toBe('r129');
    expect(all[99].id).toBe(130);
  });

  test('optional fields only present when provided', () => {
    const bare = emitSecurityEvent({ verdict: 'warn', reason: 'r', layer: 'canary', confidence: 0.5 });
    expect('domain' in bare).toBe(false);
    const full = emitSecurityEvent({
      verdict: 'block', reason: 'r', layer: 'canary', confidence: 1,
      domain: 'evil.example.com', channel: 'tool_use:Bash',
      signals: [{ layer: 'testsavant_content', confidence: 0.9 }],
    });
    expect(full.domain).toBe('evil.example.com');
    expect(full.signals?.length).toBe(1);
  });
});
