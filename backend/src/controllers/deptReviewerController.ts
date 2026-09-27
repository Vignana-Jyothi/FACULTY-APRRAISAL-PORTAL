import { Request, Response } from 'express';
import { z } from 'zod';
import { RoleType } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { deptIdsFor } from '../utils/roles';

// A HoD may appoint department incharges (the REVIEWER role) within their own
// department, and stand them down again. Deliberately narrow: this touches ONLY
// the REVIEWER role and ONLY the HoD's own department. Every other role, and any
// cross-department move, stays with the maintenance admin's assignRole. Backed
// by roleGuard([HOD]) on the route; the department check here is the second gate
// so a HoD can never reach into another department.

const bodySchema = z.object({ userId: z.string().min(1) });

// The department(s) the caller is HoD of. Departments are isolated, so in
// practice this is a single id, but the set keeps the check correct either way.
function hodDepartments(req: Request): string[] {
  return deptIdsFor({ roles: req.user!.roles }, [RoleType.HOD]);
}

// GET /department/reviewers — the HoD's department roster: every active faculty
// in the department with whether they currently hold the REVIEWER role, so the
// UI can offer appoint / remove without a second lookup.
export async function listDeptReviewers(req: Request, res: Response) {
  const deptIds = hodDepartments(req);
  if (!deptIds.length) return res.status(400).json({ error: 'You are not a HoD of any department' });

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      departmentId: { in: deptIds },
      userRoles: { some: { role: RoleType.FACULTY, isActive: true } },
    },
    select: {
      id: true, name: true, employeeCode: true, designation: true, departmentId: true,
      userRoles: { where: { role: RoleType.REVIEWER, isActive: true }, select: { departmentId: true } },
    },
    orderBy: { name: 'asc' },
  });

  const roster = users.map((u) => ({
    id: u.id,
    name: u.name,
    employeeCode: u.employeeCode,
    designation: u.designation,
    isReviewer: u.userRoles.some((r) => r.departmentId === u.departmentId),
  }));
  return res.json(roster);
}

// POST /department/reviewers { userId } — appoint a department faculty as a
// REVIEWER (incharge) in the HoD's department.
export async function addDeptReviewer(req: Request, res: Response) {
  const { userId } = bodySchema.parse(req.body);
  const deptIds = hodDepartments(req);
  if (!deptIds.length) return res.status(400).json({ error: 'You are not a HoD of any department' });

  if (userId === req.user!.id) {
    return res.status(400).json({ error: 'You already review your own department as HoD' });
  }

  const target = await prisma.user.findFirst({ where: { id: userId, isActive: true } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!target.departmentId || !deptIds.includes(target.departmentId)) {
    return res.status(403).json({ error: 'You can only appoint reviewers in your own department' });
  }

  const deptId = target.departmentId;
  const userRole = await prisma.$transaction(async (tx) => {
    const existing = await tx.userRole.findFirst({
      where: { userId, role: RoleType.REVIEWER, departmentId: deptId },
    });
    const ur = existing
      ? await tx.userRole.update({
          where: { id: existing.id },
          data: { isActive: true, assignedBy: req.user!.id, assignedAt: new Date() },
        })
      : await tx.userRole.create({
          data: { userId, role: RoleType.REVIEWER, departmentId: deptId, assignedBy: req.user!.id, isActive: true },
        });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id, action: 'ROLE_ASSIGNED', entityType: 'UserRole', entityId: ur.id,
        metadata: { role: RoleType.REVIEWER, departmentId: deptId, by: 'HOD' },
      },
    });
    return ur;
  });
  return res.status(201).json(userRole);
}

// DELETE /department/reviewers/:userId — stand a reviewer down in the HoD's
// department. Deactivates the role rather than deleting it (mirrors the admin
// path), so nothing is erased.
export async function removeDeptReviewer(req: Request, res: Response) {
  const userId = req.params.userId;
  const deptIds = hodDepartments(req);
  if (!deptIds.length) return res.status(400).json({ error: 'You are not a HoD of any department' });

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!target.departmentId || !deptIds.includes(target.departmentId)) {
    return res.status(403).json({ error: 'You can only manage reviewers in your own department' });
  }

  const role = await prisma.userRole.findFirst({
    where: { userId, role: RoleType.REVIEWER, departmentId: target.departmentId, isActive: true },
  });
  if (!role) return res.status(404).json({ error: 'This person is not a reviewer in your department' });

  await prisma.userRole.update({ where: { id: role.id }, data: { isActive: false } });
  await prisma.auditLog.create({
    data: {
      userId: req.user!.id, action: 'ROLE_REVOKED', entityType: 'UserRole', entityId: role.id,
      metadata: { role: RoleType.REVIEWER, departmentId: target.departmentId, by: 'HOD' },
    },
  });
  return res.status(204).send();
}
