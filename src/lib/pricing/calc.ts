/**
 * Configurable pricing + Quick Pay / factoring calculator.
 *
 * Requirement coverage:
 *   FR-PR-01  shipper price = carrier linehaul / (1 - target margin %).
 *   FR-PR-02  Store margin dollars AND percent per quote/load.
 *   FR-PR-03  Quick Pay defaults to 5% of carrier rate but is CONFIGURABLE.
 *   FR-PR-04  Factoring cost is separate and configurable (never assume it
 *             equals the Quick Pay fee).
 *   FR-PR-05  No hardcoded values — every rate/percent is passed in from the
 *             versioned config resolver (platform -> org -> exception -> snapshot).
 *   FR-PR-06  Warn when Quick Pay fee < factoring cost (Operating Workflow).
 *
 * All money is handled in integer CENTS to avoid float drift. Percentages are
 * decimals in [0,1) (e.g. 0.18 == 18%). The functions are pure so they are unit
 * testable and reproducible from a stored commercial snapshot.
 */

export interface PricingConfig {
  /** Target freight margin as a decimal, e.g. 0.18 for 18%. */
  targetMarginPercent: number;
  /** Carrier Quick Pay fee as a decimal, default 0.05. */
  quickPayFeePercent: number;
  /** Partner factoring cost as a decimal, e.g. 0.03. Separate from Quick Pay. */
  factoringCostPercent: number;
}

export interface QuoteInput {
  /** Carrier linehaul (cost basis) in cents. */
  carrierLinehaulCents: number;
  config: PricingConfig;
}

export interface PricingResult {
  carrierLinehaulCents: number;
  shipperPriceCents: number;
  marginAmountCents: number;
  marginPercent: number; // realized margin against shipper price
  targetMarginPercent: number;
  quickPayFeePercent: number;
  quickPayFeeCents: number;
  quickPayNetCents: number; // carrier take-home after Quick Pay fee
  factoringCostPercent: number;
  factoringAdvanceCents: number;
  quickPaySpreadCents: number; // may be negative -> warning
  warnings: string[];
}

function assertPercent(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0 || v >= 1) {
    throw new RangeError(`${name} must be a decimal in [0, 1); got ${v}`);
  }
}

function assertCents(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new RangeError(`${name} must be a non-negative integer (cents); got ${v}`);
  }
}

/**
 * FR-PR-01..06: Compute the full commercial snapshot for a quote.
 * Rounding: shipper price and derived amounts use bankers-safe integer rounding
 * (Math.round on cents). The stored snapshot is the authoritative record.
 */
export function computePricing({ carrierLinehaulCents, config }: QuoteInput): PricingResult {
  assertCents('carrierLinehaulCents', carrierLinehaulCents);
  assertPercent('targetMarginPercent', config.targetMarginPercent);
  assertPercent('quickPayFeePercent', config.quickPayFeePercent);
  assertPercent('factoringCostPercent', config.factoringCostPercent);

  // FR-PR-01: shipper price = linehaul / (1 - margin)
  const shipperPriceCents = Math.round(
    carrierLinehaulCents / (1 - config.targetMarginPercent),
  );

  // FR-PR-02: margin dollars and realized percent
  const marginAmountCents = shipperPriceCents - carrierLinehaulCents;
  const marginPercent =
    shipperPriceCents === 0 ? 0 : marginAmountCents / shipperPriceCents;

  // FR-PR-03: Quick Pay fee on carrier rate
  const quickPayFeeCents = Math.round(
    carrierLinehaulCents * config.quickPayFeePercent,
  );
  const quickPayNetCents = carrierLinehaulCents - quickPayFeeCents;

  // FR-PR-04: factoring advance uses factoring cost (separate config)
  const factoringAdvanceCents = Math.round(
    carrierLinehaulCents * (1 - config.factoringCostPercent),
  );

  // Quick Pay spread = linehaul * (quickPayFee% - factoringCost%)
  const quickPaySpreadCents = Math.round(
    carrierLinehaulCents * (config.quickPayFeePercent - config.factoringCostPercent),
  );

  const warnings: string[] = [];
  // FR-PR-06: warn when Quick Pay fee is below factoring cost (negative spread)
  if (config.quickPayFeePercent < config.factoringCostPercent) {
    warnings.push(
      'QUICK_PAY_BELOW_FACTORING: Quick Pay fee is below factoring cost; ' +
        'spread is negative and requires approval.',
    );
  }

  return {
    carrierLinehaulCents,
    shipperPriceCents,
    marginAmountCents,
    marginPercent,
    targetMarginPercent: config.targetMarginPercent,
    quickPayFeePercent: config.quickPayFeePercent,
    quickPayFeeCents,
    quickPayNetCents,
    factoringCostPercent: config.factoringCostPercent,
    factoringAdvanceCents,
    quickPaySpreadCents,
    warnings,
  };
}

/** Phase 1 platform default policy. Overridden by org/exception config records. */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  targetMarginPercent: 0.18,
  quickPayFeePercent: 0.05, // FR-PR-03 default
  factoringCostPercent: 0.03,
};
