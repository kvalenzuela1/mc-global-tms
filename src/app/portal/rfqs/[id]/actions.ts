'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { isValidEquipmentType } from '@/lib/rfqs/equipment';
import type { ActionResult } from '@/lib/actions/result';

/**
 * Set the demand-side freight attributes on an RFQ — the equipment/trailer type
 * it needs and the commodity being hauled. Lives in its own [id]/actions.ts
 * rather than the shared rfqs/actions.ts so it doesn't collide with the
 * in-flight RFQ-new-page work on that file. M3 pattern; gated on RFQ_CREATE
 * (the broker roles that own an RFQ), audited. Blank clears a field.
 */
export async function setRfqFreight(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const rfqId = String(formData.get('rfqId') ?? '');
  const rawEquipment = String(formData.get('equipmentType') ?? '').trim();
  const commodity = String(formData.get('commodity') ?? '').trim() || null;

  const { ctx } = await requirePermission(orgId, PERMISSIONS.RFQ_CREATE);
  if (!rfqId) return { ok: false, error: 'Missing RFQ.' };

  const equipmentType = rawEquipment === '' ? null : rawEquipment;
  if (equipmentType !== null && !isValidEquipmentType(equipmentType)) {
    return { ok: false, error: 'Unknown equipment type.' };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('rfqs')
    .update({ equipment_type: equipmentType, commodity })
    .eq('id', rfqId)
    .eq('org_id', orgId);
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.RFQ_UPDATED,
    entityType: 'rfq',
    entityId: rfqId,
    after: { equipmentType, commodity },
  });

  revalidatePath(`/portal/rfqs/${rfqId}`);
  return { ok: true };
}
