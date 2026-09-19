import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { parse as parseCsv } from 'csv-parse/sync';
import prisma from '../utils/prismaClient';
import { RoleType } from '@prisma/client';
import { DEPARTMENT_SCOPED, INSTITUTE_WIDE } from '../utils/roles';
import { DEFAULT_IMPORT_PASSWORD } from '../utils/defaultPassword';
import { issueSession } from './authController';

const profileUpdateSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  contactAddress: z.string().optional(),
  designation: z.string().optional(),
  specialization: z.string().optional(),
  educationalQuals: z.string().optional(),
});

const createUserSchema = z.object({
  employeeCode: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  departmentId: z.string().optional(),
  designation: z.string().optional(),
});

export async function getMe(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      department: true,
      userRoles: { where: { isActive: true }, include: { department: true } },
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { passwordHash, ...safeUser } = user;
  return res.json(safeUser);
}

export async function updateProfile(req: Request, res: Response) {
  const data = profileUpdateSchema.parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data,
  });
  const { passwordHash, ...safeUser } = user;
  return res.json(safeUser);
}

// ─── Password change with email OTP ─────────────────────────────────

const OTP_EXPIRY_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;

function generateOtp(): string {
  // Cryptographically secure 6-digit code — Math.random is predictable.
  return String(randomInt(100000, 1000000));
}

const requestOtpSchema = z.object({
  currentPassword: z.string().min(1),
});

export async function requestPasswordOtp(req: Request, res: Response) {
  const { currentPassword } = requestOtpSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.email) return res.status(400).json({ error: 'No email on file — contact admin' });

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Current password incorrect' });

  const otp = generateOtp();
  const codeHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MIN * 60 * 1000);

  await prisma.passwordOtp.upsert({
    where: { userId: user.id },
    create: { userId: user.id, codeHash, expiresAt, attempts: 0 },
    update: { codeHash, expiresAt, attempts: 0 },
  });

  // Send OTP via email (do not honor optIn — security email)
  const { enqueueEmail } = await import('../services/emailService');
  await enqueueEmail({
    toUserId: user.id,
    template: 'password_otp',
    payload: {
      name: user.name,
      otp,
      expiresInMinutes: OTP_EXPIRY_MIN,
    },
    // No dedupe — each request generates new OTP
    honorOptIn: false,
  });

  return res.json({ message: `OTP sent to ${user.email.replace(/(.{2}).+(@.+)/, '$1***$2')}`, expiresInMinutes: OTP_EXPIRY_MIN });
}

const verifyChangeSchema = z.object({
  otp: z.string().length(6, 'OTP must be 6 digits'),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must include a letter')
    .regex(/\d/, 'Password must include a number'),
});

export async function changePasswordWithOtp(req: Request, res: Response) {
  const { otp, newPassword } = verifyChangeSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { passwordOtp: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const otpRow = user.passwordOtp;
  if (!otpRow) return res.status(400).json({ error: 'No OTP requested — request OTP first' });
  if (otpRow.expiresAt < new Date()) {
    await prisma.passwordOtp.delete({ where: { userId: user.id } }).catch(() => {});
    return res.status(400).json({ error: 'OTP expired — request a new one' });
  }
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.passwordOtp.delete({ where: { userId: user.id } }).catch(() => {});
    return res.status(400).json({ error: 'Too many invalid attempts — request a new OTP' });
  }

  const ok = await bcrypt.compare(otp, otpRow.codeHash);
  if (!ok) {
    await prisma.passwordOtp.update({
      where: { userId: user.id },
      data: { attempts: { increment: 1 } },
    });
    const remaining = OTP_MAX_ATTEMPTS - (otpRow.attempts + 1);
    return res.status(400).json({ error: `Invalid OTP — ${remaining} attempt(s) remaining` });
  }

  // OTP valid: hash new password, atomic update
  const newHash = await bcrypt.hash(newPassword, 12);
  const sameAsOld = await bcrypt.compare(newPassword, user.passwordHash);
  if (sameAsOld) return res.status(400).json({ error: 'New password must differ from current' });

  const tokenVersion = await prisma.$transaction(async (tx) => {
    // Bump the session generation so tokens issued before this change die.
    // The user chose this password themselves, so any forced change is done.
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, tokenVersion: { increment: 1 }, mustChangePassword: false },
    });
    await tx.passwordOtp.delete({ where: { userId: user.id } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id,
      },
    });
    return updated.tokenVersion;
  });

  // The tokenVersion bump above killed every session, including this one. The
  // user has just proved both the old password and the emailed OTP, so hand this
  // tab a fresh session rather than bouncing them to the login page — the forced
  // first-sign-in change would otherwise end in an unexplained logout.
  const accessToken = issueSession(res, {
    id: user.id,
    employeeCode: user.employeeCode,
    tokenVersion,
  });
  return res.json({ message: 'Password updated successfully', accessToken, mustChangePassword: false });
}

