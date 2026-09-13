import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../utils/prismaClient';
import { isUndeliverableAddress, enqueueEmail, sendEmail } from './emailService';
import { createFixture, type Fixture, type FixtureUser } from '../__tests__/helpers/fixtures';

// The mail worker must never hand a reserved test address to SMTP: the suites
// queue mail to their throwaway users, and the dev backend's worker polls every
// 30s — faster than a suite tears down.

describe('isUndeliverableAddress', () => {
  it('flags RFC 2606 / 6761 reserved names', () => {
    expect(isUndeliverableAddress('itgfac123@fixture.invalid')).toBe(true);
    expect(isUndeliverableAddress('a@b.test')).toBe(true);
    expect(isUndeliverableAddress('a@host.example')).toBe(true);
    expect(isUndeliverableAddress('a@localhost')).toBe(true);
    expect(isUndeliverableAddress('a@example.com')).toBe(true);
    expect(isUndeliverableAddress('a@mail.example.org')).toBe(true);
    expect(isUndeliverableAddress('A@FIXTURE.INVALID')).toBe(true);
  });

  it('flags an address with no domain at all', () => {
    expect(isUndeliverableAddress('')).toBe(true);
    expect(isUndeliverableAddress(null)).toBe(true);
    expect(isUndeliverableAddress('no-at-sign')).toBe(true);
  });

  it('leaves real addresses alone', () => {
    expect(isUndeliverableAddress('faculty@vnrvjiet.in')).toBe(false);
    expect(isUndeliverableAddress('someone+hod@gmail.com')).toBe(false);
    // Lookalikes are not the reserved names.
    expect(isUndeliverableAddress('a@notexample.com')).toBe(false);
    expect(isUndeliverableAddress('a@example.com.au')).toBe(false);
  });
});

// The same path the worker takes, end to end, against a fixture user: the row
// is closed out as failed before any transport is built, so nothing is sent.
let ready = false;
let fixture: Fixture | null = null;
let user: FixtureUser;

beforeAll(async () => {
  try {
    fixture = await createFixture('EML');
    user = await fixture.addUser({ name: 'FAC' });
    ready = Boolean(user.id);
  } catch { ready = false; }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('sendEmail on a reserved address', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });

  it('marks the row failed and never reaches SMTP', async () => {
    if (!ready) return;
    const id = await enqueueEmail({
      toUserId: user.id,
      template: 'hold_cleared',
      payload: { name: 'X', year: '2026-27', submissionNumber: 1, submissionId: 'none' },
    });
    expect(id).toBeTruthy();
    const queued = await prisma.emailNotification.findUniqueOrThrow({ where: { id: id! } });
    expect(queued.toEmail).toMatch(/\.invalid$/);

    await sendEmail(id!);
    const row = await prisma.emailNotification.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe('FAILED');
    expect(row.sentAt).toBeNull();
    expect(row.error).toMatch(/undeliverable/i);
  });
});
