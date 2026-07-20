import { NextResponse } from 'next/server';

/** Liveness probe. No auth; no data access. */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'mc-global-tms',
    phase: 1,
    milestones: ['1-foundation', '2-auth-tenancy-rbac-audit'],
    time: new Date().toISOString(),
  });
}