// Admin: list all users
export async function listUsers(req: Request, res: Response) {
  const { dept, role, search, limit, offset } = req.query;

  // Deactivated users are hidden from every picker and list. An admin can ask
  // for them, so a soft-deleted account stays findable and can be reactivated —
  // otherwise deactivating would be as final as the hard delete it replaced.
  const isAdmin = req.user?.roles.some((r) => r.role === RoleType.ADMIN) ?? false;
  const includeInactive = isAdmin && req.query.includeInactive === 'true';

  const where: any = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(dept ? { departmentId: dept as string } : {}),
    ...(search ? { OR: [{ name: { contains: search as string, mode: 'insensitive' } }, { employeeCode: { contains: search as string, mode: 'insensitive' } }] } : {}),
    ...(role ? { userRoles: { some: { role: role as RoleType, isActive: true } } } : {}),
  };
  const include = {
    department: true,
    userRoles: { where: { isActive: true }, include: { department: true } },
  };

  if (limit !== undefined) {
    const take = Math.min(Number(limit), 200);
    const skip = Number(offset ?? 0);
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, include, orderBy: { name: 'asc' }, take, skip }),
      prisma.user.count({ where }),
    ]);
    return res.json({
      rows: users.map(({ passwordHash, ...u }) => u),
      total,
      limit: take,
      offset: skip,
    });
  }

  const users = await prisma.user.findMany({ where, include, orderBy: { name: 'asc' } });
  return res.json(users.map(({ passwordHash, ...u }) => u));
}

export async function createUser(req: Request, res: Response) {
  const { employeeCode, name, email, password, departmentId, designation } = createUserSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      // The admin chose this password, so the user must replace it at first sign-in.
      data: { employeeCode, name, email, passwordHash, departmentId, designation, mustChangePassword: true },
    });

    await tx.userRole.create({
      data: {
        userId: newUser.id,
        role: RoleType.FACULTY,
        assignedBy: req.user!.id,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: newUser.id,
      },
    });

    return newUser;
  });

  const { passwordHash: _, ...safeUser } = user;
  return res.status(201).json(safeUser);
}

export async function updateUser(req: Request, res: Response) {
  const { id } = req.params;
  const data = profileUpdateSchema.parse(req.body);
  const user = await prisma.user.update({ where: { id }, data });
  const { passwordHash, ...safeUser } = user;
  return res.json(safeUser);
}

/**
 * Deactivate a user. This is a SOFT delete and there is no hard one.
 *
 * The previous version removed the user row and, with it, every appraisal they
 * had filed, every review they had given on other people's work, and their
 * audit trail — irreversibly, from a button in the admin list that also had a
 * "delete selected" bulk form. An appraisal is a record of the institution's
 * assessment of someone; staff leave and their history has to survive them.
 *
 * Deactivating blocks sign-in (authController already refuses an inactive user)
 * and stands their roles down, so a departed HoD keeps no authority. Nothing is
 * erased, and `reactivateUser` puts them back.
 */
export async function deactivateUser(req: Request, res: Response) {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, employeeCode: true, isActive: true },
  });
  if (!user) return res.status(404).json({ error: 'Not found' });

  // An admin who deactivates themselves cannot sign back in to undo it.
  if (id === req.user!.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }
  if (!user.isActive) {
    return res.json({ message: 'User is already deactivated', user });
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Stand down every role so no authority outlives the account.
    const roles = await tx.userRole.updateMany({
      where: { userId: id, isActive: true },
      data: { isActive: false },
    });
    const u = await tx.user.update({ where: { id }, data: { isActive: false } });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'USER_DEACTIVATED',
        entityType: 'User',
        entityId: id,
        metadata: { employeeCode: user.employeeCode, name: user.name, rolesStoodDown: roles.count },
      },
    });
    return u;
  });

  const { passwordHash, ...safeUser } = updated;
  return res.json({ message: 'User deactivated', user: safeUser });
}

