export const NAV = [
  { href: "", label: "Overview", permission: null },
  { href: "/agents", label: "Agents", permission: "agent.read" },
  { href: "/approvals", label: "Approvals", permission: "approval.decide" },
  { href: "/activity", label: "Activity", permission: "activity.read" },
  { href: "/failures", label: "Failures", permission: "activity.read" },
  { href: "/analytics", label: "Analytics", permission: "analytics.read" },
  { href: "/search", label: "Search", permission: "activity.read" },
  { href: "/customers", label: "Customers", permission: "customer.read" },
  { href: "/tickets", label: "Tickets", permission: "activity.read" },
  { href: "/notifications", label: "Alerts", permission: null },
  { href: "/members", label: "Members", permission: "member.manage" },
  { href: "/limits", label: "Limits", permission: "org.manage" },
  { href: "/policy-cases", label: "Policy cases", permission: "policy.manage" },
  { href: "/audit", label: "Audit", permission: "audit.read" },
  { href: "/settings", label: "Settings", permission: "org.manage" },
] as const;

export function visibleNav(can: (permission: string) => boolean) {
  return NAV.filter((item) => item.permission == null || can(item.permission));
}
