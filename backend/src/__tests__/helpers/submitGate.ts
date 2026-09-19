import { vi } from 'vitest';
import request from 'supertest';
import app from '../../app';
import prisma from '../../utils/prismaClient';
import { signAccessToken } from '../../utils/jwt';
import { submitOpensAt } from '../../services/submitGate';

/**
 * Submit an appraisal as if the clock stood at `offsetMs` from the moment its
 * year's submission opens (end of the Q4 review window, else the academic year).
 *
 * The draft cannot be submitted before then (owner decision 2026-09-19), and a
 * suite must never move a real review window to get past that. Only this
 * process's Date is moved — nothing in the database changes — and a token is
 * minted at that instant because the login token would read as expired there.
 */
export async function submitAt(submissionId: string, ownerId: string, offsetMs: number) {
  const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: submissionId } });
  const opensAt = await submitOpensAt(sub.academicYearId);
  if (!opensAt) throw new Error('academic year not found');
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });

  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(opensAt.getTime() + offsetMs));
    const token = signAccessToken({ userId: owner.id, employeeCode: owner.employeeCode, tokenVersion: owner.tokenVersion });
    const res = await request(app).post(`/api/appraisals/${submissionId}/submit`).set('Authorization', `Bearer ${token}`);
    return { res, opensAt };
  } finally {
    vi.useRealTimers();
  }
}

/** Submit just after the gate opens. */
export const submitAfterGate = (submissionId: string, ownerId: string) => submitAt(submissionId, ownerId, 60_000);