/** Undo a deactivation. Roles stay stood down and are re-assigned deliberately. */
export async function reactivateUser(req: Request, res: Response) {
  const { id } = req.params;

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, employeeCode: true, name: true, isActive: true } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.isActive) return res.json({ message: 'User is already active', user });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data: { isActive: true } });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'USER_REACTIVATED',
        entityType: 'User',
        entityId: id,
        metadata: { employeeCode: user.employeeCode, name: user.name },
      },
    });
    return u;
  });

  const { passwordHash, ...safeUser } = updated;
  return res.json({ message: 'User reactivated', user: safeUser });
}

export async function assignRole(req: Request, res: Response) {
  const { id } = req.params;
  const { role, departmentId } = z.object({
    role: z.nativeEnum(RoleType),
    departmentId: z.string().nullable().optional(),
  }).parse(req.body);

  const deptId = departmentId ?? null;

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // HOD and REVIEWER are the only department-scoped roles. PRINCIPAL, DEAN,
  // SCRUTINIZER, SPECIAL_SCRUTINIZER, ADMIN and FACULTY are institute-wide and
  // must not carry a department — one attached here would silently narrow a
  // role that is supposed to reach across every department.
  if (DEPARTMENT_SCOPED.includes(role) && !deptId) {
    return res.status(400).json({ error: `${role} role requires a department` });
  }
  if (INSTITUTE_WIDE.includes(role) && deptId) {
    return res.status(400).json({ error: `${role} is institute-wide and cannot be assigned to a department` });
  }
  if (deptId) {
    const dept = await prisma.department.findFirst({ where: { id: deptId, isActive: true } });
    if (!dept) return res.status(400).json({ error: 'Department not found or inactive' });
  }

  // Departments are isolated: a HoD or reviewer may only hold that role in the
  // department they belong to. Cross-department authority sits with the
  // principal and the dean, and with the scrutinizers the dean assigns per
  // submission through the final-review layer.
  if (DEPARTMENT_SCOPED.includes(role)) {
    if (!targetUser.departmentId) {
      return res.status(400).json({ error: `${role} role requires the user to belong to a department` });
    }
    if (targetUser.departmentId !== deptId) {
      return res.status(400).json({
        error: `Departments are isolated — ${role} can only be assigned in the user's own department`,
      });
    }
  }

  // Prisma 6 nullable-composite-unique workaround: findFirst then create/update
  const userRole = await prisma.$transaction(async (tx) => {
    const existing = await tx.userRole.findFirst({
      where: { userId: id, role, departmentId: deptId },
    });

    let ur;
    if (existing) {
      ur = await tx.userRole.update({
        where: { id: existing.id },
        data: { isActive: true, assignedBy: req.user!.id, assignedAt: new Date() },
      });
    } else {
      ur = await tx.userRole.create({
        data: { userId: id, role, departmentId: deptId, assignedBy: req.user!.id, isActive: true },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'ROLE_ASSIGNED',
        entityType: 'UserRole',
        entityId: ur.id,
        metadata: { role, departmentId: deptId },
      },
    });

    return ur;
  });

  return res.json(userRole);
}

export async function revokeRole(req: Request, res: Response) {
  const { id: targetUserId, roleId } = req.params;
  const existing = await prisma.userRole.findUnique({
    where: { id: roleId },
    include: { department: { select: { code: true, name: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'Role not found' });

  await prisma.$transaction(async (tx) => {
    await tx.userRole.update({ where: { id: roleId }, data: { isActive: false } });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'ROLE_REVOKED',
        entityType: 'UserRole',
        entityId: roleId,
        metadata: {
          targetUserId,
          role: existing.role,
          departmentId: existing.departmentId,
          departmentCode: existing.department?.code ?? null,
          departmentName: existing.department?.name ?? null,
        },
      },
    });
  });

  return res.json({ message: 'Role revoked' });
}

// ───── Bulk CSV Import ─────────────────────────────────────────────

// Institutional faculty-roster format. Password, department and role are NOT in
// the sheet: every row is imported as FACULTY into the admin-selected department
// with a shared default password (users change it on first login).
// The shared default password lives in utils/defaultPassword.ts (the backfill
// script reads the same value).

const TEMPLATE_CSV = `S.NO,EMP ID,Name of the Faculty,Designation,D.O.J,Mobile Number,E - Mail ID
1,FAC001,John Doe,Assistant Professor,15-08-2020,9876543210,john.doe@vnrvjiet.in
2,FAC002,Jane Smith,Associate Professor,01-06-2012,9876543211,jane.smith@vnrvjiet.in
`;

export function bulkImportTemplate(_req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=faculty-import-template.csv');
  return res.send(TEMPLATE_CSV);
}

