import { executeAction } from "@/server/decision";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const result = await executeAction({
    authorization: request.headers.get("authorization"),
    idempotencyKey: request.headers.get("idempotency-key"),
    clientKey: forwarded || "local",
    body,
  });
  return Response.json(result.body, { status: result.status });
}
