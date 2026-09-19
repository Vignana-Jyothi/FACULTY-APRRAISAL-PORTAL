import { Request, Response } from 'express';
import path from 'path';
import { z } from 'zod';
import { RoleType, SubmissionStatus } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { canViewUserResource } from '../utils/access';
import { DEPT_REVIEW, SEES_ALL, deptIdsFor, hasAnyRole } from '../utils/roles';
import { syncProofVerifications, enumerateProofs, PROOF_INCLUDE, PROOF_SOURCES } from '../services/proofService';
import { enqueueEmail } from '../services/emailService';
import { proofRejectedKey, holdClearedKey } from '../services/emailKeys';

// How long a faculty has to replace a rejected proof before the daily job
// voids the marks for that source and lets the appraisal move on. Calendar
// days, from the first rejection on the submission.
export const PROOF_CORRECTION_DAYS = 14;

export function proofDeadlineFrom(heldAt: Date): Date {
  const d = new Date(heldAt);
  d.setDate(d.getDate() + PROOF_CORRECTION_DAYS);
  return d;
}

// Who may CHANGE a proof's approve/reject status: the principal, or the HoD or
// incharge (REVIEWER) of the faculty's department — never the owner.
// The admin held this from 2026-09-11 until the 2026-09-18 role rework moved
// appraisal content off the maintenance account.
function canVerifyProof(user: NonNullable<Request['user']>, ownerId: string, ownerDept: string | null): boolean {
  if (user.id === ownerId) return false;
  if (hasAnyRole(user, SEES_ALL)) return true;
  return user.roles.some(
    (r) => (r.role === RoleType.HOD || r.role === RoleType.REVIEWER) && r.departmentId != null && r.departmentId === ownerDept
  );
}

// Proofs are checked on the draft during the year and through the review, up
// to the decision (owner decision 2026-09-19 — the draft carries across the
// year). A DRAFT is still the faculty's to edit, so rejecting a proof there
// only marks the proof and asks the faculty to replace it: no HOLD, no red
// list, no correction deadline. Those apply once the appraisal is submitted.
// A decided appraisal (APPROVED / REJECTED / WITHDRAWN) is reopened first
// rather than changed from here.
export const PROOF_REVIEW_STATUSES: SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.UNDER_REVIEW,
  SubmissionStatus.HOLD,
  SubmissionStatus.FINAL_REVIEW,
];
export const PROOF_CHECK_STATUSES: SubmissionStatus[] = [SubmissionStatus.DRAFT, ...PROOF_REVIEW_STATUSES];

// Who may manage the red-list / clear a hold: the HoD or incharge of the
// faculty's own department, or the principal institute-wide.
function canManage(user: NonNullable<Request['user']>, ownerId: string, ownerDept: string | null): boolean {
  if (user.id === ownerId) return false;
  if (hasAnyRole(user, SEES_ALL)) return true;
  return user.roles.some(
    (r) => (r.role === RoleType.HOD || r.role === RoleType.REVIEWER) && r.departmentId != null && r.departmentId === ownerDept
  );
}

function summarize(rows: { status: string }[]) {
  const verified = rows.filter((r) => r.status === 'VERIFIED').length;
  const rejected = rows.filter((r) => r.status === 'REJECTED').length;
  const pending = rows.filter((r) => r.status === 'PENDING').length;
  return { total: rows.length, verified, rejected, pending, allVerified: rows.length > 0 ? verified === rows.length : true };
}

// GET /appraisals/:id/proofs — section-mapped proof list + verification state.
export async function listProofs(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, employeeCode: true, departmentId: true, department: { select: { name: true, code: true } } } },
      academicYear: { select: { label: true } },
    },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!canViewUserResource(req.user!, sub.userId, sub.user.departmentId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const rows = await syncProofVerifications(sub.id);
  return res.json({
    submission: {
      id: sub.id,
      status: sub.status,
      redListed: sub.redListed,
      holdReason: sub.holdReason,
      heldAt: sub.heldAt,
      proofDeadlineAt: sub.proofDeadlineAt,
      voidedSources: sub.voidedSources,
      submissionNumber: sub.submissionNumber,
      year: sub.academicYear.label,
      faculty: { id: sub.user.id, name: sub.user.name, employeeCode: sub.user.employeeCode, department: sub.user.department },
    },
    proofs: rows,
    summary: summarize(rows),
  });
}

const verifySchema = z.object({
  url: z.string().min(1),
  status: z.enum(['VERIFIED', 'REJECTED']),
  comment: z.string().optional(),
});

