import { PrismaClient, RoleType, Cadre, PpcRule } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Composite unique with null departmentId fails in Prisma 6 — use manual ensure
async function ensureRole(userId: string, role: RoleType, assignedBy: string, departmentId: string | null = null) {
  const existing = await prisma.userRole.findFirst({ where: { userId, role, departmentId } });
  if (existing) return existing;
  return prisma.userRole.create({ data: { userId, role, departmentId, assignedBy } });
}

// Seed passwords. Overridable so a real install never has to accept the values
// committed here, which the campus hosting agreement forbids relying on. The
// historical defaults are kept as the fallback on purpose: the test suites and
// the dev scripts log in with them, and swapping them for random values would
// make every DB-backed suite self-skip and report a false green.
//
// Set these before seeding anything that is not a throwaway development box:
//   SEED_ADMIN_PW=... SEED_HOD_PW=... SEED_FACULTY_PW=... npm run seed
//
// `||`, not `??`: a variable handed through empty (`-e SEED_ADMIN_PW=` or a
// blank compose `${VAR}`) arrives as "", which `??` would hash as the password.
const SEED_ADMIN_PW = process.env.SEED_ADMIN_PW || 'admin123';
const SEED_HOD_PW = process.env.SEED_HOD_PW || 'hod123';
const SEED_FACULTY_PW = process.env.SEED_FACULTY_PW || 'faculty123';

// Employee codes this seed owns. Anything else in the users table came from a
// real CSV import.
const SEED_CODES = [
  'ADMIN001',
  'HOD001', 'HOD002', 'HOD003',
  ...[1, 2, 3].flatMap((d) => [1, 2, 3, 4, 5].map((f) => `FAC${d * 10 + f}`)),
];

/**
 * Refuse to seed over a database that already holds imported accounts.
 *
 * The seed itself only upserts with `update: {}`, so it will not overwrite an
 * existing user. What it *does* do on a live database is recreate the sample
 * HOD001-003 accounts and grant them HOD roles over real departments, which
 * puts fake heads of department alongside the real ones. Pass --force if that
 * is genuinely what you want.
 */
async function assertSafeToSeed(force: boolean) {
  const imported = await prisma.user.count({ where: { employeeCode: { notIn: SEED_CODES } } });
  if (imported === 0) return;

  if (force) {
    console.warn(`[seed] --force: seeding over a database with ${imported} imported user(s).`);
    return;
  }

  console.error(`
BLOCKED: this database already holds ${imported} user(s) that this seed does not own.

  Seeding here would recreate the sample HOD001-003 accounts and assign them
  HoD roles over the real departments, alongside the real heads of department.

  The seed is meant for a fresh, empty database.
  If you are certain, re-run with:  npm run seed -- --force
`);
  process.exit(1);
}

