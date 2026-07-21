/**
 * Accessorial charges — extra billable line items beyond the base linehaul
 * rate. Pure validation only; no Next/Supabase imports so this runs under
 * `npm run test:offline` alongside pricing/calc.ts and loads/lifecycle.ts.
 *
 * Requirement coverage:
 *   FR-ACC-01  Four canonical accessorial types (Phase 1 scope): detention,
 *              layover, lumper, TONU. Fuel surcharge is a rate-line
 *              adjustment, not an accessorial, and isn't modeled here.
 *   FR-ACC-02  Every accessorial is billable to exactly one party — the
 *              customer or the carrier — never both, never neither.
 */

export const ACCESSORIAL_TYPE = {
  DETENTION: 'detention',
  LAYOVER: 'layover',
  LUMPER: 'lumper',
  TONU: 'tonu',
} as const;

export type AccessorialType = (typeof ACCESSORIAL_TYPE)[keyof typeof ACCESSORIAL_TYPE];

export const ACCESSORIAL_TYPE_LABELS: Record<AccessorialType, string> = {
  [ACCESSORIAL_TYPE.DETENTION]: 'Detention',
  [ACCESSORIAL_TYPE.LAYOVER]: 'Layover',
  [ACCESSORIAL_TYPE.LUMPER]: 'Lumper fee',
  [ACCESSORIAL_TYPE.TONU]: 'TONU (Truck Ordered Not Used)',
};

export function isValidAccessorialType(value: string): value is AccessorialType {
  return Object.values(ACCESSORIAL_TYPE).includes(value as AccessorialType);
}

export const BILLABLE_TO = {
  CUSTOMER: 'customer',
  CARRIER: 'carrier',
} as const;

export type BillableTo = (typeof BILLABLE_TO)[keyof typeof BILLABLE_TO];

export const BILLABLE_TO_LABELS: Record<BillableTo, string> = {
  [BILLABLE_TO.CUSTOMER]: 'Customer',
  [BILLABLE_TO.CARRIER]: 'Carrier',
};

export function isValidBillableTo(value: string): value is BillableTo {
  return Object.values(BILLABLE_TO).includes(value as BillableTo);
}

export interface AccessorialInput {
  type: string;
  amountCents: number;
  billableTo: string;
  description?: string;
}

export interface AccessorialValidationResult {
  ok: boolean;
  error?: string;
}

/** FR-ACC-01/02: everything the server action needs to check before inserting a row. */
export function validateAccessorial(input: AccessorialInput): AccessorialValidationResult {
  if (!isValidAccessorialType(input.type)) {
    return { ok: false, error: `Unknown accessorial type: "${input.type}".` };
  }
  if (!isValidBillableTo(input.billableTo)) {
    return { ok: false, error: `Unknown billable-to party: "${input.billableTo}".` };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: 'Amount must be a positive number of cents.' };
  }
  return { ok: true };
}
