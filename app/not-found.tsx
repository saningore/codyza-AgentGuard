import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid max-w-lg gap-4 px-4 py-16">
      <h1 className="font-serif text-4xl">That page is not available</h1>
      <p>The record may belong to another organization, or the address is wrong.</p>
      <Link className="btn w-fit" href="/">Back to AgentGuard</Link>
    </main>
  );
}