// POST /appraisals/:id/proofs/verify — mark one proof verified/rejected.
// On a submitted appraisal, reject puts it on HOLD and red-lists the faculty.
// On a DRAFT, reject marks the proof and emails the faculty — nothing else.
export async function verifyProof(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, employeeCode: true, departmentId: true } },
      academicYear: { select: { label: true } },
    },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!canVerifyProof(req.user!, sub.userId, sub.user.departmentId)) {
    return res.status(403).json({ error: 'Only the HoD or incharge can verify uploads' });
  }
  if (!PROOF_CHECK_STATUSES.includes(sub.status)) {
    return res.status(400).json({
      error: `Proofs are checked on the draft and until the appraisal is decided — this one is ${sub.status}`,
    });
  }
  const isDraft = sub.status === SubmissionStatus.DRAFT;

  const { url, status, comment } = verifySchema.parse(req.body);

  // Sync so the target proof row exists and reflects the current form.
  await syncProofVerifications(sub.id);
  const pv = await prisma.proofVerification.findUnique({
    where: { submissionId_url: { submissionId: sub.id, url } },
  });
  if (!pv) return res.status(404).json({ error: 'Proof not found on this submission' });

  await prisma.$transaction(async (tx) => {
    await tx.proofVerification.update({
      where: { id: pv.id },
      data: { status, verifiedById: req.user!.id, verifiedAt: new Date(), comment: comment ?? null },
    });
    if (status === 'REJECTED' && !isDraft) {
      await tx.appraisalSubmission.update({
        where: { id: sub.id },
        data: {
          status: SubmissionStatus.HOLD,
          redListed: true,
          heldAt: new Date(),
          holdReason: `Rejected proof — ${pv.section}: ${pv.item}${comment ? ` (${comment})` : ''}`,
          // Clock starts on the first rejection and is not reset by later ones,
          // so a faculty cannot extend their own window by collecting rejections.
          proofDeadlineAt: sub.proofDeadlineAt ?? proofDeadlineFrom(new Date()),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: `PROOF_${status}`,
        entityType: 'ProofVerification',
        entityId: pv.id,
        metadata: { submissionId: sub.id, url, onDraft: isDraft },
      },
    });
  });

  // Notify on reject — faculty (must re-upload) + dept HoD(s) (red list). A
  // draft is not held or red-listed, so only the faculty hears about it.
  if (status === 'REJECTED') {
    try {
      const base = {
        year: sub.academicYear.label,
        submissionNumber: sub.submissionNumber,
        submissionId: sub.id,
        section: pv.section,
        item: pv.item,
        field: pv.field,
        comment: comment ?? '',
      };
      await enqueueEmail({
        toUserId: sub.userId,
        template: 'proof_rejected',
        payload: { name: sub.user.name, ...base, draft: isDraft },
        dedupeKey: proofRejectedKey(pv.id, url),
      });
      const hods = isDraft ? [] : await prisma.userRole.findMany({
        where: { role: 'HOD', isActive: true, departmentId: sub.user.departmentId ?? undefined },
        select: { userId: true },
      });
      for (const h of hods) {
        if (h.userId === req.user!.id) continue; // rejecter is the HoD — no self-notice
        const hod = await prisma.user.findUnique({ where: { id: h.userId }, select: { name: true } });
        await enqueueEmail({
          toUserId: h.userId,
          template: 'proof_rejected_hod',
          payload: { name: hod?.name ?? 'HoD', facultyName: sub.user.name, employeeCode: sub.user.employeeCode, ...base },
          dedupeKey: proofRejectedKey(pv.id, url, h.userId),
        });
      }
    } catch (e) {
      console.error('[email] enqueue proof reject failed:', e);
    }
  }

  return res.json({ message: `Proof ${status.toLowerCase()}` });
}

// Prisma model behind each proof source (PROOF_SOURCES keys are relation names).
const SOURCE_MODEL: Record<string, string> = {
  cat1EContent: 'cat1EContent', cat1ICT: 'cat1ICT',
  cat2Journals: 'cat2Journal', cat2Conferences: 'cat2Conference', cat2ConfBookChapters: 'cat2ConfBookChapter',
  cat2BookChapters: 'cat2BookChapter', cat2Books: 'cat2Book', cat2Patents: 'cat2Patent', cat2Projects: 'cat2Project',
  cat2Consultancy: 'cat2Consultancy', cat2Guidance: 'cat2Guidance', cat2ResearchGroups: 'cat2ResearchGroup',
  cat2Linkages: 'cat2Linkage', cat2IndustryLinkages: 'cat2IndustryLinkage', cat2Startups: 'cat2Startup',
  cat3AdvQual: 'cat3AdvQual', cat3Organised: 'cat3OrganisedProgram', cat3ConferencesAttended: 'cat3ConferenceAttended',
  cat3ResourcePerson: 'cat3ResourcePerson', cat3Editorial: 'cat3Editorial', cat3IntlTravel: 'cat3IntlTravel',
  cat3Training: 'cat3Training', cat4AdminResp: 'cat4AdminResp', cat4StudentAct: 'cat4StudentActivity',
  cat5Memberships: 'cat5Membership', cat5Awards: 'cat5Award', cat5Differentiators: 'cat5Differentiator',
  cat5Internships: 'cat5Internship',
};

