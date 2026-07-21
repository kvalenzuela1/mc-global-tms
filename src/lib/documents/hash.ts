/**
 * FR-DOC-01: binary-safe content hashing for uploaded documents.
 *
 * `hashDocument()` in `src/lib/signatures/evidence.ts` is text/string-specific
 * (rate-confirmation JSON snapshots) — uploaded files are binary, so this is
 * a separate small variant rather than overloading that one.
 */
import { createHash } from 'node:crypto';

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
