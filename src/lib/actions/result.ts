/** Common return shape for portal server actions (see `_components/action-form.tsx`). */
export interface ActionResult {
  ok: boolean;
  error?: string;
}
