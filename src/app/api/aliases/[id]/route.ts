import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import {
  createWorkerRule,
  deleteWorkerRule,
  isCloudflareSyncEnabled,
} from "@/lib/cloudflare-email";
import { prisma } from "@/lib/db";
import { badRequest, json, notFound } from "@/lib/utils";

const patchSchema = z.object({
  forwardTo: z.string().email().nullable().optional(),
  isCatchAll: z.boolean().optional(),
  canSend: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload");

  const existing = await prisma.alias.findUnique({
    where: { id },
    include: { domain: true },
  });
  if (!existing) return notFound("Alias not found");

  let cfRuleId = existing.cfRuleId;
  const email = `${existing.localPart}@${existing.domain.name}`;
  const becomingActive = parsed.data.active === true;
  const becomingInactive = parsed.data.active === false;

  if (isCloudflareSyncEnabled()) {
    if (becomingInactive && existing.active) {
      const del = await deleteWorkerRule({ ruleId: existing.cfRuleId, email });
      if (!del.ok) return badRequest(`Cloudflare sync gagal: ${del.error}`);
      cfRuleId = null;
    }
    if (becomingActive && !existing.active) {
      const cf = await createWorkerRule(email, `xme:${email}`);
      if (!cf.ok) return badRequest(`Cloudflare sync gagal: ${cf.error}`);
      cfRuleId = cf.ruleId;
    }
  }

  const alias = await prisma.alias.update({
    where: { id },
    data: {
      ...parsed.data,
      cfRuleId,
    },
    include: { domain: true },
  });
  return json({ alias });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { id } = await ctx.params;
  const existing = await prisma.alias.findUnique({
    where: { id },
    include: { domain: true },
  });
  if (!existing) return notFound("Alias not found");

  const email = `${existing.localPart}@${existing.domain.name}`;

  if (isCloudflareSyncEnabled()) {
    const del = await deleteWorkerRule({ ruleId: existing.cfRuleId, email });
    if (!del.ok) {
      return badRequest(`Cloudflare sync gagal hapus rule: ${del.error}`);
    }
  }

  await prisma.alias.delete({ where: { id } });
  return json({ ok: true, cloudflare: { deleted: true, email } });
}
