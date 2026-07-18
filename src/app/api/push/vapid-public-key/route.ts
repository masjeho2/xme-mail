import { requireSession, unauthorized } from "@/lib/auth";
import { getVapidPublicKey } from "@/lib/web-push";
import { json } from "@/lib/utils";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const key = getVapidPublicKey();
  if (!key) {
    return json({ error: "Web Push not configured (missing VAPID keys)" }, 503);
  }
  return json({ publicKey: key });
}
