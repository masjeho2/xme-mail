import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import { createWorkerRule, isCloudflareSyncEnabled } from "@/lib/cloudflare-email";
import { prisma } from "@/lib/db";
import { badRequest, json } from "@/lib/utils";

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const domainId = searchParams.get("domainId") || undefined;

  const aliases = await prisma.alias.findMany({
    where: domainId ? { domainId } : undefined,
    include: { domain: true },
    orderBy: [{ domain: { name: "asc" } }, { localPart: "asc" }],
  });
  return json({
    aliases,
    cloudflareSync: isCloudflareSyncEnabled(),
  });
}

const createSchema = z.object({
  localPart: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._%+-]+$/i, "Invalid local part"),
  domainId: z.string().min(1),
  forwardTo: z.string().email().optional().nullable(),
  isCatchAll: z.boolean().optional(),
  canSend: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid alias", { details: parsed.error.flatten() });

  const domain = await prisma.domain.findUnique({ where: { id: parsed.data.domainId } });
  if (!domain) return badRequest("Domain not found");

  const localPart = parsed.data.localPart.toLowerCase();
  const email = `${localPart}@${domain.name}`;

  let cfRuleId: string | null = null;
  const cfWarning: string | null = null;

  if (isCloudflareSyncEnabled() && (parsed.data.active ?? true)) {
    const cf = await createWorkerRule(email, `xme:${email}`);
    if (!cf.ok) {
      return badRequest(`Cloudflare sync gagal: ${cf.error}`);
    }
    cfRuleId = cf.ruleId;
  }

  try {
    const alias = await prisma.alias.create({
      data: {
        localPart,
        domainId: domain.id,
        forwardTo: parsed.data.forwardTo || null,
        isCatchAll: parsed.data.isCatchAll ?? false,
        canSend: parsed.data.canSend ?? true,
        active: parsed.data.active ?? true,
        cfRuleId,
      },
      include: { domain: true },
    });
    return json(
      {
        alias,
        cloudflare: cfRuleId
          ? { synced: true, ruleId: cfRuleId }
          : { synced: false, warning: cfWarning || "CF sync off or inactive alias" },
      },
      201
    );
  } catch {
    // Rollback CF rule if DB unique failed after CF create
    return badRequest("Alias already exists on this domain");
  }
}
