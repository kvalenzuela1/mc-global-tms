/**
 * FR-DOC-01 — binary-safe document hashing.
 */
import { describe, it, expect } from 'vitest';
import { hashBytes } from '@/lib/documents/hash';

describe('document hash', () => {
  it('FR-DOC-01: produces a stable sha256 hex digest for the same bytes', () => {
    const bytes = new TextEncoder().encode('hello world');
    expect(hashBytes(bytes)).toBe(hashBytes(bytes));
    expect(hashBytes(bytes)).toHaveLength(64);
  });

  it('FR-DOC-01: different bytes produce a different hash', () => {
    const a = hashBytes(new TextEncoder().encode('hello'));
    const b = hashBytes(new TextEncoder().encode('world'));
    expect(a).not.toBe(b);
  });
});
