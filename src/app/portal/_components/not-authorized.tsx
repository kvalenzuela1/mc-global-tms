/**
 * Shared "not authorized" panel for portal pages whose permission guard fails.
 * Pass `resource` for a page-specific line ("…access to customers."). Extracted
 * to remove the copy of this block that each page previously inlined; adopting
 * it across the remaining pages is a follow-up sweep.
 */
export function NotAuthorized({ resource }: { resource?: string }) {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">
        Your role does not include access{resource ? ` to ${resource}` : ''}.
      </p>
    </div>
  );
}
