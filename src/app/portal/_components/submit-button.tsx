'use client';

import { useFormStatus } from 'react-dom';

/**
 * `useFormStatus` only works in a Client Component that is itself a
 * descendant of the `<form>` — it can't be read in the Server Component that
 * renders the form. This is the standard place to put pending-aware submit
 * button UI in the App Router.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
