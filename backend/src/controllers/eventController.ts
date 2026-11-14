import { Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import prisma from '../utils/prismaClient';
import { DeptEventType, DeptEventScope, EventCollabType, RoleType, Prisma } from '@prisma/client';
import { deptIdsFor } from '../utils/roles';
import { renderHtmlToPdf, renderEventsReportHtml } from '../services/pdfService';

/**
 * Who may see/touch which department's events.
 *   null  → (unused) every department.
 *   [...] → a DEPT_ADMIN / HoD: confined to their own department(s).
 *           An empty array denies everything.
 */
export function eventScope(req: Request): string[] | null {
  return [...new Set(deptIdsFor(req.user!, [RoleType.DEPT_ADMIN, RoleType.HOD]))];
}

function inScope(scope: string[] | null, departmentId: string): boolean {
  return scope === null || scope.includes(departmentId);
}

// Single source of column key -> label, used by the list view and both reports.
export const EVENT_COLUMNS: Record<string, string> = {
  eventName: 'Event Name',
  type: 'Type',
  scope: 'Scope',
  startDate: 'Start Date',
  endDate: 'End Date',
  description: 'Description',
  coordinators: 'Coordinators',
  venue: 'Venue',
  targetAudienceType: 'Target Audience',
  resourcePersons: 'Resource Persons',
  audienceInternal: 'Participants (Internal)',
  audienceOutsiders: 'Participants (External)',
  studentGroup: 'Student Group',
  contactName: 'Contact Person',
  contactDesignation: 'Contact Designation',
  contactDetails: 'Contact Details',
  targetBatch: 'Target Batch',
  studentCount: 'Student Count',
  hasCollaboration: 'Collaboration',
  collabType: 'Collaboration Type',
  collaboratorName: 'Collaborator',
  sponsorship: 'Sponsorship',
  brochureUrl: 'Brochure',
  posterUrl: 'Poster',
  outcomes: 'Outcomes',
};

type EventVariant = 'academic' | 'industry' | 'induction' | 'others';
function eventVariant(type: string): EventVariant {
  if (type === 'INDUSTRY_VISIT') return 'industry';
  if (type === 'INDUCTION_PROGRAM') return 'induction';
  if (type === 'OTHER' || type === 'PTM') return 'others';
  return 'academic';
}

// Null out fields that don't belong to the event's variant so stray values never persist.
// Skipped when `type` is absent (partial update that doesn't change the type).
function normalizeByVariant<T extends Record<string, any>>(data: T): T {
  if (!data.type) return data;
  const d: Record<string, any> = { ...data };
  const noCollab = () => {
    d.hasCollaboration = false;
    d.collabType = null;
    d.collaboratorName = null;
    d.sponsorship = null;
  };
  const noMedia = () => {
    d.brochureUrl = null;
    d.posterUrl = null;
    d.resourcePersons = [];
  };
  const noAudience = () => {
    d.audienceInternal = null;
    d.audienceOutsiders = null;
    d.targetAudienceType = null;
  };
  const noIndustry = () => {
    d.studentGroup = null;
    d.contactName = null;
    d.contactDesignation = null;
    d.contactDetails = null;
  };
  const noInduction = () => {
    d.targetBatch = null;
    d.studentCount = null;
  };
  switch (eventVariant(d.type)) {
    case 'industry':
      d.scope = null; d.endDate = null; noCollab(); noMedia(); noAudience(); d.scheduleFileUrl = null; noInduction();
      break;
    case 'induction':
      d.scope = null; noCollab(); noMedia(); noAudience(); noIndustry();
      break;
    case 'others':
      d.scope = null; d.endDate = null; noCollab(); noMedia(); d.scheduleFileUrl = null; noAudience(); noIndustry(); noInduction();
      break;
    case 'academic':
      noIndustry(); noInduction();
      if (d.scope === 'INTRA_COLLEGE') d.audienceOutsiders = null;
      break;
  }
  return d as T;
}

// Empty form strings mean "leave unset".
// '' or null/undefined from the form means "clear this field"; keep null so a
// PUT can actually blank a nullable column (undefined would be omitted).
const emptyToNull = (v: unknown) => (v === '' || v == null ? null : v);
const optStr = z.preprocess(emptyToNull, z.string().nullable().optional());
const optDate = z.preprocess(emptyToNull, z.coerce.date().nullable().optional());
const optInt = z.preprocess(
  (v) => (v === '' || v == null ? null : Number(v)),
  z.number().int().min(0).nullable().optional(),
);
const optEnum = <T extends Record<string, string>>(e: T) => z.preprocess(emptyToNull, z.nativeEnum(e).nullable().optional());

const baseSchema = z.object({
  departmentId: z.string().min(1),
  eventName: z.string().trim().min(1),
  type: z.nativeEnum(DeptEventType),
  typeOther: optStr,
  description: optStr,
  scope: optEnum(DeptEventScope),
  startDate: optDate,
  endDate: optDate,
  coordinators: z.array(z.string()).default([]),
  venue: optStr,
  audienceInternal: optInt,
  audienceOutsiders: optInt,
  coordinatorIds: z.array(z.string()).default([]),
  resourcePersons: z.array(z.string()).default([]),
  brochureUrl: optStr,
  posterUrl: optStr,
  targetAudienceType: optStr,
  studentGroup: optStr,
  contactName: optStr,
  contactDesignation: optStr,
  contactDetails: optStr,
  targetBatch: optStr,
  studentCount: optInt,
  hasCollaboration: z.boolean().default(false),
  collabType: optEnum(EventCollabType),
  collaboratorName: optStr,
  sponsorship: optStr,
  scheduleFileUrl: optStr,
  photoUrls: z.array(z.string()).max(2, 'At most 2 photos allowed').default([]),
  outcomes: optStr,
});

// Update: every field optional; the department can't be moved.
const periodOk = (d: { startDate?: Date | null; endDate?: Date | null }) =>
  !d.startDate || !d.endDate || d.endDate >= d.startDate;
const periodRefine = { message: 'End date must be on or after the start date', path: ['endDate'] };

const typeOtherOk = (d: { type?: string; typeOther?: string | null }) =>
  d.type !== 'OTHER' || !!(d.typeOther && d.typeOther.trim().length > 0);
const typeOtherRefine = { message: 'Specify the event type', path: ['typeOther'] };

const createSchema = baseSchema.refine(periodOk, periodRefine).refine(typeOtherOk, typeOtherRefine);
const updateSchema = baseSchema.omit({ departmentId: true }).partial().refine(periodOk, periodRefine).refine(typeOtherOk, typeOtherRefine);

const EVENT_INCLUDE = {
  department: { select: { code: true, name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.DeptEventInclude;

const EVENT_ORDER: Prisma.DeptEventOrderByWithRelationInput[] = [
  { startDate: { sort: 'desc', nulls: 'last' } },
  { createdAt: 'desc' },
];

function buildWhere(req: Request): Prisma.DeptEventWhereInput {
  const scope = eventScope(req);
  const { type, scope: evScope, dept } = req.query as Record<string, string | undefined>;
  const where: Prisma.DeptEventWhereInput = {};
  if (type && (Object.values(DeptEventType) as string[]).includes(type)) where.type = type as DeptEventType;
  if (evScope && (Object.values(DeptEventScope) as string[]).includes(evScope)) where.scope = evScope as DeptEventScope;
  if (scope === null) {
    if (dept) where.departmentId = dept;
  } else if (dept) {
    where.departmentId = scope.includes(dept) ? dept : { in: [] };
  } else {
    where.departmentId = { in: scope };
  }
  return where;
}

// GET /events
export async function listEvents(req: Request, res: Response) {
  const events = await prisma.deptEvent.findMany({
    where: buildWhere(req),
    include: EVENT_INCLUDE,
    orderBy: EVENT_ORDER,
  });
  return res.json(events);
}

// GET /events/:id
export async function getEvent(req: Request, res: Response) {
  const event = await prisma.deptEvent.findUnique({ where: { id: req.params.id }, include: EVENT_INCLUDE });
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!inScope(eventScope(req), event.departmentId)) {
    return res.status(403).json({ error: 'Not allowed to view this event' });
  }
  return res.json(event);
}

// POST /events
export async function createEvent(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input', details: parsed.error.flatten() });
  const data = normalizeByVariant(parsed.data);

  if (!inScope(eventScope(req), data.departmentId)) {
    return res.status(403).json({ error: 'You can only add events in your own department' });
  }
  const dept = await prisma.department.findUnique({ where: { id: data.departmentId }, select: { id: true } });
  if (!dept) return res.status(400).json({ error: 'Department not found' });

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.deptEvent.create({
      data: { ...data, createdById: req.user!.id },
      include: EVENT_INCLUDE,
    });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'EVENT_CREATED',
        entityType: 'DeptEvent',
        entityId: created.id,
        metadata: { eventName: created.eventName, departmentId: created.departmentId },
      },
    });
    return created;
  });
  return res.status(201).json(event);
}

