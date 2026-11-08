import { runAudit } from "@/lib/audit";
import { parseTarget } from "@/lib/target";
import { auditQueue } from "@/lib/queue";
import { PayError, consumeOrder, getOrder, refundOrder } from "@/lib/payments";
import { createWatch } from "@/lib/watch";
import { getGhSession } from "@/lib/session";
import { clientIp, rateLimited } from "@/lib/ratelimit";
import type { AuditEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  let body: { target?: string; orderId?: string; guard?: { hours?: number; intervalMin?: number } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const targetRaw = String(body.target ?? "").trim().slice(0, 2000);
  if (!targetRaw) return Response.json({ error: "Missing target" }, { status: 400 });
  let target;
  try {
    target = parseTarget(targetRaw);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }

  // Paid priority credit, or the free tier's rate limit.
  const orderId = body.orderId ? String(body.orderId) : undefined;
  let paid = false;
  if (orderId) {
    try {
      const o = getOrder(orderId);
      if (!o) return Response.json({ error: "Order not found." }, { status: 404 });
      if (o.tier !== "priority") return Response.json({ error: "Deep swarm orders are started with the Deep swarm button." }, { status: 400 });
      consumeOrder(orderId, "priority", targetRaw);
      paid = true;
    } catch (e: any) {
      if (e instanceof PayError) return Response.json({ error: e.message }, { status: e.status });
      return Response.json({ error: `Payments unavailable: ${e.message}` }, { status: 500 });
    }
  } else if (rateLimited(`audit:${ip}`, 6, 10 * 60_000)) {
    return Response.json({ error: "Rate limit reached. Try again in a few minutes, or use Priority." }, { status: 429 });
  }

  const needsGh = target.kind === "github" || (target.kind === "project" && !!target.project?.repo);
  const githubToken = needsGh ? (await getGhSession().catch(() => null))?.token : undefined;
  const guard = body.guard && target.kind !== "sample" ? body.guard : undefined;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (e: AuditEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      const log = (message: string, level: "info" | "warn" = "info") => emit({ type: "log", level, message, t: 0 });

      let lastPos = 0;
      const ticket = auditQueue().enqueue(paid, (pos) => {
        if (pos !== lastPos) {
          lastPos = pos;
          log(`Queued: position ${pos}${paid ? " (priority)" : ""}. ${pos > 1 ? `${pos - 1} scan(s) ahead.` : "You're next."}`);
        }
      });
      req.signal.addEventListener("abort", () => ticket.cancel());

      let release: (() => void) | undefined;
      try {
        release = await ticket.ready;
      } catch {
        if (paid && orderId) refundOrder(orderId);
        open = false;
        try { controller.close(); } catch { /* already closed */ }
        return;
      }

      let produced = false;
      try {
        const res = await runAudit(
          targetRaw,
          (e) => {
            if (e.type === "report") produced = true;
            emit(e);
          },
          { tier: paid ? "priority" : undefined, githubToken }
        );
        if (guard) {
          if (res.isPrivate) {
            log("Night Shift watching is not available for private repos yet (it would require storing your GitHub token). This was a one-time scan.", "warn");
          } else if (rateLimited(`watch:${ip}`, 3, 24 * 3600_000)) {
            log("Night Shift limit reached (3 per 24h). The scan above still completed.", "warn");
          } else {
            try {
              const w = createWatch(targetRaw, Number(guard.hours) || 10, Number(guard.intervalMin) || 60, { baseline: { report: res.report, hash: res.reportHash } });
              emit({ type: "guard", watchId: w.id, key: w.secret, expiresAt: w.expiresAt, t: 0 });
            } catch (e: any) {
              log(`Night Shift could not start: ${e.message}`, "warn");
            }
          }
        }
      } catch (e: any) {
        emit({ type: "error", message: e?.message ?? "Audit failed", t: 0 });
        if (paid && orderId && !produced) {
          refundOrder(orderId);
          log("The scan failed before producing a report. Your payment credit was returned.");
        }
      } finally {
        release?.();
        open = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