const replaceSchema = z.object({
  url: z.string().min(1),
  newUrl: z.string().trim().min(1),
});

// POST /appraisals/:id/proofs/replace — the faculty swaps a REJECTED proof for
// a corrected file or link, while the appraisal is on HOLD and before the
// correction deadline. Only the proof URL on the row changes; the new proof is
// PENDING for the HoD / incharge. Once no rejected proof is left the appraisal
// goes back to the review queue. The red-list flag stays for the HoD to clear.
// A proof still rejected at the deadline loses its source's marks
// (cron/proofDeadline) — the rule the owner set on 2026-09-11.
export async function replaceProof(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({ where: { id: req.params.id } });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (sub.userId !== req.user!.id) {
    return res.status(403).json({ error: 'Only the faculty who filed this appraisal can replace its proofs' });
  }
  if (sub.status !== SubmissionStatus.HOLD) {
    return res.status(400).json({ error: 'Proofs can only be replaced while the appraisal is on hold for a rejected proof' });
  }
  if (sub.proofDeadlineAt && sub.proofDeadlineAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'The correction deadline has passed — the marks for the rejected proof are cut' });
  }

  const { url, newUrl } = replaceSchema.parse(req.body);
  if (newUrl.includes('/uploads/')) {
    // Only a file this faculty actually uploaded.
    const record = await prisma.uploadedFile.findUnique({ where: { filename: path.basename(newUrl) } });
    if (!record || record.uploaderId !== req.user!.id) {
      return res.status(400).json({ error: 'Upload the corrected file first, then replace' });
    }
  } else if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(newUrl)) {
    return res.status(400).json({ error: 'Enter a valid link (https://…) or upload a file' });
  }

  await syncProofVerifications(sub.id);
  const pv = await prisma.proofVerification.findUnique({
    where: { submissionId_url: { submissionId: sub.id, url } },
  });
  if (!pv || pv.status !== 'REJECTED') {
    return res.status(400).json({ error: 'Only a rejected proof can be replaced' });
  }
  const taken = await prisma.proofVerification.findUnique({
    where: { submissionId_url: { submissionId: sub.id, url: newUrl } },
  });
  if (taken) return res.status(400).json({ error: 'That proof is already attached to this appraisal' });

  const src = PROOF_SOURCES.find((s) => s.section === pv.section);
  const model = src ? SOURCE_MODEL[src.key] : undefined;
  if (!src || !model) return res.status(400).json({ error: 'Unknown proof section' });

  let remaining = 0;
  try {
    remaining = await prisma.$transaction(async (tx) => {
      let swapped = 0;
      for (const [field] of src.fields) {
        const r = await (tx as any)[model].updateMany({
          where: { submissionId: sub.id, [field]: url },
          data: { [field]: newUrl },
        });
        swapped += r.count;
      }
      if (!swapped) throw new Error('PROOF_ROW_NOT_FOUND');

      await tx.proofVerification.update({
        where: { id: pv.id },
        data: { url: newUrl, status: 'PENDING', verifiedById: null, verifiedAt: null, comment: null },
      });
      const left = await tx.proofVerification.count({ where: { submissionId: sub.id, status: 'REJECTED' } });
      if (left === 0) {
        await tx.appraisalSubmission.update({ where: { id: sub.id }, data: { status: SubmissionStatus.SUBMITTED } });
      }
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'PROOF_REPLACED',
          entityType: 'ProofVerification',
          entityId: pv.id,
          metadata: { submissionId: sub.id, section: pv.section, oldUrl: url, newUrl },
        },
      });
      return left;
    });
  } catch (e: any) {
    if (e?.message === 'PROOF_ROW_NOT_FOUND') {
      return res.status(409).json({ error: 'That proof is no longer on the form' });
    }
    throw e;
  }

  return res.json({
    message: remaining
      ? `Proof replaced — ${remaining} rejected proof(s) still to replace`
      : 'Proof replaced — your appraisal is back with the reviewer',
    remainingRejected: remaining,
  });
}

