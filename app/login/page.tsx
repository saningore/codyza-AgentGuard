import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSession } from "@/server/context";

export default async function LoginPage() {
  const session = await getSession();
  if (session?.scope === "full") redirect("/orgs");
  if (session?.scope === "enroll") redirect("/mfa");
  return (
    <main id="main" className="mx-auto grid max-w-lg gap-6 px-4 py-12">
      <div>
        <p className="text-sm font-bold text-copper">AgentGuard</p>
        <h1 className="font-serif text-4xl">Sign in</h1>
        <p className="mt-2 text-ink/75">Use the organization account you were given, or the sample accounts in the README.</p>
      </div>
      <div className="card"><LoginForm /></div>
      <p className="text-sm"><Link className="font-bold underline" href="/forgot">Forgot password</Link></p>
      <p className="text-sm">New organization? <Link className="font-bold underline" href="/signup">Create one</Link></p>
    </main>
  );
}
