import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../utils/prismaClient';
import { RoleType } from '@prisma/client';
import { PROOF_DIR as UPLOAD_ROOT } from '../utils/uploadPaths';
import { SEES_ALL, hasAnyRole } from '../utils/roles';

// Ceiling on how many files one account may hold, so an authenticated user
// cannot fill the disk by uploading indefinitely. Generous vs a real faculty's
// proof count (a few dozen), tight enough to bound abuse.
const MAX_FILES_PER_USER = 500;

// Verify a file's leading bytes match its declared MIME. Covers the four
// allowed types (see middleware/upload ALLOWED_MIME).
async function magicMatches(filePath: string, mime: string): Promise<boolean> {
  let fd: fs.promises.FileHandle | null = null;
  try {
    fd = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fd.read(buf, 0, 12, 0);
    if (bytesRead < 4) return false;
    switch (mime) {
      case 'application/pdf':
        return buf.toString('latin1', 0, 4) === '%PDF';
      case 'image/png':
        return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      case 'image/jpeg':
        return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      case 'image/webp':
        return buf.toString('latin1', 0, 4) === 'RIFF' && bytesRead >= 12 && buf.toString('latin1', 8, 12) === 'WEBP';
      default:
        return false;
    }
  } catch {
    return false;
  } finally {
    await fd?.close().catch(() => {});
  }
}

export async function uploadProof(req: Request, res: Response) {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const owned = await prisma.uploadedFile.count({ where: { uploaderId: req.user!.id } });
  if (owned >= MAX_FILES_PER_USER) {
    await fs.promises.unlink(path.join(UPLOAD_ROOT, file.filename)).catch(() => {});
    return res.status(400).json({ error: 'Upload limit reached — delete old files before adding more.' });
  }

  // The multer fileFilter trusts the client-declared MIME. Verify the bytes on
  // disk actually match, so a script renamed with Content-Type: application/pdf
  // cannot be stored (defence in depth alongside nosniff on serve).
  if (!(await magicMatches(path.join(UPLOAD_ROOT, file.filename), file.mimetype))) {
    await fs.promises.unlink(path.join(UPLOAD_ROOT, file.filename)).catch(() => {});
    return res.status(400).json({ error: 'File content does not match its type (PDF/PNG/JPEG/WEBP only).' });
  }

  // Record ownership so downloads can be authorized.
  await prisma.uploadedFile.create({
    data: {
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploaderId: req.user!.id,
    },
  });

  const url = `/uploads/file/${file.filename}`;
  return res.status(201).json({
    url,
    originalName: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
  });
}

// True if `user` may access a file uploaded by `uploaderId` (in `uploaderDept`).
export function canAccess(
  user: NonNullable<Request['user']>,
  uploaderId: string,
  uploaderDept: string | null,
): boolean {
  if (user.id === uploaderId) return true;
  // A proof file is appraisal content: institute-wide sight of it belongs to
  // the principal, not to the maintenance account (2026-09-18 role rework).
  if (hasAnyRole(user, SEES_ALL)) return true;
  // HoD / Reviewer may view files of faculty in their own department(s).
  return user.roles.some(
    (r) =>
      (r.role === RoleType.HOD || r.role === RoleType.REVIEWER) &&
      r.departmentId != null &&
      r.departmentId === uploaderDept,
  );
}

// Authenticated, ownership-checked file stream. Replaces unguarded static serving.
export async function serveProof(req: Request, res: Response) {
  const filename = path.basename(req.params.filename); // strip any path components
  const record = await prisma.uploadedFile.findUnique({
    where: { filename },
    include: { uploader: { select: { departmentId: true } } },
  });
  if (!record) return res.status(404).json({ error: 'File not found' });

  if (!canAccess(req.user!, record.uploaderId, record.uploader.departmentId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const target = path.join(UPLOAD_ROOT, filename);
  if (!target.startsWith(UPLOAD_ROOT + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'File missing' });

  res.setHeader('Content-Type', record.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${record.originalName.replace(/["\r\n]/g, '')}"`);
  return res.sendFile(target);
}

export async function deleteProof(req: Request, res: Response) {
  const { url } = req.body as { url?: string };
  if (!url) return res.status(400).json({ error: 'Invalid file url' });

  const filename = path.basename(url);
  const record = await prisma.uploadedFile.findUnique({ where: { filename } });
  if (!record) return res.json({ message: 'Deleted' }); // already gone / unknown

  // Only the uploader or an admin may delete.
  const isAdmin = req.user!.roles.some((r) => r.role === RoleType.ADMIN);
  if (record.uploaderId !== req.user!.id && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const target = path.join(UPLOAD_ROOT, filename);
  if (target.startsWith(UPLOAD_ROOT + path.sep)) {
    await fs.promises.unlink(target).catch(() => {}); // best-effort
  }
  await prisma.uploadedFile.delete({ where: { filename } }).catch(() => {});
  return res.json({ message: 'Deleted' });
}
