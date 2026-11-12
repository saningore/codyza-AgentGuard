import { signup } from "@/server/auth-actions";
import { StateForm } from "@/components/state-form";

export default function SignupPage() {
  return (
    <main id="main" className="mx-auto grid max-w-lg gap-6 px-4 py-12">
      <h1 className="font-serif text-4xl">Create an organization</h1>
      <div className="card">
        <StateForm action={signup} submit="Create and continue">
          <label className="field">Your name<input name="name" required /></label>
          <label className="field">Email<input name="email" type="email" required /></label>
          <label className="field">Organization<input name="organization" required /></label>
          <label className="field">Timezone<input name="timezone" defaultValue="America/Chicago" /></label>
          <label className="field">Password<input name="password" type="password" minLength={12} required /></label>
        </StateForm>
      </div>
    </main>
  );
}
