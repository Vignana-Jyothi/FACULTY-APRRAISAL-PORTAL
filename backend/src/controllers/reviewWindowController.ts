import { Request, Response } from 'express';
import { z } from 'zod';
import { Quarter } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { previewWindowMail, countWindowRecipients, releaseWindowMail } from '../cron/quarterlySnapshot';

// W8 — admin-configured quarterly review windows. The quarterly automation
// (snapshot + auto-feedback) fires on a window's endDate (see quarterlySnapshot
// runDueReviewWindows). One window per (academicYear, quarter).
//
// Mass-mail gate (owner decision 2026-09-19): a window only emails faculty if
// the dean armed it after seeing a preview. Unarmed, it snapshots and holds the
// mail; the dean can release it later.

const upsertSchema = z.object({
  academicYearId: z.string().min(1),
  quarter: z.nativeEnum(Quarter),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  enabled: z.boolean().default(true),
});

const armSchema = z.object({ expectedRecipients: z.number().int().min(0) });

const ALREADY_RELEASED = 'The held mail for this window was already released';

// GET /admin/review-windows?academicYearId=...
export async function listReviewWindows(req: Request, res: Response) {
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  const windows = await prisma.reviewWindow.findMany({
    where: academicYearId ? { academicYearId } : undefined,
    orderBy: [{ quarter: 'asc' }],
  });
  // Who armed each window, for the "Armed (by, when)" state.
  const armerIds = [...new Set(windows.map((w) => w.armedById).filter((id): id is string => !!id))];
  const armers = armerIds.length
    ? await prisma.user.findMany({ where: { id: { in: armerIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(armers.map((u) => [u.id, u.name]));
  return res.json(windows.map((w) => ({ ...w, armedByName: w.armedById ? nameById.get(w.armedById) ?? null : null })));
}

// PUT /admin/review-windows — upsert one (AY, quarter) window.
export async function upsertReviewWindow(req: Request, res: Response) {
  const { academicYearId, quarter, startDate, endDate, enabled } = upsertSchema.parse(req.body);

  if (endDate < startDate) {
    return res.status(400).json({ error: 'End date must be on or after the start date' });
  }
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) return res.status(404).json({ error: 'Academic year not found' });

  const existing = await prisma.reviewWindow.findUnique({
    where: { academicYearId_quarter: { academicYearId, quarter } },
  });
  const datesChanged =
    !!existing &&
    (existing.startDate.getTime() !== startDate.getTime() || existing.endDate.getTime() !== endDate.getTime());

  const row = await prisma.reviewWindow.upsert({
    where: { academicYearId_quarter: { academicYearId, quarter } },
    // Changing the window clears lastRunAt so it can fire again on the new end date.
    create: { academicYearId, quarter, startDate, endDate, enabled },
    update: {
      startDate, endDate, enabled, lastRunAt: null,
      // New dates are a new run, so clear any held/released state — but keep the
      // arm. Moving a date does not change who gets mailed (recipients key on
      // year + quarter), and the fire job recounts against armedCount before
      // sending, so a stale arm can never mail a changed roster (2026-09-25).
      ...(datesChanged ? { heldAt: null, releasedAt: null } : {}),
    },
  });
  return res.json(row);
}

// DELETE /admin/review-windows/:id
export async function deleteReviewWindow(req: Request, res: Response) {
  const { id } = req.params;
  await prisma.reviewWindow.delete({ where: { id } });
  return res.status(204).send();
}

// GET /admin/review-windows/:id/preview — who the window would mail, and one
// of those emails rendered. Queues and sends nothing.
export async function previewReviewWindow(req: Request, res: Response) {
  const w = await prisma.reviewWindow.findUnique({ where: { id: req.params.id } });
  if (!w) return res.status(404).json({ error: 'Review window not found' });
  return res.json(await previewWindowMail(w.academicYearId, w.quarter));
}

// POST /admin/review-windows/:id/arm { expectedRecipients } — the dean arms
// exactly what they previewed; a changed recipient count is refused.
export async function armReviewWindow(req: Request, res: Response) {
  const { expectedRecipients } = armSchema.parse(req.body);
  const w = await prisma.reviewWindow.findUnique({ where: { id: req.params.id } });
  if (!w) return res.status(404).json({ error: 'Review window not found' });
  if (w.lastRunAt) {
    return res.status(409).json({
      error: w.heldAt && !w.releasedAt
        ? 'This window already ran with its mail held. Use Release instead.'
        : 'This window has already run',
    });
  }

  const recipients = await countWindowRecipients(w.academicYearId, w.quarter);
  if (recipients !== expectedRecipients) {
    return res.status(409).json({
      error: `The recipient count changed (now ${recipients}, you confirmed ${expectedRecipients}). Review the preview again.`,
      recipients,
    });
  }

  const row = await prisma.reviewWindow.update({
    where: { id: w.id },
    data: { armedAt: new Date(), armedById: req.user!.id, armedCount: recipients },
  });
  await prisma.auditLog.create({
    data: {
      userId: req.user!.id, action: 'REVIEW_WINDOW_ARMED', entityType: 'ReviewWindow', entityId: w.id,
      metadata: { quarter: w.quarter, academicYearId: w.academicYearId, recipients },
    },
  });
  return res.json(row);
}

// POST /admin/review-windows/:id/disarm
export async function disarmReviewWindow(req: Request, res: Response) {
  const w = await prisma.reviewWindow.findUnique({ where: { id: req.params.id } });
  if (!w) return res.status(404).json({ error: 'Review window not found' });
  const row = await prisma.reviewWindow.update({ where: { id: w.id }, data: { armedAt: null, armedById: null, armedCount: null } });
  if (w.armedAt) {
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id, action: 'REVIEW_WINDOW_DISARMED', entityType: 'ReviewWindow', entityId: w.id,
        metadata: { quarter: w.quarter, academicYearId: w.academicYearId },
      },
    });
  }
  return res.json(row);
}

// POST /admin/review-windows/:id/release { confirm: true } — send a held
// window's mail. Without confirm it is a dry run that only counts.
export async function releaseReviewWindow(req: Request, res: Response) {
  const w = await prisma.reviewWindow.findUnique({ where: { id: req.params.id } });
  if (!w) return res.status(404).json({ error: 'Review window not found' });
  if (!w.heldAt) return res.status(409).json({ error: 'This window has no held mail' });
  if (w.releasedAt) return res.status(409).json({ error: ALREADY_RELEASED });

  if (req.body?.confirm !== true) {
    const recipients = await countWindowRecipients(w.academicYearId, w.quarter);
    return res.json({
      dryRun: true,
      recipients,
      message: `Dry run — ${w.quarter}: would email ${recipients} faculty. Confirm to send.`,
    });
  }

  // Claim the release atomically so two clicks cannot both send. The dedupe
  // keys would stop a double mail anyway; this makes the second one a 409.
  const claimed = await prisma.reviewWindow.updateMany({
    where: { id: w.id, heldAt: { not: null }, releasedAt: null },
    data: { releasedAt: new Date() },
  });
  if (claimed.count === 0) return res.status(409).json({ error: ALREADY_RELEASED });

  const queued = await releaseWindowMail(w.academicYearId, w.quarter);
  await prisma.auditLog.create({
    data: {
      userId: req.user!.id, action: 'REVIEW_WINDOW_RELEASED', entityType: 'ReviewWindow', entityId: w.id,
      metadata: { quarter: w.quarter, academicYearId: w.academicYearId, queued },
    },
  });
  return res.json({ dryRun: false, queued, message: `Released — ${queued} email(s) queued` });
}
