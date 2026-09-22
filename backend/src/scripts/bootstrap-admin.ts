/**
 * Create the first ADMIN account on a fresh production database — and nothing
 * else.
 *
 * `npm run seed` is not usable here. It also creates HOD001-003 ("Dr. Rajesh
 * Kumar" and two more fictional heads of department) and fifteen FAC* accounts,
 * on passwords committed to this repository, over all three departments
 * including the two that are switched off. Its own guard does not stop that on
 * a fresh install: assertSafeToSeed only refuses once the table holds accounts
 * the seed does not own, and an empty database holds none.
 *
 * This script creates one user with one role. It writes nothing else: no
 * departments, no academic year, no cadre targets. Those belong to the DEAN and
 * the PRINCIPAL (utils/roles.ts, CONFIG), which is deliberate — the admin is a
 * maintenance account and holds no appraisal content. So the bootstrap runs:
 *
 *   1. this script                    → ADMIN001
 *   2. the admin, in the UI           → a PRINCIPAL (institute-wide, so it
 *                                       needs no department to exist yet)
 *   3. that principal, in the UI      → departments, academic year, cadre
 *                                       targets
 *   4. the admin, in the UI           → bulk-import the real faculty
 *
 * Usage, against the running stack:
 *
 *   docker compose -f docker-compose.prod.yml exec \
 *     -e ADMIN_PASSWORD='<chosen password>' \
 *     backend node dist/scripts/bootstrap-admin.js
 *
 * ADMIN_PASSWORD is required and has no default. The account is created with
 * mustChangePassword set, so whoever logs in first must replace it — the value
 * passed here survives in shell history and in the process list, and is treated
 * as compromised from the moment it is typed.
 *
 * Refuses to run if the users table is not empty. Recovering a lost admin
 * password on a populated database is a different job with different risks, and
 * this script will not be the thing that quietly adds a second one.
 */
import bcrypt from 'bcryptjs';
import { RoleType } from '@prisma/client';
import prisma from '../utils/prismaClient';

const EMPLOYEE_CODE = process.env.ADMIN_EMPLOYEE_CODE || 'ADMIN001';
const NAME = process.env.ADMIN_NAME || 'System Admin';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@vnrvjiet.in';
const PASSWORD = process.env.ADMIN_PASSWORD;

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!PASSWORD) {
    die('ADMIN_PASSWORD is not set. Pass it in the environment; there is no default.');
  }
  if (PASSWORD.length < 12) {
    die(`ADMIN_PASSWORD is ${PASSWORD.length} characters. This account can create every other account on an internet-facing host — use at least 12.`);
  }

  const existing = await prisma.user.count();
  if (existing > 0) {
    die(
      `The users table already holds ${existing} account(s), so this is not a fresh database.\n`
      + '  Refusing to add another admin. If the admin password was lost, reset that\n'
      + '  account deliberately rather than creating a second one here.',
    );
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // One transaction: a user with no role is an account that can log in and do
  // nothing, which is a confusing thing to leave behind if the second write
  // fails.
  const admin = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        employeeCode: EMPLOYEE_CODE,
        name: NAME,
        email: EMAIL,
        passwordHash,
        mustChangePassword: true,
      },
    });
    // assignedBy is the admin itself: nobody else exists yet to have granted it.
    await tx.userRole.create({
      data: { userId: user.id, role: RoleType.ADMIN, departmentId: null, assignedBy: user.id },
    });
    return user;
  });

  console.log(`\n  Created ${admin.employeeCode} (${admin.email}) with the ADMIN role.`);
  console.log('  It must change its password at first login.\n');
  console.log('  Next: log in as this account and create a PRINCIPAL, then use that');
  console.log('  principal to create the departments and the academic year.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
