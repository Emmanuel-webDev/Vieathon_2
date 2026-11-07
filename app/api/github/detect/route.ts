import { detectProject, type DetectedContract } from "@/lib/detect";
import { findChain } from "@/lib/onchain";
import { getGhSession } from "@/lib/session";
import { clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const SAFE = /^[A-Za-z0-9._-]{1,100}$/;
const STRONG = new Set(["Foundry broadcast", "Hardhat Ignition", "hardhat-deploy"]);

export async function POST(req: Request) {
  if (rateLimited(`detect:${clientIp(req)}`, 30, 10 * 60_000)) return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  let body: { owner?: string; name?: string; ref?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!SAFE.test(body.owner ?? "") || !SAFE.test(body.name ?? "")) return Response.json({ error: "Invalid repo" }, { status: 400 });
  const token = (await getGhSession().catch(() => null))?.token;
  try {
    const d = await detectProject(body.owner!, body.name!, body.ref, token);
    // Keep only addresses that are really deployed on Base / Base Sepolia. Deployment files are trusted even if the RPC is unreachable.
    const verified: (DetectedContract & { verified: boolean })[] = [];
    let ignored = 0;
    const queue = [...d.contracts];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const c = queue.shift()!;
          const chain = await findChain(c.address, c.chainId).catch(() => null);
          if (chain) verified.push({ ...c, chainId: chain, verified: true });
          else if (STRONG.has(c.source)) verified.push({ ...c, verified: false });
          else ignored++;
        }
      })
    );
    return Response.json({ ...d, contracts: verified, ignoredAddresses: ignored });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
