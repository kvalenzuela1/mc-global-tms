'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/actions/result';

/**
 * Thin wrapper around `useActionState` so every portal server action can
 * surface its `{ ok, error }` result inline — a plain `<form action={fn}>`
 * discards the return value, but the maker/checker pricing-override flow
 * needs its denial reasons (SELF_APPROVAL, REASON_TOO_SHORT, ...) visible.
 *
 * `children` must be plain JSX, not a render-prop function: this component
 * is rendered from Server Components, and functions can't cross the
 * Server/Client boundary as props. Use `SubmitButton` (which reads pending
 * state via `useFormStatus`) for a submit button that reacts to in-flight
 * submissions.
 */
export function ActionForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    (_prev, formData) => action(formData),
    null,
  );

  return (
    <form action={formAction} className={className}>
      {children}
      {state && !state.ok && (
        <p role="alert" className="text-sm text-danger mt-2">
          {state.error ?? 'Something went wrong.'}
        </p>
      )}
    </form>
  );
}
