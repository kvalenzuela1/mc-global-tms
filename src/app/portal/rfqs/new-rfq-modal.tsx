'use client';

import { useEffect, useState } from 'react';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { createRfq } from './actions';
import { PACKAGING_TYPES, PACKAGING_TYPE_LABELS, FREIGHT_CLASSES } from '@/lib/rfqs/freight-detail';

interface ShipperRow {
  id: string;
  name: string;
}

export function NewRfqModal({
  orgId,
  shippers,
  hideShipperField,
}: {
  orgId: string;
  shippers: ShipperRow[];
  /** A shipper submitting their own RFQ doesn't pick a shipper — they are one. */
  hideShipperField?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn-copper px-4 py-2 text-sm whitespace-nowrap"
        onClick={() => setOpen(true)}
      >
        + New RFQ
      </button>

      {/* Mounted only while open, so it doubles as the form's reset: closing
          unmounts this (and the ActionForm inside it), discarding any
          half-filled input state — no manual `form.reset()` needed. Reuse
          this open-gated-mount pattern rather than `useState` + manual reset
          if another modal needs the same behavior. */}
      {open && (
        <RfqDialog
          orgId={orgId}
          shippers={shippers}
          hideShipperField={hideShipperField}
          setOpen={setOpen}
        />
      )}
    </>
  );
}

function RfqDialog({
  orgId,
  shippers,
  hideShipperField,
  setOpen,
}: {
  orgId: string;
  shippers: ShipperRow[];
  hideShipperField?: boolean;
  setOpen: (open: boolean) => void;
}) {
  // This component only exists in the tree while the modal is open (see
  // NewRfqModal above), so mount/unmount IS open/close — the effect needs no
  // `open` dependency or early-return guard, it just runs once per mount.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [setOpen]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16"
      onClick={() => setOpen(false)}
    >
      <div
        className="panel w-full max-w-xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-rfq-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="new-rfq-title" className="font-semibold">
            New RFQ
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-muted hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>

        <ActionForm action={createRfq} className="mt-4 space-y-4" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="orgId" value={orgId} />
          {!hideShipperField && (
            <div>
              <label className="block text-sm mb-1">Shipper</label>
              <select name="shipperId" className="input">
                <option value="">— Unassigned —</option>
                {shippers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Origin</label>
              <input name="origin" required className="input" />
            </div>
            <div>
              <label className="block text-sm mb-1">Destination</label>
              <input name="destination" required className="input" />
            </div>
          </div>
          <div>
            <label className="block text-sm mb-1">Freight details</label>
            <input name="freightDetails" placeholder="18,000 lbs · 26 pallets" className="input" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm mb-1">Packaging type</label>
              <select name="packagingType" className="input">
                <option value="">—</option>
                {PACKAGING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PACKAGING_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Piece count</label>
              <input type="number" min="0" step="1" name="pieceCount" className="input" />
            </div>
            <div>
              <label className="block text-sm mb-1">Package count</label>
              <input type="number" min="0" step="1" name="packageCount" className="input" />
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Gross weight</label>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min="0" step="0.01" name="grossWeightValue" className="input" />
              <select name="grossWeightUnit" defaultValue="lb" className="input">
                <option value="lb">LB</option>
                <option value="kg">KG</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Dimensions (L × W × H)</label>
            <div className="grid grid-cols-4 gap-2">
              <input type="number" min="0" step="0.01" name="lengthValue" placeholder="Length" className="input" />
              <input type="number" min="0" step="0.01" name="widthValue" placeholder="Width" className="input" />
              <input type="number" min="0" step="0.01" name="heightValue" placeholder="Height" className="input" />
              <select name="dimensionUnit" defaultValue="in" className="input">
                <option value="in">IN</option>
                <option value="cm">CM</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">NMFC code</label>
              <input
                name="nmfcCode"
                placeholder="e.g. 156600 or 156600-01"
                pattern="[\d\s-]+"
                title="Digits, spaces, or hyphens only"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Freight class</label>
              <select name="freightClass" className="input">
                <option value="">—</option>
                {FREIGHT_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    Class {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Pickup date/time</label>
            <input type="datetime-local" name="pickupAt" className="input" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary px-4 py-2" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Saving…">
              Create RFQ
            </SubmitButton>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
