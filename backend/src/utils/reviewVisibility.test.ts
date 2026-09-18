import { describe, it, expect } from 'vitest';
import { RoleType } from '@prisma/client';
import {
  isOwnerView,
  stripReviewerAssessment,
  canSeeReviewerAssessment,
  REVIEWER_ASSESSMENT_FIELDS,
} from './reviewVisibility';
import { renderAppraisalHtml } from '../services/pdfService';

const OWNER = 'user-owner';
const roles = (...rs: RoleType[]) => rs.map((role) => ({ role }));

describe('isOwnerView', () => {
  it('is true for a plain faculty looking at their own appraisal', () => {
    expect(isOwnerView({ id: OWNER, roles: [] }, OWNER)).toBe(true);
  });

  it('is true for a HoD looking at their OWN appraisal', () => {
    // Every HoD files one. This is the case a role-only check got wrong.
    expect(isOwnerView({ id: OWNER, roles: roles(RoleType.HOD) }, OWNER)).toBe(true);
  });

  it('is true for a reviewer/incharge looking at their own', () => {
    expect(isOwnerView({ id: OWNER, roles: roles(RoleType.REVIEWER) }, OWNER)).toBe(true);
  });

  it('is true for an admin looking at their own', () => {
    expect(isOwnerView({ id: OWNER, roles: roles(RoleType.ADMIN) }, OWNER)).toBe(true);
  });

  it('is false for any privileged role looking at someone else', () => {
    for (const r of [
      RoleType.HOD,
      RoleType.REVIEWER,
      RoleType.ADMIN,
      RoleType.PRINCIPAL,
      RoleType.DEAN,
      RoleType.SCRUTINIZER,
      RoleType.SPECIAL_SCRUTINIZER,
    ]) {
      expect(isOwnerView({ id: 'staff', roles: roles(r) }, OWNER)).toBe(false);
    }
  });

  it('is true for a roleless caller looking at someone else', () => {
    // They should not reach the resource at all; if they do, they get the
    // restricted view rather than the reviewer's assessment.
    expect(isOwnerView({ id: 'nobody', roles: [] }, OWNER)).toBe(true);
  });
});

describe('canSeeReviewerAssessment — the Cat 6 / grand-total gate', () => {
  const DEPT = 'dept-cse';
  const OTHER = 'dept-ece';
  const at = (role: RoleType, departmentId: string | null = null) => ({ role, departmentId });

  it('the owner never sees it, whatever else they hold', () => {
    for (const r of [RoleType.HOD, RoleType.REVIEWER, RoleType.PRINCIPAL, RoleType.DEAN]) {
      expect(canSeeReviewerAssessment({ id: OWNER, roles: [at(r, DEPT)] }, OWNER, DEPT)).toBe(false);
    }
  });

  it('the principal sees it in every department', () => {
    const principal = { id: 'p', roles: [at(RoleType.PRINCIPAL)] };
    expect(canSeeReviewerAssessment(principal, OWNER, DEPT)).toBe(true);
    expect(canSeeReviewerAssessment(principal, OWNER, OTHER)).toBe(true);
    expect(canSeeReviewerAssessment(principal, OWNER, null)).toBe(true);
  });

  it('the HoD and incharge see it in their own department only', () => {
    expect(canSeeReviewerAssessment({ id: 'h', roles: [at(RoleType.HOD, DEPT)] }, OWNER, DEPT)).toBe(true);
    expect(canSeeReviewerAssessment({ id: 'r', roles: [at(RoleType.REVIEWER, DEPT)] }, OWNER, DEPT)).toBe(true);
    expect(canSeeReviewerAssessment({ id: 'h', roles: [at(RoleType.HOD, OTHER)] }, OWNER, DEPT)).toBe(false);
  });

  it('the dean, the scrutinizers and the admin never see it', () => {
    for (const r of [RoleType.DEAN, RoleType.SCRUTINIZER, RoleType.SPECIAL_SCRUTINIZER, RoleType.ADMIN]) {
      expect(canSeeReviewerAssessment({ id: 'x', roles: [at(r)] }, OWNER, DEPT)).toBe(false);
    }
  });

  it('null departments do not match', () => {
    expect(canSeeReviewerAssessment({ id: 'h', roles: [at(RoleType.HOD, null)] }, OWNER, null)).toBe(false);
  });
});

