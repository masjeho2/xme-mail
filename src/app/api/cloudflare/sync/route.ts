import { requireSession, unauthorized } from "@/lib/auth";
import {
  createWorkerRule,
  disableCatchAllRule,
  isCloudflareSyncEnabled,
  listEmailRules,
} from "@/lib/cloudflare-email";
import { prisma } from "@/lib/db";
import { json } from "@/lib/utils";

/** Sync all active aliases to CF + disable catch-all */
export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();

  if (!isCloudflareSyncEnabled()) {
    return json({ ok: false, error: "Cloudflare sync not configured" }, 400);
  }

  const catchAll = await disableCatchAllRule();

  const aliases = await prisma.alias.findMany({
    where: { active: true },
    include: { domain: true },
  });

  const results: Array<{ email: string; ok: boolean; ruleId?: string; error?: string }> = [];

  for (const a of aliases) {
    const email = `${a.localPart}@${a.domain.name}`;
    const cf = await createWorkerRule(email, `xme:${email}`);
    if (cf.ok) {
      await prisma.alias.update({
        where: { id: a.id },
        data: { cfRuleId: cf.ruleId },
      });
      results.push({ email, ok: true, ruleId: cf.ruleId });
    } else {
      results.push({ email, ok: false, error: cf.error });
    }
  }

  const rules = await listEmailRules();

  return json({
    ok: true,
    catchAll,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    results,
    cloudflareRules: rules.map((r) => ({
      id: r.id,
      enabled: r.enabled,
      matchers: r.matchers,
      actions: r.actions,
    })),
  });
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  return json({
    enabled: isCloudflareSyncEnabled(),
    worker: process.env.CLOUDFLARE_EMAIL_WORKER || "mail",
    zoneConfigured: Boolean(process.env.CLOUDFLARE_ZONE_ID),
  });
}
