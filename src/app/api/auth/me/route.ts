import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { json } from "@/lib/utils";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: session.userId! },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) return unauthorized();
  return json({ user });
}
