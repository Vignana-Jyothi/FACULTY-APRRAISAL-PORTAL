import { Request, Response } from 'express';
import { Tier } from '@prisma/client';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { csvSafe } from '../utils/csvSafe';
import prisma from '../utils/prismaClient';
import { buildTrackingRows, summarize, type TrackingRow } from '../services/trackingService';
import { triggerQuarterlySnapshot, previewQuarterlySnapshot } from '../cron/quarterlySnapshot';
import { DEPT_REVIEW, TIER, deptIdsFor, hasAnyRole } from '../utils/roles';
import { canSeeReviewerAssessment } from '../utils/reviewVisibility';

// Tracking is institute-wide for the roles that allocate tiers (dean, special
// scrutinizer, principal) and department-scoped for a HoD or incharge.
function scope(req: Request) {
  const user = req.user!;
  return {
    allDepartments: hasAnyRole(user, TIER),
    deptIds: deptIdsFor(user, DEPT_REVIEW),
    // Decided PER ROW, not once per caller. The dean and special scrutinizers
    // allocate tiers but never see Cat 6, so their rows carry the reviewed
    // /500; the principal and a department's own HoD/incharge see the /550.
    // A role-only test handed a HoD the /550 recorded against THEMSELVES —
    // the gate keys on ownership, and `canSeeReviewerAssessment` is the one
    // place that rule lives.
    canSeeAssessment: (ownerId: string, ownerDepartmentId: string | null) =>
      canSeeReviewerAssessment(user, ownerId, ownerDepartmentId),
  };
}

// GET /tracking?academicYearId=...  (HoD -> own dept, tier roles -> all)
// Per-faculty cadre, actuals vs cadre targets, the dean's manual tier +
// eligibility calls, and the segregation summary.
export async function getTracking(req: Request, res: Response) {
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  const built = await buildTrackingRows({ ...scope(req), academicYearId });
  if (!built) return res.status(404).json({ error: 'Academic year not found' });

  return res.json({
    year: { id: built.year.id, label: built.year.label },
    hasTargets: built.ctx.hasTargets,
    aggregates: summarize(built.rows),
    rows: built.rows,
  });
}

const setTierSchema = z.object({
  userId: z.string().min(1),
  academicYearId: z.string().min(1),
  tier: z.nativeEnum(Tier).nullable().optional(),
  eligible: z.boolean().nullable().optional(),
}).refine((v) => v.tier !== undefined || v.eligible !== undefined, {
  message: 'Provide tier and/or eligible',
});

// PUT /admin/faculty-tiers  { userId, academicYearId, tier?, eligible? }
// The admin/dean sets a faculty's tier and eligibility for the year by hand —
// neither is auto-computed. Passing null clears that decision; omitting a field
// leaves it untouched.
export async function setFacultyTier(req: Request, res: Response) {
  const { userId, academicYearId, tier, eligible } = setTierSchema.parse(req.body);
  const row = await prisma.facultyTier.upsert({
    where: { userId_academicYearId: { userId, academicYearId } },
    create: {
      userId, academicYearId, assignedById: req.user!.id,
      tier: tier ?? null, eligible: eligible ?? null,
    },
    update: {
      assignedById: req.user!.id,
      ...(tier !== undefined ? { tier } : {}),
      ...(eligible !== undefined ? { eligible } : {}),
    },
  });
  return res.json(row);
}

function exportRow(r: TrackingRow) {
  return {
    'Employee Code': csvSafe(r.faculty.employeeCode),
    Name: csvSafe(r.faculty.name),
    Department: csvSafe(r.department?.name ?? ''),
    Designation: csvSafe(r.faculty.designation ?? ''),
    Cadre: r.cadreLabel ?? 'Unassigned',
    'Exp (yr)': r.expYears,
    Tier: r.tier ?? '',
    Eligible: r.eligible == null ? 'Not decided' : r.eligible ? 'Yes' : 'No',
    // One column used to hold a self total /500, a reviewed /500 and a grand
    // total /550 with nothing saying which. The scale and its basis now travel
    // with every row.
    'Total Score': r.actuals.totalScore,
    'Out of': r.scoreScale,
    'Score Basis': r.actuals.totalScoreSource === 'SELF'
      ? 'Self-assessed (no review yet)'
      : r.scoreScale === 550 ? 'Reviewed incl. core values' : 'Reviewed',
    Feedback: r.actuals.feedback,
    Indexed: r.actuals.indexedCount,
    Journals: r.actuals.journalCount,
    Patents: r.actuals.patentCount,
    Projects: r.actuals.projectCount,
    Consultancy: r.actuals.consultancyCount,
  };
}

// GET /tracking/export?academicYearId=&format=excel  — segregated report download.
export async function exportTracking(req: Request, res: Response) {
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  const built = await buildTrackingRows({ ...scope(req), academicYearId });
  if (!built) return res.status(404).json({ error: 'Academic year not found' });

  const rows = built.rows.map(exportRow);

  if (req.query.format === 'excel') {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Cadre-Tier');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=cadre-tier-${built.year.label}.xlsx`);
    return res.send(buf);
  }

  return res.json(rows);
}

// POST /admin/tracking/snapshot  { academicYearId?, confirm? } — run the
// quarterly snapshot + auto-feedback now (admin). Cron runs it at each
// quarter-end.
//
// This emails every opted-in faculty at their real address, so it is a DRY RUN
// unless the caller passes `confirm: true`. The dry run writes nothing and
// queues nothing — it only reports how many people the real run would mail.
export async function runSnapshot(req: Request, res: Response) {
  const academicYearId = typeof req.body?.academicYearId === 'string' ? req.body.academicYearId : undefined;
  const confirmed = req.body?.confirm === true;

  if (!confirmed) {
    const preview = await previewQuarterlySnapshot(academicYearId);
    return res.json({
      dryRun: true,
      message: `Dry run — ${preview.quarter}: would email ${preview.recipients} of ${preview.faculty} faculty. Confirm to send.`,
      ...preview,
    });
  }

  const result = await triggerQuarterlySnapshot(academicYearId);
  return res.json({ dryRun: false, message: `Snapshot ${result.quarter} — ${result.faculty} faculty`, ...result });
}
