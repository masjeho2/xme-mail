import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@x-me.cloud";
  const password = process.env.ADMIN_PASSWORD || "changeme-xme-admin";
  const domainName = process.env.DEFAULT_DOMAIN || "x-me.cloud";

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: {
      email,
      name: "Admin",
      passwordHash,
      role: "admin",
    },
  });

  const domain = await prisma.domain.upsert({
    where: { name: domainName },
    update: { active: true },
    create: { name: domainName, active: true },
  });

  await prisma.alias.upsert({
    where: {
      localPart_domainId: {
        localPart: "admin",
        domainId: domain.id,
      },
    },
    update: { active: true, canSend: true },
    create: {
      localPart: "admin",
      domainId: domain.id,
      forwardTo: email,
      canSend: true,
      active: true,
    },
  });

  await prisma.alias.upsert({
    where: {
      localPart_domainId: {
        localPart: "noreply",
        domainId: domain.id,
      },
    },
    update: { active: true, canSend: true },
    create: {
      localPart: "noreply",
      domainId: domain.id,
      canSend: true,
      active: true,
    },
  });

  console.log("Seed OK");
  console.log(`  Admin: ${user.email}`);
  console.log(`  Domain: ${domain.name}`);
  console.log(`  Password: (from ADMIN_PASSWORD or default)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