describe('stripReviewerAssessment', () => {
  const review: any = {
    cat1Score: 120, cat2Score: 90, cat3Score: 70, cat4Score: 40, cat5Score: 30,
    totalScore: 350, grandTotal: 392,
    cat6Punctuality: 9, cat6Professionalism: 8, cat6Willingness: 9, cat6Cordiality: 8, cat6Classroom: 8,
    overallComment: 'Solid year.', status: 'APPROVED',
  };

  it('removes Category 6 and the grand total', () => {
    const out: any = stripReviewerAssessment(review);
    for (const f of REVIEWER_ASSESSMENT_FIELDS) expect(out[f]).toBeUndefined();
  });

  it('keeps the categories 1-5 marks, the /500 total and the comments', () => {
    const out: any = stripReviewerAssessment(review);
    expect(out.cat1Score).toBe(120);
    expect(out.cat5Score).toBe(30);
    expect(out.totalScore).toBe(350);
    expect(out.overallComment).toBe('Solid year.');
  });

  it('does not mutate the review it was given', () => {
    stripReviewerAssessment(review);
    expect(review.grandTotal).toBe(392);
    expect(review.cat6Punctuality).toBe(9);
  });

  it('passes null through', () => {
    expect(stripReviewerAssessment(null)).toBeNull();
  });
});

describe('appraisal PDF respects the same split', () => {
  const sub: any = {
    academicYear: { label: '2026-27' }, submissionNumber: 1, status: 'APPROVED',
    user: { name: 'Test Faculty', employeeCode: 'FAC99', designation: 'Assistant Professor', department: { name: 'CSE' }, email: 'f@x.edu' },
    cat1Courses: [], cat1CourseResults: [], cat1Projects: [], cat1EContent: [], cat1ICT: [],
    cat2Journals: [], cat2Conferences: [], cat2ConfBookChapters: [], cat2BookChapters: [], cat2Books: [],
    cat2Citations: null, cat2Patents: [], cat2Projects: [], cat2Consultancy: [], cat2Guidance: [],
    cat2ResearchGroups: [], cat2Linkages: [], cat2Startups: [], cat2IndustryLinkages: [],
    cat3AdvQual: null, cat3Organised: [], cat3ConferencesAttended: [], cat3ResourcePerson: [],
    cat3Editorial: [], cat3Training: [], cat3IntlTravel: [], cat4AdminResp: [], cat4StudentAct: [],
    cat5Memberships: [], cat5Awards: [], cat5Differentiators: [], cat5Internships: [],
  };
  const score: any = {
    cat1: { total: 0 }, cat2: { total: 0 }, cat3: { total: 0 }, cat4: { total: 0 }, cat5: { total: 0 },
    selfTotal: 350,
  };
  const review: any = {
    cat1Score: 120, cat2Score: 90, cat3Score: 70, cat4Score: 40, cat5Score: 30,
    totalScore: 350, grandTotal: 392,
    cat6Punctuality: 9, cat6Professionalism: 8, cat6Willingness: 9, cat6Cordiality: 8, cat6Classroom: 8,
    status: 'APPROVED',
  };

  it("prints Category 6 and the grand total in a reviewer's copy", () => {
    const html = renderAppraisalHtml(sub, score, review);
    expect(html).toMatch(/Cat 6 Total/);
    expect(html).toContain('550');
    expect(html).toContain('392.0');
  });

  it("prints neither in the owner's copy", () => {
    // A zeroed Cat 6 block would be just as much of a disclosure as a filled
    // one — the section must not render at all.
    const html = renderAppraisalHtml(sub, score, stripReviewerAssessment(review));
    expect(html).not.toMatch(/Cat 6/i);
    expect(html).not.toMatch(/Core Values/i);
    expect(html).not.toContain('550');
    expect(html).not.toMatch(/GRAND TOTAL/i);
  });

  it("still shows the owner their own total out of 500", () => {
    const html = renderAppraisalHtml(sub, score, stripReviewerAssessment(review));
    expect(html).toContain('350.0');
    expect(html).toContain('/ 500');
  });
});
