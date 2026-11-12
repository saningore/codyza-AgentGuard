"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/forms";

export function StateForm({
  action,
  submit,
  children,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submit: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const secret = state.notice?.startsWith("ag_") ? state.notice : null;
  return (
    <form action={formAction} className="grid gap-3">
      {children}
      {state.error ? <p role="alert" className="text-sm font-bold text-clay">{state.error}</p> : null}
      {secret ? (
        <p role="status" className="break-all rounded-xl bg-mist p-3 text-sm">
          Copy this token now. It will not be shown again.
          <span className="mt-2 block font-bold">{secret}</span>
        </p>
      ) : state.notice ? (
        <p role="status" className="break-all text-sm font-semibold">{state.notice}</p>
      ) : null}
      <button className="btn" disabled={pending}>{pending ? "Saving…" : submit}</button>
    </form>
  );
}
