import { Shell } from "@/components/shell";
import { visibleNav } from "@/lib/nav";
import { requireOrg } from "@/server/context";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const items = visibleNav(ctx.can).map((item) => ({ href: item.href, label: item.label }));
  return (
    <Shell slug={ctx.slug} orgName={ctx.orgName} role={ctx.role} demo={ctx.demo} items={items}>
      {children}
    </Shell>
  );
}
