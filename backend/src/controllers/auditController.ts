import { Request, Response } from 'express';
import prisma from '../utils/prismaClient';
import { isFullAdmin, deptAdminScope } from '../utils/roles';

export async function listAuditLogs(req: Request, res: Response) {
  const { userId, action, entityType, from, to, limit, offset } = req.query;

  const where: any = {};
  if (userId) where.userId = userId as string;
  if (action) where.action = { contains: action as string, mode: 'insensitive' };
  if (entityType) where.entityType = entityType as string;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from as string);
    if (to) where.createdAt.lte = new Date(to as string);
  }

  // A DEPT_ADMIN sees only entries that concern their department: actions taken
  // BY one of their users, or actions ON one of their user accounts. The full
  // admin is unrestricted.
  const scope = isFullAdmin(req.user) ? null : deptAdminScope(req.user!);
  if (scope !== null) {
    if (scope.length === 0) return res.json({ rows: [], total: 0, limit: 0, offset: 0 });
    const deptUserIds = (
      await prisma.user.findMany({ where: { departmentId: { in: scope } }, select: { id: true } })
    ).map((u) => u.id);
    where.OR = [
      { userId: { in: deptUserIds } },
      { entityType: 'User', entityId: { in: deptUserIds } },
    ];
  }

  const take = Math.min(Number(limit ?? 100), 500);
  const skip = Number(offset ?? 0);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, employeeCode: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return res.json({ rows, total, limit: take, offset: skip });
}

export async function listAuditActions(_req: Request, res: Response) {
  // Distinct action strings for filter dropdown
  const rows = await prisma.auditLog.findMany({
    distinct: ['action'],
    select: { action: true },
    orderBy: { action: 'asc' },
    take: 200,
  });
  return res.json(rows.map((r) => r.action));
}
