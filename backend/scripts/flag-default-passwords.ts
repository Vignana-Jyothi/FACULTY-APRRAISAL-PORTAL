/**
 * Backfill User.mustChangePassword for accounts still on the shared default
 * import password.
 *
 * The flag is set on import and admin-create from now on, but the 73 faculty
 * imported before it existed default to false. This finds every ACTIVE user
 * whose password hash still matches DEFAULT_IMPORT_PASSWORD (read from
 * utils/defaultPassword.ts, exactly as the import does — so set
 * DEFAULT_IMPORT_PASSWORD the same way the backend has it) and flags them.
 *
 * Nothing else changes: passwords, sessions and tokenVersion are left alone.
 * Flagged users can still sign in; they just have to change the password first.
 *
 * Defaults to a dry run that only reports who would be flagged. Writing needs
 * the target database named explicitly, as in wipe-except-admin.ts:
 *
 *   npx tsx scripts/flag-default-passwords.ts                       # dry run
 *   npx tsx scripts/flag-default-passwords.ts --confirm=<dbname>    # set the flag
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_IMPORT_PASSWORD } from '../src/utils/defaultPassword';

const prisma = new PrismaClient();

// Database name from DATABASE_URL — the caller must repeat it to confirm.
function targetDbName(): string {
  const url = process.env.DATABASE_URL ?? '';
  return url.split('/').pop()?.split('?')[0] ?? '';
}

async function main() {
  const db = targetDbName();
  const confirmArg = process.argv.find((a) => a.startsWith('--confirm='))?.split('=')[1];
  if (confirmArg && confirmArg !== db) {
    console.error(`Refusing to write: --confirm=${confirmArg} does not match the target database "${db}".`);
    process.exit(1);
  }
  const write = confirmArg === db && db !== '';

  // Deliberately does not select or filter on mustChangePassword, so the dry run
  // works even before the column has been pushed.
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, employeeCode: true, passwordHash: true },
    orderBy: { employeeCode: 'asc' },
  });

  const matches: { id: string; employeeCode: string }[] = [];
  for (const u of users) {
    // bcrypt cost 12 is ~0.2s per compare; ~100 users is well under a minute.
    if (await bcrypt.compare(DEFAULT_IMPORT_PASSWORD, u.passwordHash)) {
      matches.push({ id: u.id, employeeCode: u.employeeCode });
    }
  }

  console.log(`
Database:                 "${db}"
Active users checked:     ${users.length}
Still on default password: ${matches.length}
${matches.map((m) => `  ${m.employeeCode}`).join('\n')}
`);

  if (!write) {
    console.log(`DRY RUN — nothing was written.
To flag them:  npx tsx scripts/flag-default-passwords.ts --confirm=${db}
`);
    return;
  }

  if (matches.length === 0) {
    console.log('Nothing to flag.');
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: { in: matches.map((m) => m.id) } },
      data: { mustChangePassword: true },
    });
    await tx.auditLog.createMany({
      data: matches.map((m) => ({
        userId: m.id,
        action: 'PASSWORD_CHANGE_FORCED',
        entityType: 'User',
        entityId: m.id,
        metadata: { reason: 'default import password', by: 'scripts/flag-default-passwords.ts' },
      })),
    });
    return updated.count;
  });

  console.log(`Flagged ${result} user(s): they must change their password at next sign-in.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
