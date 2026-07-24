'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ActionForm } from '../../_components/action-form';
import { SubmitButton } from '../../_components/submit-button';
import { createRfq } from '../actions';
import { equipmentTypesByCategory } from '@/lib/rfqs/equipment';
import {
  SHIPMENT_TYPES,
  SHIPMENT_TYPE_LABELS,
  TRAILER_SIZES,
  HAZMAT_CLASSES,
  PACKAGING_TYPES,
  PACKAGING_TYPE_LABELS,
  FREIGHT_CLASSES,
  freightClassFromDensity,
  validateRfqInput,
  ltlTotalWeightLb,
  type RfqValidationInput,
  type HandlingUnitInput,
  type ShipmentType,
} from '@/lib/rfqs/freight-detail';
import type { ActionResult } from '@/lib/actions/result';

interface ShipperRow {
  id: string;
  name: string;
}

/** One LTL handling unit in the client-side editor. */
interface UnitState {
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  weightLb: string;
  unitCount: string;
  packagingType: string;
  freightClass: string;
  freightClassIsOverride: boolean;
  nmfcCode: string;
  stackable: boolean;
}

const emptyUnit = (): UnitState => ({
  lengthIn: '',
  widthIn: '',
  heightIn: '',
  weightLb: '',
  unitCount: '1',
  packagingType: 'pallet',
  freightClass: '',
  freightClassIsOverride: false,
  nmfcCode: '',
  stackable: false,
});

/**
 * FR-RFQ-04: the shipment-type-driven RFQ create form. A client component so
 * the type selector can drive which fields render, the LTL line-item editor can
 * grow/shrink, freight class can auto-calc from density, and validation can
 * show inline per-field errors — none of which a server-rendered form can do.
 * The server action re-validates everything regardless.
 */
