import { z } from "zod";

export const toolNames = [
  "ticket.create",
  "notification.send",
  "customer.create",
  "customer.export",
  "customer.delete",
  "model.complete",
] as const;

export type ToolName = (typeof toolNames)[number];

const uuid = z.string().uuid();

export const toolSchemas: Record<ToolName, z.ZodTypeAny> = {
  "ticket.create": z.object({
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().max(4000).optional(),
  }),
  "notification.send": z.object({
    title: z.string().trim().min(1).max(140),
    body: z.string().trim().min(1).max(2000),
    user_id: uuid.optional(),
  }),
  "customer.create": z.object({
    name: z.string().trim().min(1).max(140),
    email: z.string().trim().email().max(200).optional(),
  }),
  "customer.export": z.object({}).strict(),
  "customer.delete": z.object({ customer_id: uuid }),
  "model.complete": z.object({ prompt: z.string().trim().min(1).max(2000) }),
};

export const toolCatalog: {
  name: ToolName;
  group: string;
  sensitivity: "standard" | "sensitive";
  description: string;
}[] = [
  { name: "ticket.create", group: "workspace", sensitivity: "standard", description: "Create a ticket in this organization." },
  { name: "notification.send", group: "workspace", sensitivity: "standard", description: "Send an in-app notification to a member." },
  { name: "customer.create", group: "customers", sensitivity: "standard", description: "Add a customer record." },
  { name: "customer.export", group: "customers", sensitivity: "sensitive", description: "Export this organization's customers." },
  { name: "customer.delete", group: "customers", sensitivity: "sensitive", description: "Soft-delete one customer." },
  { name: "model.complete", group: "models", sensitivity: "sensitive", description: "Call a model when OPENAI_API_KEY is configured." },
];

export function parseTool(name: string, args: unknown) {
  if (!toolNames.includes(name as ToolName)) return { ok: false as const, code: "unknown_tool" as const };
  const parsed = toolSchemas[name as ToolName].safeParse(args ?? {});
  if (!parsed.success) return { ok: false as const, code: "invalid_arguments" as const };
  const meta = toolCatalog.find((tool) => tool.name === name)!;
  return { ok: true as const, name: name as ToolName, args: parsed.data as Record<string, unknown>, sensitivity: meta.sensitivity };
}
