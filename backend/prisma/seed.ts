/**
 * Idempotent seed: Super Admin (from env), languages (en + bg, bg default),
 * dummy tenant with an Admin and a Teacher (deterministic local-dev passwords).
 *
 * Run with: `npm run seed` (or `npx prisma db seed`).
 */
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 10;

const DEMO_TENANT_SLUG = 'demo-sports-club';
const DEMO_TENANT_NAME = 'Demo Sports Club';
const DEMO_ADMIN_EMAIL = 'admin@demo.pulsedesk.local';
const DEMO_ADMIN_PASSWORD = 'DemoAdmin!Pass1';
const DEMO_TEACHER_EMAIL = 'teacher@demo.pulsedesk.local';
const DEMO_TEACHER_PASSWORD = 'DemoTeacher!Pass1';

export interface SeedResult {
  superAdminEmail: string;
  demoTenantSlug: string;
  demoAdminEmail: string;
  demoTeacherEmail: string;
}

export async function seed(prisma: PrismaClient): Promise<SeedResult> {
  const superEmail = process.env.SUPERADMIN_EMAIL;
  const superPassword = process.env.SUPERADMIN_PASSWORD;
  if (!superEmail || !superPassword) {
    throw new Error('SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set in .env');
  }

  // Languages — bg as default, en as second.
  await prisma.language.upsert({
    where: { code: 'bg' },
    update: { name: 'Български', isDefault: true },
    create: { code: 'bg', name: 'Български', isDefault: true },
  });
  await prisma.language.upsert({
    where: { code: 'en' },
    update: { name: 'English', isDefault: false },
    create: { code: 'en', name: 'English', isDefault: false },
  });

  // Super Admin (no tenant).
  const existingSuper = await prisma.user.findFirst({
    where: { tenantId: null, email: superEmail, role: UserRole.SUPER_ADMIN },
  });
  if (!existingSuper) {
    await prisma.user.create({
      data: {
        email: superEmail,
        passwordHash: await bcrypt.hash(superPassword, BCRYPT_ROUNDS),
        role: UserRole.SUPER_ADMIN,
        tenantId: null,
        firstName: 'Super',
        lastName: 'Admin',
      },
    });
  }

  // Dummy tenant.
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    update: { name: DEMO_TENANT_NAME, isActive: true },
    create: { slug: DEMO_TENANT_SLUG, name: DEMO_TENANT_NAME, isActive: true },
  });

  // Demo Admin.
  await prisma.user.upsert({
    where: { email: DEMO_ADMIN_EMAIL },
    update: {},
    create: {
      email: DEMO_ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_ADMIN_PASSWORD, BCRYPT_ROUNDS),
      role: UserRole.ADMIN,
      tenantId: tenant.id,
      firstName: 'Demo',
      lastName: 'Admin',
    },
  });

  // Demo Teacher (Employee role).
  await prisma.user.upsert({
    where: { email: DEMO_TEACHER_EMAIL },
    update: {},
    create: {
      email: DEMO_TEACHER_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_TEACHER_PASSWORD, BCRYPT_ROUNDS),
      role: UserRole.EMPLOYEE,
      tenantId: tenant.id,
      firstName: 'Demo',
      lastName: 'Teacher',
    },
  });

  return {
    superAdminEmail: superEmail,
    demoTenantSlug: DEMO_TENANT_SLUG,
    demoAdminEmail: DEMO_ADMIN_EMAIL,
    demoTeacherEmail: DEMO_TEACHER_EMAIL,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await seed(prisma);
    /* eslint-disable no-console */
    console.log('\n✔ Seed complete.');
    console.log('  Super Admin:   ', result.superAdminEmail, '(password from SUPERADMIN_PASSWORD env)');
    console.log('  Demo tenant:   ', result.demoTenantSlug);
    console.log('  Demo Admin:    ', result.demoAdminEmail, '(demo password set; see prisma/seed.ts source)');
    console.log('  Demo Teacher:  ', result.demoTeacherEmail, '(demo password set; see prisma/seed.ts source)');
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
