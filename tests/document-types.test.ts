/**
 * FR-DOC-02 — uploadable document types (lumper receipts & scale tickets).
 */
import { describe, it, expect } from 'vitest';
import {
  UPLOADABLE_DOC_TYPES,
  DOC_TYPE_LABELS,
  isUploadableDocType,
} from '@/lib/documents/types';

describe('uploadable document types', () => {
  it('FR-DOC-02: lumper receipts and scale tickets are uploadable', () => {
    expect(isUploadableDocType('lumper')).toBe(true);
    expect(isUploadableDocType('scale_ticket')).toBe(true);
  });

  it('FR-DOC-02: the original load paperwork types stay uploadable', () => {
    expect(isUploadableDocType('bol')).toBe(true);
    expect(isUploadableDocType('pod')).toBe(true);
    expect(isUploadableDocType('receipt')).toBe(true);
    expect(isUploadableDocType('other')).toBe(true);
  });

  it('FR-DOC-02: system/carrier-scoped types are never user-uploadable', () => {
    // coi is carrier-scoped (no RLS carve-out) and ratecon_pdf is
    // system-generated — both valid at the DB level, neither offered here.
    expect(isUploadableDocType('coi')).toBe(false);
    expect(isUploadableDocType('ratecon_pdf')).toBe(false);
  });

  it('FR-DOC-02: unknown values are rejected', () => {
    expect(isUploadableDocType('')).toBe(false);
    expect(isUploadableDocType('invoice')).toBe(false);
  });

  it('FR-DOC-02: every uploadable type has a display label', () => {
    for (const t of UPLOADABLE_DOC_TYPES) {
      expect(typeof DOC_TYPE_LABELS[t]).toBe('string');
      expect(DOC_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
  });
});
