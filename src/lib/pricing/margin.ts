/**
 * Load financial model — the client's reference waterfall.
 *
 *   Description        Amount
 *   Shipper Cost       $2,000.00
 *   Broker (18%)       -$360.00
 *   Dispatch (5%)      -$100.00
 *   Carrier Pay        $1,540.00
 *
 * Rules (FR-MGN-01..04):
 *   Shipper Cost is the revenue billed to the shipper (entered per load).
 *   Broker margin   = round(Shipper Cost * broker %).
 *   Dispatch margin = round(Shipper Cost * dispatch %).
 *   Carrier Pay     = Shipper Cost - Broker margin - Dispatch margin. It is
 *                     ALWAYS recomputed here, never stored, so it can never
 *                     go stale — it reconciles by construction.
 *
 * This is the ONE place the formula lives; every view (admin, dispatcher,
 * broker) and every server action computes through `computeLoadFinancials`.
 * Money is integer CENTS; percentages are decimals in [0, 1] (0.18 == 18%),
 * matching the rest of `src/lib/pricing`. Pure and free of Next/Supabase
 * imports so it runs under `npm run test:offline`.
 */

export interface LoadMarginConfig {
  /** Broker margin as a decimal, e.g. 0.18 for 18%. */
  brokerPercent: number;
  /** Dispatch margin as a decimal, e.g. 0.05 for 5%. */
  dispatchPercent: number;
}

/** Platform default when no org / customer / load value is set (FR-MGN-04). */
export const DEFAULT_LOAD_MARGIN_CONFIG: LoadMarginConfig = {
  brokerPercent: 0.18,
  dispatchPercent: 0.05,
};

export interface LoadFinancials {
  shipperCostCents: number;
  brokerPercent: number;
  brokerMarginCents: number;
  dispatchPercent: number;
  dispatchMarginCents: number;
  carrierPayCents: number;
}

export interface MarginValidation {
  ok: boolean;
  error?: string;
}

/**
 * FR-MGN-03: percentages must each be in [0, 100]% and together not exceed
 * 100% (otherwise Carrier Pay would go negative). Expressed on the decimal
 * [0, 1] scale the rest of the module uses.
 */
export function validateMarginPercents(brokerPercent: number, dispatchPercent: number): MarginValidation {
  for (const [name, v] of [
    ['Broker %', brokerPercent],
    ['Dispatch %', dispatchPercent],
  ] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      return { ok: false, error: `${name} must be between 0 and 100.` };
    }
  }
  if (brokerPercent + dispatchPercent > 1) {
    return { ok: false, error: 'Broker % and Dispatch % together cannot exceed 100%.' };
  }
  return { ok: true };
}

/** FR-MGN-03: Shipper Cost must be a positive integer number of cents. */
export function validateShipperCostCents(shipperCostCents: number): MarginValidation {
  if (!Number.isInteger(shipperCostCents) || shipperCostCents <= 0) {
    return { ok: false, error: 'Shipper Cost must be a positive amount.' };
  }
  return { ok: true };
}

/** Combined guard used by every server action before it stores or computes. */
export function validateMarginInputs(input: {
  shipperCostCents: number;
  brokerPercent: number;
  dispatchPercent: number;
}): MarginValidation {
  const cost = validateShipperCostCents(input.shipperCostCents);
  if (!cost.ok) return cost;
  return validateMarginPercents(input.brokerPercent, input.dispatchPercent);
}

/**
 * FR-MGN-01/02: compute the full waterfall from Shipper Cost + the two
 * percentages. Throws on invalid input (mirrors `computePricing`) — callers
 * that surface friendly errors should call `validateMarginInputs` first.
 */
export function computeLoadFinancials(input: {
  shipperCostCents: number;
  brokerPercent: number;
  dispatchPercent: number;
}): LoadFinancials {
  const check = validateMarginInputs(input);
  if (!check.ok) throw new RangeError(check.error);

  const { shipperCostCents, brokerPercent, dispatchPercent } = input;
  const brokerMarginCents = Math.round(shipperCostCents * brokerPercent);
  const dispatchMarginCents = Math.round(shipperCostCents * dispatchPercent);
  // Reconciles by construction — Carrier Pay is the remainder, never stored.
  const carrierPayCents = shipperCostCents - brokerMarginCents - dispatchMarginCents;

  return {
    shipperCostCents,
    brokerPercent,
    brokerMarginCents,
    dispatchPercent,
    dispatchMarginCents,
    carrierPayCents,
  };
}

function firstPercent(...candidates: (number | null | undefined)[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return undefined;
}

/**
 * FR-MGN-04: resolve the effective percentages with the fallback chain
 * load override → customer (shipper) default → org house default → platform
 * default, INDEPENDENTLY per field (a load may override only the broker %, say,
 * and still inherit the dispatch % from its customer).
 */
export function resolveMarginPercents(sources: {
  load?: { brokerPercent?: number | null; dispatchPercent?: number | null } | null;
  customer?: { brokerPercent?: number | null; dispatchPercent?: number | null } | null;
  orgDefault?: LoadMarginConfig | null;
  systemDefault?: LoadMarginConfig;
}): LoadMarginConfig {
  const system = sources.systemDefault ?? DEFAULT_LOAD_MARGIN_CONFIG;
  return {
    brokerPercent:
      firstPercent(
        sources.load?.brokerPercent,
        sources.customer?.brokerPercent,
        sources.orgDefault?.brokerPercent,
        system.brokerPercent,
      ) ?? system.brokerPercent,
    dispatchPercent:
      firstPercent(
        sources.load?.dispatchPercent,
        sources.customer?.dispatchPercent,
        sources.orgDefault?.dispatchPercent,
        system.dispatchPercent,
      ) ?? system.dispatchPercent,
  };
}
