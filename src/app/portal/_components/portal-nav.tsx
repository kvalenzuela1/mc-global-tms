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
  DollarSign,
  Settings,
  ScrollText,
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
const NAV: { href: string; label: string; perm: (typeof PERMISSIONS)[keyof typeof PERMISSIONS] | null; icon: LucideIcon }[] = [
  { href: '/portal', label: 'Overview', perm: null, icon: LayoutDashboard },
  { href: '/portal/rfqs', label: 'RFQs & Quotes', perm: PERMISSIONS.RFQ_VIEW, icon: FilePlus2 },
  { href: '/portal/pricing', label: 'Margin Calculator', perm: PERMISSIONS.PRICING_VIEW, icon: Percent },
  { href: '/portal/loads', label: 'Loads', perm: PERMISSIONS.LOAD_VIEW, icon: Package },
  { href: '/portal/ratecons', label: 'Rate Confirmations', perm: PERMISSIONS.RATECON_VIEW, icon: FileCheck2 },
  { href: '/portal/carriers', label: 'Carrier Compliance', perm: PERMISSIONS.CARRIER_VIEW, icon: ShieldCheck },
  { href: '/portal/driver', label: 'Driver Brief', perm: PERMISSIONS.DRIVER_BRIEF_VIEW, icon: Truck },
  { href: '/portal/documents', label: 'Documents', perm: PERMISSIONS.DOCUMENT_VIEW, icon: FileText },
  { href: '/portal/invoices', label: 'Invoices & Settlement', perm: PERMISSIONS.INVOICE_CREATE, icon: DollarSign },
  { href: '/portal/admin', label: 'Admin Settings', perm: PERMISSIONS.ADMIN_CONFIG, icon: Settings },
  { href: '/portal/audit', label: 'Audit Log', perm: PERMISSIONS.AUDIT_VIEW, icon: ScrollText },
];

export function PortalNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = NAV.filter((n) => n.perm === null || can(role, n.perm));

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
