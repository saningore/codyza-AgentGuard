import { acceptInvite } from "@/server/auth-actions";
import { StateForm } from "@/components/state-form";
import { sql } from "@/server/db";
import { hashSecret, pepper } from "@/lib/tokens";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rows = await sql<{ email: string; expired: boolean; role: string; organization_name: string }[]>`
    select * from app.peek_invite(${hashSecret(token, pepper("SESSION_PEPPER"))})
  `;
  const invite = rows[0];
  return (
    <main id="main" className="mx-auto grid max-w-lg gap-6 px-4 py-12">
      <h1 className="font-serif text-4xl">Join {invite && !invite.expired ? invite.organization_name : "an organization"}</h1>
      {invite && !invite.expired ? <p className="text-sm">You are invited as {invite.role}.</p> : <p role="alert">This invite is invalid or expired.</p>}
      <div className="card">
        <StateForm action={acceptInvite} submit="Accept invite">
          <input type="hidden" name="token" value={token} />
          <label className="field">Name<input name="name" /></label>
          <label className="field">Password<input name="password" type="password" required /></label>
        </StateForm>
      </div>
    </main>
  );
}
