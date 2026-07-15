/**
 * Cloudflare Email Routing API helpers
 * Docs: https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export type CfRule = {
  id: string;
  name?: string;
  enabled: boolean;
  priority?: number;
  matchers: Array<{ type: string; field?: string; value?: string }>;
  actions: Array<{ type: string; value?: string[] }>;
};

function cfg() {
  const token = process.env.CLOUDFLARE_API_TOKEN || "";
  const zoneId = process.env.CLOUDFLARE_ZONE_ID || "";
  const worker = process.env.CLOUDFLARE_EMAIL_WORKER || "mail";
  const disableCatchAll = (process.env.CLOUDFLARE_DISABLE_CATCHALL || "true") === "true";
  return { token, zoneId, worker, disableCatchAll, enabled: Boolean(token && zoneId) };
}

async function cfFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T; errors: Array<{ message: string }> }> {
  const { token } = cfg();
  if (!token) {
    return { ok: false, status: 0, data: null as T, errors: [{ message: "CLOUDFLARE_API_TOKEN not set" }] };
  }

  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    result?: T;
    errors?: Array<{ message: string }>;
  };

  return {
    ok: res.ok && json.success !== false,
    status: res.status,
    data: (json.result as T) ?? (null as T),
    errors: json.errors || [],
  };
}

export function isCloudflareSyncEnabled() {
  return cfg().enabled;
}

export async function listEmailRules(): Promise<CfRule[]> {
  const { zoneId, enabled } = cfg();
  if (!enabled) return [];

  const all: CfRule[] = [];
  let page = 1;
  while (page <= 10) {
    const r = await cfFetch<CfRule[]>(
      `/zones/${zoneId}/email/routing/rules?page=${page}&per_page=50`
    );
    if (!r.ok || !r.data) break;
    const batch = Array.isArray(r.data) ? r.data : [];
    all.push(...batch);
    if (batch.length < 50) break;
    page++;
  }
  return all;
}

export async function findRuleForAddress(email: string): Promise<CfRule | null> {
  const target = email.toLowerCase();
  const rules = await listEmailRules();
  for (const rule of rules) {
    const isCatchAll = rule.matchers?.some((m) => m.type === "all");
    if (isCatchAll) continue;
    const match = rule.matchers?.some(
      (m) => m.type === "literal" && m.field === "to" && (m.value || "").toLowerCase() === target
    );
    if (match) return rule;
  }
  return null;
}

export async function createWorkerRule(email: string, name?: string) {
  const { zoneId, worker, enabled } = cfg();
  if (!enabled) {
    return { ok: false as const, skipped: true, error: "Cloudflare sync disabled" };
  }

  const existing = await findRuleForAddress(email);
  if (existing) {
    // Ensure enabled + points to worker
    if (!existing.enabled || existing.actions?.[0]?.type !== "worker") {
      const updated = await cfFetch<CfRule>(`/zones/${zoneId}/email/routing/rules/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: name || `xme:${email}`,
          enabled: true,
          matchers: [{ type: "literal", field: "to", value: email.toLowerCase() }],
          actions: [{ type: "worker", value: [worker] }],
        }),
      });
      if (!updated.ok) {
        return {
          ok: false as const,
          error: updated.errors.map((e) => e.message).join("; ") || "Failed to update rule",
        };
      }
      return { ok: true as const, ruleId: updated.data?.id || existing.id, existed: true };
    }
    return { ok: true as const, ruleId: existing.id, existed: true };
  }

  const created = await cfFetch<CfRule>(`/zones/${zoneId}/email/routing/rules`, {
    method: "POST",
    body: JSON.stringify({
      name: name || `xme:${email}`,
      enabled: true,
      matchers: [{ type: "literal", field: "to", value: email.toLowerCase() }],
      actions: [{ type: "worker", value: [worker] }],
    }),
  });

  if (!created.ok || !created.data?.id) {
    return {
      ok: false as const,
      error: created.errors.map((e) => e.message).join("; ") || "Failed to create rule",
    };
  }

  return { ok: true as const, ruleId: created.data.id, existed: false };
}

export async function deleteWorkerRule(opts: { ruleId?: string | null; email?: string }) {
  const { zoneId, enabled } = cfg();
  if (!enabled) {
    return { ok: true as const, skipped: true };
  }

  let ruleId = opts.ruleId || null;
  if (!ruleId && opts.email) {
    const found = await findRuleForAddress(opts.email);
    ruleId = found?.id || null;
  }
  if (!ruleId) {
    return { ok: true as const, missing: true };
  }

  const del = await cfFetch(`/zones/${zoneId}/email/routing/rules/${ruleId}`, {
    method: "DELETE",
  });

  if (!del.ok && del.status !== 404) {
    return {
      ok: false as const,
      error: del.errors.map((e) => e.message).join("; ") || "Failed to delete rule",
    };
  }

  return { ok: true as const, ruleId };
}

/** Disable catch-all so only explicit aliases receive mail */
export async function disableCatchAllRule() {
  const { zoneId, enabled, disableCatchAll } = cfg();
  if (!enabled || !disableCatchAll) {
    return { ok: true as const, skipped: true };
  }

  // Catch-all must use the dedicated endpoint (regular rule PUT returns "Invalid rule operation")
  // https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/
  const current = await cfFetch<CfRule>(`/zones/${zoneId}/email/routing/rules/catch_all`);
  if (!current.ok || !current.data) {
    return {
      ok: false as const,
      error: current.errors.map((e) => e.message).join("; ") || "Failed to load catch-all",
    };
  }

  if (!current.data.enabled) {
    return { ok: true as const, disabled: 0, alreadyDisabled: true };
  }

  const updated = await cfFetch<CfRule>(`/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: JSON.stringify({
      enabled: false,
      matchers: [{ type: "all" }],
      // keep a safe action while disabled
      actions: current.data.actions?.length
        ? current.data.actions
        : [{ type: "drop" }],
    }),
  });

  if (!updated.ok) {
    return {
      ok: false as const,
      error: updated.errors.map((e) => e.message).join("; ") || "Failed to disable catch-all",
    };
  }

  return { ok: true as const, disabled: 1, enabled: updated.data?.enabled === true };
}

export async function syncAliasToCloudflare(localPart: string, domainName: string) {
  const email = `${localPart.toLowerCase()}@${domainName.toLowerCase()}`;
  return createWorkerRule(email, `xme:${email}`);
}
