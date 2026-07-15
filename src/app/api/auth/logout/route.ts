import { logout } from "@/lib/auth";
import { json } from "@/lib/utils";

export async function POST() {
  await logout();
  return json({ ok: true });
}
