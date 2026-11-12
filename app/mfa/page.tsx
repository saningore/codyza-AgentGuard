"use client";

import { useActionState } from "react";
import { beginMfa, confirmMfa, logout } from "@/server/auth-actions";

export default function MfaPage() {
  const [secretState, secretAction, secretPending] = useActionState(beginMfa, { error: "" });
  const [state, action, pending] = useActionState(confirmMfa, { error: "" });
  return (
    <main id="main" className="mx-auto grid max-w-lg gap-6 px-4 py-12">
      <form action={logout}><button className="btn-secondary" type="submit">Log out</button></form>
      <h1 className="font-serif text-4xl">Authenticator</h1>
      <p className="text-sm">Owners and admins confirm a time-based code before they open a workspace.</p>
      <div className="card grid gap-4">
        <form action={secretAction}>
          <button className="btn-secondary" disabled={secretPending}>{secretPending ? "Creating…" : "Generate secret"}</button>
        </form>
        {secretState.notice ? <p className="break-all font-bold" role="status">Add this base32 secret to your authenticator: {secretState.notice}</p> : null}
        <form action={action} className="grid gap-3">
          <label className="field">Authentication code<input name="code" inputMode="numeric" required /></label>
          {state.error ? <p role="alert" className="text-sm font-bold text-clay">{state.error}</p> : null}
          {secretState.error ? <p role="alert" className="text-sm font-bold text-clay">{secretState.error}</p> : null}
          <button className="btn" disabled={pending}>Confirm code</button>
        </form>
      </div>
    </main>
  );
}