// Column aliases → internal field. Headers are matched after lowercasing and
// stripping every non-alphanumeric char, so "E - Mail ID", "E-Mail ID" and
// "Email" all resolve to the same field. "S.NO" is ignored (row index only).
const COLUMN_ALIASES: Record<string, string[]> = {
  employeeCode: ['empid', 'employeeid', 'employeecode', 'empcode', 'empno'],
  name: ['nameofthefaculty', 'name', 'facultyname', 'nameoffaculty'],
  designation: ['designation', 'desig'],
  dateOfJoining: ['doj', 'dateofjoining', 'dateofjoin', 'joiningdate'],
  phone: ['mobilenumber', 'mobileno', 'mobile', 'phone', 'phoneno', 'contactnumber', 'contactno'],
  email: ['emailid', 'email', 'emailaddress', 'mail', 'mailid'],
};

const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

// Build { internalField: value } from a raw row keyed by original CSV headers.
function mapRow(raw: Record<string, any>): Record<string, string> {
  const normed: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) normed[normKey(k)] = String(v ?? '').trim();
  const out: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const hit = aliases.find((a) => normed[a] !== undefined && normed[a] !== '');
    out[field] = hit ? normed[hit] : '';
  }
  return out;
}

// Accept YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY (also '.' separators, single-digit
// day/month). Returns an ISO yyyy-mm-dd string, or null if unparseable.
function parseJoiningDate(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  let mt: RegExpMatchArray | null;
  if ((mt = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  } else if ((mt = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    d = +mt[1]; m = +mt[2]; y = +mt[3];
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime()) || dt.getUTCMonth() !== m - 1) return null; // rejects e.g. 31-02
  return dt.toISOString().slice(0, 10);
}

// Cells that identify the real header row — lets us skip title/section rows
// above it (e.g. a merged "CSE-TEACHING" banner) instead of assuming row 1.
const HEADER_HINTS = new Set<string>([
  ...COLUMN_ALIASES.employeeCode,
  ...COLUMN_ALIASES.email,
  ...COLUMN_ALIASES.name,
]);
function isHeaderRow(cells: string[]): boolean {
  return cells.some((c) => HEADER_HINTS.has(normKey(String(c ?? ''))));
}

interface ParsedRow {
  row: number;
  data: Record<string, string>;
  errors: string[];
}

function validateRow(rowNum: number, raw: any, seenCodes: Set<string>, seenEmails: Set<string>): ParsedRow {
  const data = mapRow(raw);
  const errors: string[] = [];

  if (!data.employeeCode) errors.push('Missing EMP ID');
  if (!data.name) errors.push('Missing Name of the Faculty');
  if (!data.email) errors.push('Missing E-Mail ID');

  // Email format
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Invalid email format');
  }

  // D.O.J optional; if present must parse. Normalise to ISO for insert.
  if (data.dateOfJoining) {
    const iso = parseJoiningDate(data.dateOfJoining);
    if (!iso) errors.push(`Invalid D.O.J "${data.dateOfJoining}" — use DD-MM-YYYY or YYYY-MM-DD`);
    else data.dateOfJoining = iso;
  }

  // Duplicate within CSV
  if (data.employeeCode) {
    const codeKey = data.employeeCode.toUpperCase();
    if (seenCodes.has(codeKey)) errors.push(`Duplicate EMP ID within CSV: ${data.employeeCode}`);
    seenCodes.add(codeKey);
  }
  if (data.email) {
    const emailKey = data.email.toLowerCase();
    if (seenEmails.has(emailKey)) errors.push(`Duplicate email within CSV: ${data.email}`);
    seenEmails.add(emailKey);
  }

  return { row: rowNum, data, errors };
}

const bulkImportSchema = z.object({
  csv: z.string().min(1, 'CSV content required'),
  departmentId: z.string().min(1, 'Target department is required'),
  dryRun: z.boolean().default(true),
});

