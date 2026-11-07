import { payConfig } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(payConfig());
  } catch (err: any) {
    console.error("GET /api/pay/config error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