export function RfqForm({
  orgId,
  shippers,
  hideShipperField,
}: {
  orgId: string;
  shippers: ShipperRow[];
  hideShipperField?: boolean;
}) {
  // "today" captured once per mount so the past-date rule is stable while the
  // form is open — the server re-validates against its own clock anyway.
  const [todayIso] = useState(() => new Date().toISOString().slice(0, 10));

  const [shipmentType, setShipmentType] = useState<ShipmentType | ''>('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [units, setUnits] = useState<UnitState[]>([]);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);

  const setField = (name: string, value: string) => setForm((f) => ({ ...f, [name]: value }));
  const bind = (name: string) => ({
    name,
    value: form[name] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setField(name, e.target.value),
    onBlur: () => setTouched((t) => new Set(t).add(name)),
    className: 'input',
  });
  const toggle = (name: string) => setFlags((f) => ({ ...f, [name]: !f[name] }));

  const validationInput: RfqValidationInput = useMemo(
    () => ({
      shipmentType,
      shipFromCity: form.shipFromCity,
      shipFromState: form.shipFromState,
      shipFromZip: form.shipFromZip,
      shipToCity: form.shipToCity,
      shipToState: form.shipToState,
      shipToZip: form.shipToZip,
      pickupDate: form.pickupDate,
      pickupWindowStart: form.pickupWindowStart,
      pickupWindowEnd: form.pickupWindowEnd,
      deliveryDate: form.deliveryDate,
      commodity: form.commodity,
      totalWeight: form.totalWeight,
      isHazmat: flags.isHazmat,
      unNumber: form.unNumber,
      hazmatClass: form.hazmatClass,
      equipmentType: form.equipmentType,
      temperatureF: form.temperatureF,
      trailerSize: form.trailerSize,
      palletCount: form.palletCount,
      lengthIn: form.lengthIn,
      widthIn: form.widthIn,
      heightIn: form.heightIn,
      linearFeet: form.linearFeet,
      freightDescription: form.freightDescription,
      handlingUnits: units as HandlingUnitInput[],
    }),
    [shipmentType, form, flags, units],
  );

  const errors = useMemo(
    () => (shipmentType ? validateRfqInput(validationInput, todayIso).errors : {}),
    [validationInput, todayIso, shipmentType],
  );

  const errFor = (name: string): string | null =>
    (attempted || touched.has(name)) && errors[name] ? errors[name] : null;

  // Client-side gate: runs the same validator, surfaces all inline errors, and
  // only calls the real server action (which redirects on success) when the
  // client considers the form valid. The server re-validates regardless.
  const clientAction = async (formData: FormData): Promise<ActionResult> => {
    setAttempted(true);
    const result = validateRfqInput(validationInput, todayIso);
    if (!result.ok) {
      return { ok: false, error: 'Please correct the highlighted fields.' };
    }
    return createRfq(formData);
  };

  const isReefer = shipmentType === 'ftl' && form.equipmentType === 'reefer';
  const ltlTotal = shipmentType === 'ltl' ? ltlTotalWeightLb(units as HandlingUnitInput[]) : 0;

  return (
    <ActionForm action={clientAction} className="panel mt-6 p-6 space-y-5 max-w-2xl">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="shipmentType" value={shipmentType} />
      <input type="hidden" name="isHazmat" value={flags.isHazmat ? 'true' : 'false'} />
      <input type="hidden" name="stackable" value={flags.stackable ? 'true' : 'false'} />
      {(['accLiftgate', 'accResidential', 'accInsidePickup', 'accInsideDelivery', 'accLimitedAccess'] as const).map(
        (a) => (
          <input key={a} type="hidden" name={a} value={flags[a] ? 'true' : 'false'} />
        ),
      )}
      <input type="hidden" name="handlingUnits" value={JSON.stringify(serializeUnits(units))} />

      {/* 1 — Shipment type selector drives the whole form. */}
      <div>
        <label className="block text-sm mb-1 font-medium">Shipment type</label>
        <div className="grid grid-cols-3 gap-2">
          {SHIPMENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setShipmentType(t)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                shipmentType === t ? 'border-copper-400 text-copper-300' : 'border-line text-muted hover:text-ink'
              }`}
            >
              {SHIPMENT_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        {attempted && errors.shipmentType && <p className="text-danger text-xs mt-1">{errors.shipmentType}</p>}
      </div>

      {shipmentType && (
        <>
          {!hideShipperField && (
            <div>
              <label className="block text-sm mb-1">Shipper account (bill-to)</label>
              <select name="shipperId" className="input" defaultValue="">
                <option value="">— Unassigned —</option>
                {shippers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Ship From / Ship To — structured addresses (BOL parties). */}
          <div className="grid md:grid-cols-2 gap-4">
            <AddressBlock title="Ship From (origin)" prefix="shipFrom" bind={bind} errFor={errFor} />
            <AddressBlock title="Ship To (consignee)" prefix="shipTo" bind={bind} errFor={errFor} />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pickup date" error={errFor('pickupDate')}>
              <input type="date" {...bind('pickupDate')} />
            </Field>
            <Field label="Delivery date (optional)" error={errFor('deliveryDate')}>
              <input type="date" {...bind('deliveryDate')} />
            </Field>
            <Field label="Pickup window start (optional)" error={errFor('pickupWindowStart')}>
              <input type="time" {...bind('pickupWindowStart')} />
            </Field>
            <Field label="Pickup window end (optional)" error={errFor('pickupWindowEnd')}>
              <input type="time" {...bind('pickupWindowEnd')} />
            </Field>
          </div>

          {/* Commodity + reference (shared) */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Commodity" error={errFor('commodity')}>
              <input {...bind('commodity')} placeholder="e.g. palletized canned goods" />
            </Field>
            <Field label="Reference / PO number (optional)" error={null}>
              <input {...bind('referenceNumber')} />
            </Field>
          </div>

          {/* Type-specific sections */}
          {shipmentType === 'ftl' && <FtlFields bind={bind} errFor={errFor} isReefer={isReefer} />}
          {shipmentType === 'ptl' && <PtlFields bind={bind} errFor={errFor} />}
          {shipmentType === 'ltl' && (
            <LtlFields units={units} setUnits={setUnits} errors={errors} attempted={attempted} ltlTotal={ltlTotal} />
          )}

          {/* Stackable — shared for FTL/PTL (LTL is per handling unit) */}
          {(shipmentType === 'ftl' || shipmentType === 'ptl') && (
            <Checkbox label="Stackable" checked={!!flags.stackable} onChange={() => toggle('stackable')} />
          )}

          {/* Accessorials (shared) */}
          <fieldset className="border border-line rounded-lg p-3">
            <legend className="text-sm px-1 text-muted">Accessorials</legend>
            <div className="grid grid-cols-2 gap-2">
              <Checkbox label="Liftgate" checked={!!flags.accLiftgate} onChange={() => toggle('accLiftgate')} />
              <Checkbox label="Residential" checked={!!flags.accResidential} onChange={() => toggle('accResidential')} />
              <Checkbox label="Inside pickup" checked={!!flags.accInsidePickup} onChange={() => toggle('accInsidePickup')} />
              <Checkbox label="Inside delivery" checked={!!flags.accInsideDelivery} onChange={() => toggle('accInsideDelivery')} />
              <Checkbox label="Limited access" checked={!!flags.accLimitedAccess} onChange={() => toggle('accLimitedAccess')} />
            </div>
          </fieldset>

          {/* Hazmat (shared) */}
          <fieldset className="border border-line rounded-lg p-3">
            <legend className="text-sm px-1 text-muted">Hazmat</legend>
            <Checkbox label="This shipment is hazmat" checked={!!flags.isHazmat} onChange={() => toggle('isHazmat')} />
            {flags.isHazmat && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Field label="UN number" error={errFor('unNumber')}>
                  <input {...bind('unNumber')} placeholder="e.g. 1203" inputMode="numeric" />
                </Field>
                <Field label="Hazard class" error={errFor('hazmatClass')}>
                  <select {...bind('hazmatClass')}>
                    <option value="">—</option>
                    {HAZMAT_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        Class {c}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </fieldset>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Link href="/portal/rfqs" className="btn-secondary px-4 py-2">
          Cancel
        </Link>
        <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Saving…">
          Create RFQ
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Map the editor's unit state to the server/validator shape. */
function serializeUnits(units: UnitState[]): HandlingUnitInput[] {
  return units.map((u) => ({
    lengthIn: u.lengthIn,
    widthIn: u.widthIn,
    heightIn: u.heightIn,
    weightLb: u.weightLb,
    unitCount: u.unitCount,
    packagingType: u.packagingType,
    freightClass: u.freightClass,
    freightClassIsOverride: u.freightClassIsOverride,
    nmfcCode: u.nmfcCode,
    stackable: u.stackable,
  }));
}

// --- small presentational helpers -------------------------------------------

function Field({ label, error, children }: { label: string; error: string | null; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm mb-1">{label}</label>
      {children}
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

type Bind = (name: string) => {
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onBlur: () => void;
  className: string;
};
type ErrFor = (name: string) => string | null;

function AddressBlock({ title, prefix, bind, errFor }: { title: string; prefix: string; bind: Bind; errFor: ErrFor }) {
  const f = (suffix: string) => `${prefix}${suffix}`;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <Field label="Name (optional)" error={null}>
        <input {...bind(f('Name'))} />
      </Field>
      <Field label="Address (optional)" error={null}>
        <input {...bind(f('Address'))} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="City" error={errFor(f('City'))}>
          <input {...bind(f('City'))} />
        </Field>
        <Field label="State" error={errFor(f('State'))}>
          <input {...bind(f('State'))} maxLength={2} placeholder="TX" />
        </Field>
        <Field label="ZIP" error={errFor(f('Zip'))}>
          <input {...bind(f('Zip'))} placeholder="75001" />
        </Field>
      </div>
    </div>
  );
}

function FtlFields({ bind, errFor, isReefer }: { bind: Bind; errFor: ErrFor; isReefer: boolean }) {
  return (
    <fieldset className="border border-line rounded-lg p-3 space-y-3">
      <legend className="text-sm px-1 text-muted">Full truckload</legend>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Equipment type" error={errFor('equipmentType')}>
          <select {...bind('equipmentType')}>
            <option value="">—</option>
            {equipmentTypesByCategory().map((group) => (
              <optgroup key={group.category} label={group.label}>
                {group.types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.def.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Trailer size" error={errFor('trailerSize')}>
          <select {...bind('trailerSize')}>
            <option value="">—</option>
            {TRAILER_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} ft
              </option>
            ))}
          </select>
        </Field>
        {isReefer && (
          <Field label="Temperature (°F)" error={errFor('temperatureF')}>
            <input type="number" step="1" {...bind('temperatureF')} />
          </Field>
        )}
        <Field label="Total weight (lb)" error={errFor('totalWeight')}>
          <input type="number" min="0" step="0.01" {...bind('totalWeight')} />
        </Field>
        <Field label="Number of pallets (optional)" error={errFor('palletCount')}>
          <input type="number" min="0" step="1" {...bind('palletCount')} />
        </Field>
      </div>
    </fieldset>
  );
}

function PtlFields({ bind, errFor }: { bind: Bind; errFor: ErrFor }) {
  return (
    <fieldset className="border border-line rounded-lg p-3 space-y-3">
      <legend className="text-sm px-1 text-muted">Partial truckload</legend>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Length (in)" error={errFor('lengthIn')}>
          <input type="number" min="0" step="0.01" {...bind('lengthIn')} />
        </Field>
        <Field label="Width (in)" error={errFor('widthIn')}>
          <input type="number" min="0" step="0.01" {...bind('widthIn')} />
        </Field>
        <Field label="Height (in)" error={errFor('heightIn')}>
          <input type="number" min="0" step="0.01" {...bind('heightIn')} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Weight (lb)" error={errFor('totalWeight')}>
          <input type="number" min="0" step="0.01" {...bind('totalWeight')} />
        </Field>
        <Field label="Linear feet" error={errFor('linearFeet')}>
          <input type="number" min="0" step="0.01" {...bind('linearFeet')} />
        </Field>
        <Field label="Number of pallets (optional)" error={errFor('palletCount')}>
          <input type="number" min="0" step="1" {...bind('palletCount')} />
        </Field>
      </div>
      <Field label="Freight description" error={errFor('freightDescription')}>
        <input {...bind('freightDescription')} />
      </Field>
    </fieldset>
  );
}

function LtlFields({
  units,
  setUnits,
  errors,
  attempted,
  ltlTotal,
}: {
  units: UnitState[];
  setUnits: React.Dispatch<React.SetStateAction<UnitState[]>>;
  errors: Record<string, string>;
  attempted: boolean;
  ltlTotal: number;
}) {
  const update = (i: number, patch: Partial<UnitState>) =>
    setUnits((prev) => {
      const next = prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u));
      const u = next[i];
      // Re-derive class from density unless the user has overridden it.
      if (!u.freightClassIsOverride) {
        const cls = freightClassFromDensity(
          Number(u.weightLb),
          Number(u.lengthIn),
          Number(u.widthIn),
          Number(u.heightIn),
        );
        next[i] = { ...u, freightClass: cls != null ? String(cls) : '' };
      }
      return next;
    });

  const err = (i: number, field: string): string | null =>
    attempted && errors[`units[${i}].${field}`] ? errors[`units[${i}].${field}`] : null;

  return (
    <fieldset className="border border-line rounded-lg p-3 space-y-3">
      <legend className="text-sm px-1 text-muted">LTL handling units (inches / lb)</legend>
      {attempted && errors.handlingUnits && <p className="text-danger text-xs">{errors.handlingUnits}</p>}

      {units.map((u, i) => (
        <div key={i} className="border border-line rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Unit {i + 1}</p>
            <button
              type="button"
              className="text-muted hover:text-danger text-sm"
              onClick={() => setUnits((prev) => prev.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Field label="Length (in)" error={err(i, 'lengthIn')}>
              <input type="number" min="0" step="0.01" className="input" value={u.lengthIn} onChange={(e) => update(i, { lengthIn: e.target.value })} />
            </Field>
            <Field label="Width (in)" error={err(i, 'widthIn')}>
              <input type="number" min="0" step="0.01" className="input" value={u.widthIn} onChange={(e) => update(i, { widthIn: e.target.value })} />
            </Field>
            <Field label="Height (in)" error={err(i, 'heightIn')}>
              <input type="number" min="0" step="0.01" className="input" value={u.heightIn} onChange={(e) => update(i, { heightIn: e.target.value })} />
            </Field>
            <Field label="Weight (lb)" error={err(i, 'weightLb')}>
              <input type="number" min="0" step="0.01" className="input" value={u.weightLb} onChange={(e) => update(i, { weightLb: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Field label="Units" error={err(i, 'unitCount')}>
              <input type="number" min="1" step="1" className="input" value={u.unitCount} onChange={(e) => update(i, { unitCount: e.target.value })} />
            </Field>
            <Field label="Packaging" error={err(i, 'packagingType')}>
              <select className="input" value={u.packagingType} onChange={(e) => update(i, { packagingType: e.target.value })}>
                {PACKAGING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PACKAGING_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Freight class" error={err(i, 'freightClass')}>
              <select
                className="input"
                value={u.freightClass}
                onChange={(e) => update(i, { freightClass: e.target.value, freightClassIsOverride: true })}
              >
                <option value="">—</option>
                {FREIGHT_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="NMFC (optional)" error={err(i, 'nmfcCode')}>
              <input className="input" value={u.nmfcCode} onChange={(e) => update(i, { nmfcCode: e.target.value })} />
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <Checkbox label="Stackable" checked={u.stackable} onChange={() => update(i, { stackable: !u.stackable })} />
            {u.freightClassIsOverride ? (
              <button
                type="button"
                className="text-xs text-copper-400 hover:text-copper-300"
                onClick={() => update(i, { freightClassIsOverride: false })}
              >
                Use auto class from density
              </button>
            ) : (
              u.freightClass && <span className="text-xs text-muted">Auto class {u.freightClass} from density</span>
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-sm"
          onClick={() => setUnits((prev) => [...prev, emptyUnit()])}
        >
          + Add handling unit
        </button>
        {units.length > 0 && <span className="text-sm text-muted">Total weight: {ltlTotal} lb</span>}
      </div>
    </fieldset>
  );
}
