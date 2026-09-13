import request from 'supertest';
import bcrypt from 'bcryptjs';
import { RoleType } from '@prisma/client';
import app from '../../app';
import prisma from '../../utils/prismaClient';

/**
 * Throwaway users and departments for suites that need to write.
 *
 * These suites run against the real dev database. Borrowing a seed account is
 * how `integration.test.ts` once deleted a live draft, and how
 * `facultyScoreVisibility.test.ts` left an APPROVED submission on FAC11 when a
 * run aborted. A suite that writes must own its subject, and must be able to
 * remove everything it made.
 *
 * Only CSE is active in this database, so a suite needing a department creates
 * one rather than looking for a second — an earlier isolation test looked, found
 * none, returned early and passed while asserting nothing.
 */

export const FIXTURE_PW = 'Fixture@123';

export interface FixtureUser {
  id: string;
  employeeCode: string;
  name: string;
  token: string;
}

export interface Fixture {
  deptId: string;
  users: FixtureUser[];
  /** Register a submission created outside `createSubmission` for cleanup. */
  track(submissionId: string): void;
  addUser(opts: AddUserOpts): Promise<FixtureUser>;
  /** A second department, for cross-department cases. Torn down with the rest. */
  addDepartment(tag: string): Promise<string>;
  createSubmission(owner: FixtureUser, data?: Record<string, any>): Promise<string>;
  destroy(): Promise<void>;
}

export interface AddUserOpts {
  /** Short suffix, e.g. 'FAC' or 'HOD'. Combined with the fixture's tag. */
  name: string;
  role?: RoleType;
  designation?: string;
  dateOfJoining?: Date;
  /** Put this user in a different department (for cross-department cases). */
  deptId?: string;
}

let counter = 0;

/** A department nobody else uses, plus the machinery to tear it all down. */
export async function createFixture(tag: string): Promise<Fixture> {
  const stamp = `${Date.now() % 100000}${counter++}`;
  const dept = await prisma.department.create({
    data: { name: `${tag} Fixture Dept ${stamp}`, code: `${tag}${stamp}`.slice(0, 12), isActive: true },
  });

  const users: FixtureUser[] = [];
  const submissionIds: string[] = [];
  const extraDeptIds: string[] = [];
  const passwordHash = await bcrypt.hash(FIXTURE_PW, 10);

  const fixture: Fixture = {
    deptId: dept.id,
    users,

    track(submissionId: string) {
      submissionIds.push(submissionId);
    },

    async addUser(opts: AddUserOpts): Promise<FixtureUser> {
      const employeeCode = `${tag}${opts.name}${stamp}`.slice(0, 24);
      const user = await prisma.user.create({
        data: {
          employeeCode,
          name: `${tag} ${opts.name}`,
          // A reserved, undeliverable domain (RFC 2606): the running backend's
          // mail worker polls every 30s and skips these rather than sending.
          email: `${employeeCode.toLowerCase()}@fixture.invalid`,
          passwordHash,
          departmentId: opts.deptId ?? dept.id,
          designation: opts.designation ?? 'Assistant Professor',
          dateOfJoining: opts.dateOfJoining ?? new Date('2018-07-01'),
        },
      });
      if (opts.role) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            role: opts.role,
            // A HoD or reviewer role is only valid in the user's own department.
            departmentId: opts.deptId ?? dept.id,
            assignedBy: user.id,
          },
        });
      }
      const res = await request(app)
        .post('/api/auth/login')
        .send({ employeeCode, password: FIXTURE_PW });
      const entry: FixtureUser = {
        id: user.id,
        employeeCode,
        name: user.name,
        token: res.status === 200 ? res.body.accessToken : '',
      };
      users.push(entry);
      return entry;
    },

    async addDepartment(otherTag: string): Promise<string> {
      const extra = await prisma.department.create({
        data: {
          name: `${otherTag} Fixture Dept ${stamp}${counter++}`,
          code: `${otherTag}${stamp}${counter}`.slice(0, 12),
          isActive: true,
        },
      });
      extraDeptIds.push(extra.id);
      return extra.id;
    },

    async createSubmission(owner: FixtureUser, data: Record<string, any> = {}): Promise<string> {
      const year = await prisma.academicYear.findFirstOrThrow({ where: { submissionOpen: true } });
      const sub = await prisma.appraisalSubmission.create({
        data: {
          userId: owner.id,
          academicYearId: year.id,
          submissionNumber: submissionIds.length + 1,
          ...data,
        },
      });
      submissionIds.push(sub.id);
      return sub.id;
    },

    async destroy() {
      if (submissionIds.length) {
        await prisma.finalReview.deleteMany({ where: { submissionId: { in: submissionIds } } });
        await prisma.feedback.deleteMany({ where: { submissionId: { in: submissionIds } } });
        await prisma.proofVerification.deleteMany({ where: { submissionId: { in: submissionIds } } });
        await prisma.appraisalReview.deleteMany({ where: { submissionId: { in: submissionIds } } });
        await prisma.auditLog.deleteMany({ where: { entityId: { in: submissionIds } } });
        await prisma.appraisalSubmission.deleteMany({ where: { id: { in: submissionIds } } });
      }
      for (const u of users) {
        // Reviews this user gave on other submissions, and rows that point back
        // at them, must go before the user itself.
        await prisma.finalReview.deleteMany({ where: { reviewerId: u.id } });
        await prisma.appraisalReview.deleteMany({ where: { reviewerId: u.id } });
        await prisma.appraisalSubmission.deleteMany({ where: { userId: u.id } });
        await prisma.auditLog.deleteMany({ where: { userId: u.id } }); // RESTRICT
        // Rows another actor wrote ABOUT this user (entityId is a plain string,
        // so nothing else removes them).
        await prisma.auditLog.deleteMany({ where: { entityType: 'User', entityId: u.id } });
        await prisma.emailNotification.deleteMany({ where: { toUserId: u.id } });
        await prisma.passwordOtp.deleteMany({ where: { userId: u.id } });
        // No foreign key to User, so these would outlive the user as orphans.
        await prisma.facultyTier.deleteMany({ where: { userId: u.id } });
        // ROLE_ASSIGNED / ROLE_REVOKED rows point at the UserRole, not the
        // user, and are written by the admin — nothing above removes them, and
        // every run used to leave one behind.
        const roleIds = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { id: true } })).map((r) => r.id);
        if (roleIds.length) {
          await prisma.auditLog.deleteMany({ where: { entityType: 'UserRole', entityId: { in: roleIds } } });
        }
        await prisma.userRole.deleteMany({ where: { userId: u.id } });
        await prisma.user.deleteMany({ where: { id: u.id } });
      }
      for (const id of [...extraDeptIds, dept.id]) {
        await prisma.userRole.deleteMany({ where: { departmentId: id } });
        await prisma.department.deleteMany({ where: { id } });
      }
    },
  };

  return fixture;
}
