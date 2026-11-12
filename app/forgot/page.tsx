import Link from "next/link";
import { forgotPassword } from "@/server/auth-actions";
import { StateForm } from "@/components/state-form";

export default function ForgotPage() {
  return (
    <main id="main" className="mx-auto grid max-w-lg gap-6 px-4 py-12">
      <p className="text-sm"><Link className="font-bold text-copper" href="/">AgentGuard</Link></p>
      <h1 className="font-serif text-4xl">Forgot password</h1>
      <p className="text-sm text-ink/75">If the email belongs to an account, a single-use link is stored for 30 minutes. Mail is sent when Resend is configured.</p>
      <div className="card">
        <StateForm action={forgotPassword} submit="Send reset link">
          <label className="field">Email<input name="email" type="email" required /></label>
        </StateForm>
      </div>
      <p className="text-sm"><Link className="font-bold underline" href="/login">Back to sign in</Link></p>
    </main>
  );
}
