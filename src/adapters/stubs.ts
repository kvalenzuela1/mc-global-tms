/**
 * Disabled-by-design adapters for out-of-scope Phase 1 integrations.
 *
 * Requirement coverage:
 *   FR-ADP-TRACK-01    Tracking/telematics (GPS/ELD) — OUT OF SCOPE. Interface
 *                      only; internal check-calls are the source of truth.
 *   FR-ADP-FACTOR-01   Factoring — packet assembly ONLY. No money movement, no
 *                      factoring API execution in Phase 1.
 *   FR-ADP-BOARD-01    Load boards (DAT/Truckstop) — OUT OF SCOPE. Interface only.
 *   FR-ADP-VET-01      Carrier vetting (paid providers) — future adapter.
 *
 * Each throws or no-ops so an accidental Phase 1 call fails loudly rather than
 * silently moving money or hitting an unbudgeted paid API.
 */

export interface TrackingAdapter {
  readonly name: string;
  getLatestPosition(loadId: string): Promise<null>;
}
export class DisabledTrackingAdapter implements TrackingAdapter {
  readonly name = 'disabled';
  async getLatestPosition(): Promise<null> {
    return null; // Phase 1: internal check-calls only.
  }
}

export interface FactoringPacket {
  loadId: string;
  carrierNetCents: number;
  quickPayFeeCents: number;
  reference: string;
}
export interface FactoringAdapter {
  readonly name: string;
  /** Assemble a submission packet. NEVER transfers funds in Phase 1. */
  buildPacket(input: FactoringPacket): Promise<FactoringPacket>;
  submit(): Promise<never>;
}
export class NoopFactoringAdapter implements FactoringAdapter {
  readonly name = 'noop';
  async buildPacket(input: FactoringPacket): Promise<FactoringPacket> {
    return input; // packet only
  }
  async submit(): Promise<never> {
    // FR-ADP-FACTOR-01: hard stop — no money movement in Phase 1.
    throw new Error('FACTORING_DISABLED: money movement is out of scope in Phase 1.');
  }
}

export interface LoadBoardAdapter {
  readonly name: string;
  publish(): Promise<never>;
}
export class DisabledLoadBoardAdapter implements LoadBoardAdapter {
  readonly name = 'disabled';
  async publish(): Promise<never> {
    throw new Error('LOAD_BOARD_DISABLED: DAT/Truckstop sync is out of scope in Phase 1.');
  }
}

export interface CarrierVettingAdapter {
  readonly name: string;
  vet(dotNumber: string): Promise<{ dotNumber: string; provider: string; score: null }>;
}
export class NoopCarrierVettingAdapter implements CarrierVettingAdapter {
  readonly name = 'noop';
  async vet(dotNumber: string) {
    return { dotNumber, provider: 'noop', score: null };
  }
}

export const getTrackingAdapter = (): TrackingAdapter => new DisabledTrackingAdapter();
export const getFactoringAdapter = (): FactoringAdapter => new NoopFactoringAdapter();
export const getLoadBoardAdapter = (): LoadBoardAdapter => new DisabledLoadBoardAdapter();
export const getCarrierVettingAdapter = (): CarrierVettingAdapter =>
  new NoopCarrierVettingAdapter();