// PUT /events/:id
export async function updateEvent(req: Request, res: Response) {
  const existing = await prisma.deptEvent.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (!inScope(eventScope(req), existing.departmentId)) {
    return res.status(403).json({ error: 'Not allowed to edit this event' });
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input', details: parsed.error.flatten() });

  const updated = await prisma.deptEvent.update({
    where: { id: existing.id },
    data: normalizeByVariant(parsed.data),
    include: EVENT_INCLUDE,
  });
  return res.json(updated);
}

// DELETE /events/:id
export async function deleteEvent(req: Request, res: Response) {
  const existing = await prisma.deptEvent.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (!inScope(eventScope(req), existing.departmentId)) {
    return res.status(403).json({ error: 'Not allowed to delete this event' });
  }
  await prisma.deptEvent.delete({ where: { id: existing.id } });
  return res.json({ message: 'Deleted' });
}

// ─── Reports ─────────────────────────────────────────────────────────

const humanize = (v: string | null | undefined): string =>
  v ? v.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';

function fmtDate(d: Date | null): string {
  if (!d) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

function cellValue(e: any, key: string, nameMap: Map<string, string>): string {
  switch (key) {
    case 'type': return e.type === 'OTHER' ? (e.typeOther || 'Other') : humanize(e.type);
    case 'scope': case 'collabType': return humanize(e[key]);
    case 'startDate': return fmtDate(e.startDate);
    case 'endDate': return fmtDate(e.endDate);
    case 'coordinators':
      if (e.coordinatorIds?.length) {
        return (e.coordinatorIds as string[]).map((id) => nameMap.get(id)).filter(Boolean).join(', ');
      }
      return (e.coordinators ?? []).join(', ');
    case 'resourcePersons': return (e.resourcePersons ?? []).join(', ');
    case 'brochureUrl': case 'posterUrl': return e[key] ?? '';
    case 'hasCollaboration': return e.hasCollaboration ? 'Yes' : 'No';
    case 'audienceInternal': case 'audienceOutsiders': case 'studentCount': return e[key] == null ? '' : String(e[key]);
    default: return e[key] ?? '';
  }
}

async function loadReport(req: Request) {
  const events = await prisma.deptEvent.findMany({
    where: buildWhere(req),
    include: EVENT_INCLUDE,
    orderBy: EVENT_ORDER,
  });
  const coordIds = [...new Set(events.flatMap((e) => e.coordinatorIds))];
  const nameMap = new Map<string, string>();
  if (coordIds.length) {
    const users = await prisma.user.findMany({ where: { id: { in: coordIds } }, select: { id: true, name: true } });
    for (const u of users) nameMap.set(u.id, u.name);
  }
  const requested = typeof req.query.fields === 'string' && req.query.fields
    ? req.query.fields.split(',').map((s) => s.trim())
    : null;
  const keys = Object.keys(EVENT_COLUMNS).filter((k) => !requested || requested.includes(k));
  const dept = typeof req.query.dept === 'string' && req.query.dept
    ? await prisma.department.findUnique({ where: { id: req.query.dept }, select: { name: true } })
    : null;
  let deptName = dept?.name;
  if (!deptName) {
    const scope = eventScope(req);
    if (scope !== null && scope.length === 1) {
      deptName = (await prisma.department.findUnique({ where: { id: scope[0] }, select: { name: true } }))?.name;
    }
  }
  return {
    deptName: deptName ?? 'All Departments',
    headers: keys.map((k) => EVENT_COLUMNS[k]),
    rows: events.map((e) => keys.map((k) => cellValue(e, k, nameMap))),
  };
}

// GET /events/report/excel
export async function eventsReportExcel(req: Request, res: Response) {
  const { deptName, headers, rows } = await loadReport(req);
  const ws = XLSX.utils.aoa_to_sheet([
    ['VNRVJIET — Faculty Appraisal Portal'],
    [`Department: ${deptName}`],
    [],
    headers,
    ...rows,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Events');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=dept-events.xlsx');
  return res.send(buf);
}

// GET /events/report/pdf
export async function eventsReportPdf(req: Request, res: Response) {
  const { deptName, headers, rows } = await loadReport(req);
  const html = renderEventsReportHtml(deptName, headers, rows);
  const buf = await renderHtmlToPdf(html, { landscape: headers.length > 6 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=dept-events.pdf');
  return res.send(buf);
}