// GET /red-list — held/red-listed submissions the caller may manage.
export async function listRedList(req: Request, res: Response) {
  const user = req.user!;
  // Institute-wide for the principal; own department(s) for a HoD or incharge.
  const seesAll = hasAnyRole(user, SEES_ALL);
  const deptIds = deptIdsFor(user, DEPT_REVIEW);

  const subs = await prisma.appraisalSubmission.findMany({
    where: {
      redListed: true,
      ...(seesAll ? {} : { user: { departmentId: { in: deptIds } } }),
    },
    include: {
      user: { select: { id: true, name: true, employeeCode: true, department: { select: { name: true, code: true } } } },
      academicYear: { select: { label: true } },
    },
    orderBy: { heldAt: 'desc' },
  });
  return res.json(subs);
}

// GET /proofs/overview?academicYearId= — one row per faculty in scope with
// their upload counts, for the faculty-wise Uploads page. The principal sees
// all departments; a HoD/incharge sees their own.
//
// Deliberately does NOT call syncProofVerifications (that writes, once per
// submission — far too costly across a whole department). Instead it derives
// the true proof count from the submission rows with the pure enumerateProofs,
// then joins the ProofVerification rows that already exist for their statuses.
// Anything not yet reconciled simply counts as pending, which is what it is.
export async function proofsOverview(req: Request, res: Response) {
  const user = req.user!;
  // Institute-wide for the principal; own department(s) for a HoD or incharge.
  const seesAll = hasAnyRole(user, SEES_ALL);
  const deptIds = deptIdsFor(user, DEPT_REVIEW);

  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  const year = academicYearId
    ? await prisma.academicYear.findUnique({ where: { id: academicYearId } })
    : await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' } });
  if (!year) return res.status(404).json({ error: 'Academic year not found' });

  const submissions = await prisma.appraisalSubmission.findMany({
    where: {
      academicYearId: year.id,
      ...(seesAll ? {} : { user: { departmentId: { in: deptIds } } }),
    },
    include: {
      ...PROOF_INCLUDE,
      user: { select: { id: true, name: true, employeeCode: true, department: { select: { name: true, code: true } } } },
    },
    orderBy: { submissionNumber: 'desc' },
  });

  // Latest submission per faculty (list is submissionNumber desc).
  const latest = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) if (!latest.has(s.userId)) latest.set(s.userId, s);
  const picked = [...latest.values()];

  const verifications = await prisma.proofVerification.findMany({
    where: { submissionId: { in: picked.map((s) => s.id) } },
    select: { submissionId: true, url: true, status: true },
  });
  const statusByKey = new Map(verifications.map((v) => [`${v.submissionId}::${v.url}`, v.status]));

  const rows = picked.map((sub) => {
    const items = enumerateProofs(sub);
    let verified = 0, rejected = 0, pending = 0;
    for (const it of items) {
      const st = statusByKey.get(`${sub.id}::${it.url}`);
      if (st === 'VERIFIED') verified++;
      else if (st === 'REJECTED') rejected++;
      else pending++;
    }
    const u = (sub as any).user;
    return {
      submissionId: sub.id,
      status: sub.status,
      redListed: sub.redListed,
      submissionNumber: sub.submissionNumber,
      faculty: { id: u.id, name: u.name, employeeCode: u.employeeCode, department: u.department },
      counts: { total: items.length, verified, rejected, pending },
    };
  }).sort((a, b) => a.faculty.name.localeCompare(b.faculty.name));

  return res.json({ year: { id: year.id, label: year.label }, rows });
}

// POST /appraisals/:id/clear-hold — HoD/admin clears the hold after re-upload.
export async function clearHold(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, departmentId: true } },
      academicYear: { select: { label: true } },
    },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!canManage(req.user!, sub.userId, sub.user.departmentId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!sub.redListed && sub.status !== SubmissionStatus.HOLD) {
    return res.status(400).json({ error: 'Submission is not on hold' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.appraisalSubmission.update({
      where: { id: sub.id },
      data: { status: SubmissionStatus.UNDER_REVIEW, redListed: false, holdReason: null, heldAt: null },
    });
    await tx.auditLog.create({
      data: { userId: req.user!.id, action: 'HOLD_CLEARED', entityType: 'AppraisalSubmission', entityId: sub.id },
    });
  });

  try {
    await enqueueEmail({
      toUserId: sub.userId,
      template: 'hold_cleared',
      payload: { name: sub.user.name, year: sub.academicYear.label, submissionNumber: sub.submissionNumber, submissionId: sub.id },
      dedupeKey: holdClearedKey(sub.id, sub.heldAt),
    });
  } catch (e) {
    console.error('[email] enqueue hold cleared failed:', e);
  }

  return res.json({ message: 'Hold cleared' });
}
