import Link from "next/link";
import { resetPassword } from "@/server/auth-actions";
import { StateForm } from "@/components/state-form";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main id="main" className="mx-auto grid max-w-lg gap-6 px-4 py-12">
      <p className="text-sm"><Link className="font-bold text-copper" href="/">AgentGuard</Link></p>
      <h1 className="font-serif text-4xl">Choose a new password</h1>
      <div className="card">
        <StateForm action={resetPassword} submit="Update password">
          <input type="hidden" name="token" value={token} />
          <label className="field">New password<input name="password" type="password" minLength={12} required /></label>
        </StateForm>
      </div>
      <p className="text-sm"><Link className="font-bold underline" href="/login">Back to sign in</Link></p>
    </main>
  );
}
