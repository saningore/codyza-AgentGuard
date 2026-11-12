import { changePassword, revokeSession, updateAccount } from "@/server/auth-actions";
import { StateForm } from "@/components/state-form";
import { requireUser } from "@/server/context";
import { sql } from "@/server/db";

export default async function AccountPage() {
  const session = await requireUser();
  const profile = await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${session.userId}, true)`;
    const users = await tx<{ name: string; timezone: string; email_alerts: boolean }[]>`
      select name, timezone, email_alerts from users where id = ${session.userId}
    `;
    const sessions = await tx<{ id: string; created_at: Date; revoked_at: Date | null }[]>`
      select * from app.my_sessions(${session.userId}::uuid)
    `;
    return { user: users[0], sessions };
  });
  return (
    <main id="main" className="mx-auto grid max-w-xl gap-4 px-4 py-12">
      <h1 className="font-serif text-4xl">Account</h1>
      <p className="text-sm">{session.email}</p>
      <div className="card">
        <StateForm action={updateAccount} submit="Save account">
          <label className="field">Name<input name="name" defaultValue={profile.user?.name ?? session.name} required /></label>
          <label className="field">Timezone<input name="timezone" defaultValue={profile.user?.timezone ?? "America/Chicago"} /></label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="email_alerts" defaultChecked={profile.user?.email_alerts} /> Email alerts when mail is configured
          </label>
        </StateForm>
      </div>
      <div className="card">
        <h2 className="font-serif text-2xl">Password</h2>
        <StateForm action={changePassword} submit="Change password">
          <label className="field">Current password<input name="current" type="password" required /></label>
          <label className="field">New password<input name="next" type="password" minLength={12} required /></label>
        </StateForm>
      </div>
      <section className="card">
        <h2 className="font-serif text-2xl">Sessions</h2>
        <ul className="mt-3 grid gap-2 text-sm">
          {profile.sessions.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span>{new Date(item.created_at).toLocaleString()}{item.revoked_at ? " · revoked" : ""}</span>
              {!item.revoked_at ? (
                <form action={revokeSession}>
                  <input type="hidden" name="session_id" value={item.id} />
                  <button className="btn-secondary" type="submit">Revoke</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