async function main() {
  await assertSafeToSeed(process.argv.includes('--force'));
  console.log('Seeding...');

  const [cse, ece, eee] = await Promise.all([
    prisma.department.upsert({ where: { code: 'CSE' }, create: { name: 'Computer Science & Engineering', code: 'CSE' }, update: {} }),
    prisma.department.upsert({ where: { code: 'ECE' }, create: { name: 'Electronics & Communication Engineering', code: 'ECE' }, update: {} }),
    prisma.department.upsert({ where: { code: 'EEE' }, create: { name: 'Electrical & Electronics Engineering', code: 'EEE' }, update: {} }),
  ]);

  const year = await prisma.academicYear.upsert({
    where: { label: '2025-26' },
    create: {
      label: '2025-26',
      startDate: new Date('2025-06-01'),
      endDate: new Date('2026-05-31'),
      submissionOpen: true,
    },
    // Deliberately empty: re-seeding must never reopen a year that the admin
    // has closed, and must never add a second open year alongside the current
    // one (an extra open year silently widens the quarterly mass-email scope).
    update: {},
  });

  // W1 — FAPA AY2025-26 cadre eligibility targets (admin-editable later)
  const cadreTargets = [
    { cadre: Cadre.ASSISTANT_PROFESSOR, minExpYears: 0, maxExpYears: 3, totalScoreTarget: 325, feedbackTarget: 3.5, indexedCount: 2, minJournal: 0, quartileSet: null, ppcRule: PpcRule.DESIRABLE, ppcCount: 1 },
    { cadre: Cadre.ASSISTANT_PROFESSOR, minExpYears: 3, maxExpYears: null, totalScoreTarget: 350, feedbackTarget: 3.5, indexedCount: 2, minJournal: 1, quartileSet: null, ppcRule: PpcRule.DESIRABLE, ppcCount: 1 },
    { cadre: Cadre.SR_ASSISTANT_PROFESSOR, minExpYears: 0, maxExpYears: null, totalScoreTarget: 350, feedbackTarget: 3.5, indexedCount: 3, minJournal: 2, quartileSet: null, ppcRule: PpcRule.MANDATORY, ppcCount: 1 },
    { cadre: Cadre.ASSOCIATE_PROFESSOR, minExpYears: 0, maxExpYears: null, totalScoreTarget: 375, feedbackTarget: 3.5, indexedCount: 3, minJournal: 2, quartileSet: 'Q1-Q4', ppcRule: PpcRule.MANDATORY, ppcCount: 2 },
    { cadre: Cadre.PROFESSOR, minExpYears: 0, maxExpYears: null, totalScoreTarget: 375, feedbackTarget: 3.5, indexedCount: 3, minJournal: 2, quartileSet: 'Q1-Q3', ppcRule: PpcRule.MANDATORY, ppcCount: 2 },
  ];
  for (const t of cadreTargets) {
    await prisma.cadreTarget.upsert({
      where: { academicYearId_cadre_minExpYears: { academicYearId: year.id, cadre: t.cadre, minExpYears: t.minExpYears } },
      create: { academicYearId: year.id, ...t },
      update: { ...t },
    });
  }

  const hash = (pw: string) => bcrypt.hash(pw, 12);

  // Admin
  const adminHash = await hash(SEED_ADMIN_PW);
  const admin = await prisma.user.upsert({
    where: { employeeCode: 'ADMIN001' },
    create: { employeeCode: 'ADMIN001', name: 'System Admin', email: 'admin@college.edu', passwordHash: adminHash },
    update: {},
  });
  await ensureRole(admin.id, RoleType.ADMIN, admin.id, null);

  // HODs
  const hodHash = await hash(SEED_HOD_PW);
  const hods = [
    { code: 'HOD001', name: 'Dr. Rajesh Kumar', email: 'hod.cse@college.edu', dept: cse },
    { code: 'HOD002', name: 'Dr. Sunita Verma', email: 'hod.ece@college.edu', dept: ece },
    { code: 'HOD003', name: 'Dr. Amit Sharma', email: 'hod.eee@college.edu', dept: eee },
  ];

  for (const h of hods) {
    const hod = await prisma.user.upsert({
      where: { employeeCode: h.code },
      create: { employeeCode: h.code, name: h.name, email: h.email, passwordHash: hodHash, departmentId: h.dept.id, designation: 'Associate Professor' },
      update: {},
    });
    await ensureRole(hod.id, RoleType.FACULTY, admin.id, null);
    await ensureRole(hod.id, RoleType.HOD, admin.id, h.dept.id);
  }

  // Faculty
  const facHash = await hash(SEED_FACULTY_PW);
  const depts = [cse, ece, eee];
  for (let di = 0; di < depts.length; di++) {
    const d = depts[di];
    for (let fi = 1; fi <= 5; fi++) {
      const code = `FAC${(di + 1) * 10 + fi}`;
      const fac = await prisma.user.upsert({
        where: { employeeCode: code },
        create: {
          employeeCode: code,
          name: `Faculty ${code}`,
          email: `${code.toLowerCase()}@college.edu`,
          passwordHash: facHash,
          departmentId: d.id,
          designation: 'Assistant Professor',
        },
        update: {},
      });
      await ensureRole(fac.id, RoleType.FACULTY, admin.id, null);

      // Reviewers are assigned within their own department only — departments
      // are isolated. Cross-department review is the dean's, exercised through
      // the final-review layer, not through a standing role. The first two CSE
      // faculty used to be seeded as reviewers for ECE, which the API now
      // rejects outright.
      if (di === 0 && fi <= 2) {
        await ensureRole(fac.id, RoleType.REVIEWER, admin.id, d.id);
      }
    }
  }

  console.log('Seed complete!');
  const shown = (v: string, envName: string) => (process.env[envName] ? '(from ' + envName + ')' : v);
  console.log('Admin: ADMIN001 /', shown(SEED_ADMIN_PW, 'SEED_ADMIN_PW'));
  console.log('HoD CSE: HOD001 /', shown(SEED_HOD_PW, 'SEED_HOD_PW'));
  console.log('HoD ECE: HOD002 /', shown(SEED_HOD_PW, 'SEED_HOD_PW'));
  console.log('Faculty CSE: FAC11-FAC15 /', shown(SEED_FACULTY_PW, 'SEED_FACULTY_PW'));
  console.log('Faculty ECE: FAC21-FAC25 /', shown(SEED_FACULTY_PW, 'SEED_FACULTY_PW'));
  console.log('Faculty EEE: FAC31-FAC35 /', shown(SEED_FACULTY_PW, 'SEED_FACULTY_PW'));
  console.log('');
  console.log('Set SEED_ADMIN_PW / SEED_HOD_PW / SEED_FACULTY_PW to avoid the committed defaults.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
