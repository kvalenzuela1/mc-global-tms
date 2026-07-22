'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FilePlus2,
  Percent,
  Package,
  FileCheck2,
  ShieldCheck,
  Truck,
  FileText,
  ScrollText,
  BadgeCheck,
  type LucideIcon,
} from 'lucide-react';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import type { Role } from '@/lib/rbac/roles';

/**
 * Icon components can't cross the Server/Client boundary as plain props (only
 * rendered elements or serializable data can) — so the nav definition lives
 * here, not in the server layout, and this component does its own permission
 * filtering. `can()` has no Next/Supabase imports, so it's safe client-side;
 * every route still re-checks permission server-side regardless (FR-RBAC-05).
 */
type NavPerm = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const NAV: { href: string; label: string; perm: NavPerm | NavPerm[] | null; icon: LucideIcon }[] = [
  { href: '/portal', label: 'Overview', perm: null, icon: LayoutDashboard },
  { href: '/portal/rfqs', label: 'RFQs & Quotes', perm: [PERMISSIONS.RFQ_VIEW, PERMISSIONS.RFQ_CREATE], icon: FilePlus2 },
  { href: '/portal/pricing', label: 'Margin Calculator', perm: PERMISSIONS.PRICING_VIEW, icon: Percent },
  { href: '/portal/loads', label: 'Loads', perm: [PERMISSIONS.LOAD_VIEW, PERMISSIONS.SHIPPER_TRACK], icon: Package },
  { href: '/portal/ratecons', label: 'Rate Confirmations', perm: PERMISSIONS.RATECON_VIEW, icon: FileCheck2 },
  { href: '/portal/carriers', label: 'Carrier Compliance', perm: PERMISSIONS.CARRIER_VIEW, icon: ShieldCheck },
  { href: '/portal/driver', label: 'Driver Brief', perm: PERMISSIONS.DRIVER_BRIEF_VIEW, icon: Truck },
  { href: '/portal/documents', label: 'Documents', perm: [PERMISSIONS.DOCUMENT_VIEW, PERMISSIONS.DOCUMENT_UPLOAD], icon: FileText },
  { href: '/portal/approvals', label: 'Approvals', perm: [PERMISSIONS.PRICING_OVERRIDE_APPROVE, PERMISSIONS.COMPLIANCE_OVERRIDE], icon: BadgeCheck },
  { href: '/portal/audit', label: 'Audit Trail', perm: PERMISSIONS.AUDIT_VIEW, icon: ScrollText },
];

/**
 * Deliberately absent, and NOT to be re-added until the route exists:
 *
 *   /portal/invoices  INVOICE_CREATE   — M6
 *   /portal/admin     ADMIN_CONFIG     — M7
 *
 * Both were in this list with no page behind them, so every org_admin saw
 * sidebar entries that 404'd. A nav entry is a promise the route exists;
 * `can()` returning true for the permission is not the same thing. /portal/audit
 * graduated out of this list once its page was built (see portal/audit).
 */

export function PortalNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = NAV.filter((n) => {
    if (n.perm === null) return true;
    return Array.isArray(n.perm) ? n.perm.some((p) => can(role, p)) : can(role, n.perm);
  });

  return (
    <nav className="mt-6 space-y-1">
      {visible.map((n) => {
        const active = n.href === '/portal' ? pathname === n.href : pathname.startsWith(n.href);
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm border-l-2 transition-colors ${
              active
                ? 'bg-charcoal-800 border-copper-500 text-ink font-medium'
                : 'border-transparent text-muted hover:bg-charcoal-700 hover:text-ink'
            }`}
          >
            <Icon size={16} strokeWidth={2} className="shrink-0" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