export async function bulkImportUsers(req: Request, res: Response) {
  const { csv, departmentId, dryRun } = bulkImportSchema.parse(req.body);

  // Department is chosen once in the UI and applied to every row.
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, code: true, name: true },
  });
  if (!dept) return res.status(400).json({ error: 'Selected department not found' });

  // Parse as a raw matrix (no header assumption) so we can skip title/section
  // rows above the real header — e.g. Excel exports that start with a merged
  // "CSE-TEACHING" banner. relax_column_count tolerates ragged rows.
  let matrix: string[][];
  try {
    matrix = parseCsv(csv, { columns: false, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e: any) {
    return res.status(400).json({ error: `CSV parse error: ${e?.message ?? e}` });
  }

  const headerIdx = matrix.findIndex(isHeaderRow);
  if (headerIdx === -1) {
    return res.status(400).json({ error: 'Could not find a header row — expected columns like "EMP ID" and "E - Mail ID".' });
  }
  const headers = matrix[headerIdx];

  // Data rows follow the header; keep each row's real spreadsheet line number
  // (1-based) for error reporting, and drop fully-blank rows.
  const rawRows: { obj: Record<string, string>; rowNum: number }[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i];
    // Skip blank rows and mid-sheet section banners (e.g. "CSE-NON TEACHING"),
    // which have at most one non-empty cell — they are separators, not data.
    const nonEmpty = cells.filter((c) => String(c ?? '').trim() !== '').length;
    if (nonEmpty <= 1) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => { if (h) obj[h] = String(cells[j] ?? ''); });
    rawRows.push({ obj, rowNum: i + 1 });
  }

  if (rawRows.length === 0) return res.status(400).json({ error: 'CSV has no data rows' });
  if (rawRows.length > 500) return res.status(400).json({ error: 'CSV too large (max 500 rows)' });

  const existingUsers = await prisma.user.findMany({ select: { employeeCode: true, email: true } });
  const existingCodes = new Set(existingUsers.map((u) => u.employeeCode.toUpperCase()));
  const existingEmails = new Set(existingUsers.map((u) => u.email?.toLowerCase()).filter(Boolean) as string[]);

  // Parse + validate all rows
  const seenCodes = new Set<string>();
  const seenEmails = new Set<string>();
  const parsed = rawRows.map(({ obj, rowNum }) => validateRow(rowNum, obj, seenCodes, seenEmails));

  // Annotate dept + role for preview display, then check against existing DB
  for (const p of parsed) {
    p.data.department = dept.code;
    p.data.role = 'FACULTY';
    if (p.errors.length) continue;
    if (existingCodes.has(p.data.employeeCode.toUpperCase())) {
      p.errors.push(`EMP ID "${p.data.employeeCode}" already exists`);
    }
    if (p.data.email && existingEmails.has(p.data.email.toLowerCase())) {
      p.errors.push(`email "${p.data.email}" already exists`);
    }
  }

  const valid = parsed.filter((p) => p.errors.length === 0);
  const invalid = parsed.filter((p) => p.errors.length > 0);

  if (dryRun) {
    return res.json({
      dryRun: true,
      department: dept.name,
      defaultPassword: DEFAULT_IMPORT_PASSWORD,
      total: parsed.length,
      validCount: valid.length,
      invalidCount: invalid.length,
      preview: parsed.slice(0, 100), // cap preview size
    });
  }

  // Actually create users — all FACULTY in the selected dept, shared password.
  const created: any[] = [];
  const failed: any[] = [];
  const passwordHash = await bcrypt.hash(DEFAULT_IMPORT_PASSWORD, 12);

  for (const p of valid) {
    try {
      const dateOfJoining = p.data.dateOfJoining ? new Date(p.data.dateOfJoining) : null;

      await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            employeeCode: p.data.employeeCode,
            name: p.data.name,
            email: p.data.email,
            passwordHash,
            // Shared default password — must be replaced at first sign-in.
            mustChangePassword: true,
            designation: p.data.designation || null,
            departmentId: dept.id,
            dateOfJoining,
            phone: p.data.phone || null,
          },
        });

        await tx.userRole.create({
          data: {
            userId: newUser.id,
            role: RoleType.FACULTY,
            departmentId: null,
            assignedBy: req.user!.id,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: req.user!.id,
            action: 'USER_BULK_IMPORTED',
            entityType: 'User',
            entityId: newUser.id,
            metadata: { row: p.row, role: 'FACULTY', departmentId: dept.id },
          },
        });

        created.push({ row: p.row, employeeCode: newUser.employeeCode, id: newUser.id });
      });
    } catch (e: any) {
      failed.push({ row: p.row, employeeCode: p.data.employeeCode, error: e?.message ?? String(e) });
    }
  }

  return res.json({
    dryRun: false,
    department: dept.name,
    defaultPassword: DEFAULT_IMPORT_PASSWORD,
    total: parsed.length,
    createdCount: created.length,
    skippedCount: invalid.length,
    failedCount: failed.length,
    created,
    failed,
    skipped: invalid.map((p) => ({ row: p.row, employeeCode: p.data.employeeCode, errors: p.errors })),
  });
}
