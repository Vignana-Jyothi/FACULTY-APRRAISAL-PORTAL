import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROW_CONTENT_FIELDS, ROW_MODELS, rowHasContent, dropBlankRows } from './blankRows';

// The form strips blank rows client-side too, from its own copy of this table
// (frontend AppraisalEditPage.tsx). The backend copy is the authority, but a
// section missing from EITHER side is a hole, so the two must stay identical —
// cat2ConfBookChapters was in the frontend's table and not in the backend's.
const FRONTEND_FORM = join(
  __dirname, '..', '..', '..', 'frontend', 'src', 'pages', 'faculty', 'AppraisalEditPage.tsx',
);

function frontendRowContentFields(): Record<string, string[]> {
  const src = readFileSync(FRONTEND_FORM, 'utf8');
  const block = src.match(/const ROW_CONTENT_FIELDS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error(`Could not find ROW_CONTENT_FIELDS in ${FRONTEND_FORM}`);

  const table: Record<string, string[]> = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*(\w+):\s*\[([^\]]*)\],/);
    if (m) table[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  // A parser that quietly returns nothing would turn this suite green while
  // asserting nothing — fail loudly instead.
  if (Object.keys(table).length === 0) throw new Error('Parsed an empty frontend table — the parser has rotted');
  return table;
}

describe('blankRows', () => {
  it("matches the form's copy of the table, section for section", () => {
    expect(frontendRowContentFields()).toEqual(ROW_CONTENT_FIELDS);
  });

  it('maps every content-field key to a Prisma model', () => {
    expect(Object.keys(ROW_MODELS).sort()).toEqual(Object.keys(ROW_CONTENT_FIELDS).sort());
  });

  it('treats a row with no alphanumeric identifier as blank', () => {
    expect(rowHasContent({ title: '' }, ['title'])).toBe(false);
    expect(rowHasContent({ title: '   ' }, ['title'])).toBe(false);
    expect(rowHasContent({ title: '.' }, ['title'])).toBe(false);
    expect(rowHasContent({ title: null }, ['title'])).toBe(false);
    expect(rowHasContent({}, ['title'])).toBe(false);
  });

  it('keeps a row when any identifier field has real content', () => {
    expect(rowHasContent({ title: 'A Study', journalName: '' }, ['title', 'journalName'])).toBe(true);
    expect(rowHasContent({ title: '', journalName: 'IEEE' }, ['title', 'journalName'])).toBe(true);
    expect(rowHasContent({ title: '7' }, ['title'])).toBe(true);
  });

  it('never treats a dropdown default or a number as content', () => {
    // nature/status are enums; a blank auto-row carries them pre-filled.
    expect(rowHasContent({ title: '', nature: 'Video', hours: 40 }, ['title'])).toBe(false);
  });

  it('keeps a row that has an uploaded proof even with no identifier text', () => {
    // The faculty may upload a proof before typing the title — the row (and so
    // the upload) must survive the save.
    const categories: any = {
      cat2Journals: [{ title: '', journalName: '', proofFile: '/uploads/file/abc.pdf' }],
      cat1EContent: [{ contentName: '', courseName: '', evidenceFile: '/uploads/file/ec.pdf' }],
      cat2Conferences: [{ title: '', conferenceName: '', indexProofFile: '/uploads/file/idx.pdf' }],
      cat2Patents: [{ title: '', proofFile: '' }], // no proof, no title -> dropped
    };
    dropBlankRows(categories);
    expect(categories.cat2Journals).toHaveLength(1);
    expect(categories.cat1EContent).toHaveLength(1);
    expect(categories.cat2Conferences).toHaveLength(1);
    expect(categories.cat2Patents).toHaveLength(0);
  });

  it('strips only the blank rows from a payload, in place', () => {
    const categories: any = {
      cat2Journals: [
        { title: 'Real paper', journalName: 'IEEE TSE' },
        { title: '', journalName: '' },
      ],
      cat5Memberships: [{ association: '' }],
      cat1Courses: [{ courseName: 'OS' }],
    };
    dropBlankRows(categories);
    expect(categories.cat2Journals).toHaveLength(1);
    expect(categories.cat2Journals[0].title).toBe('Real paper');
    expect(categories.cat5Memberships).toHaveLength(0);
    expect(categories.cat1Courses).toHaveLength(1);
  });

  it('ignores absent sections and a missing payload', () => {
    const categories: any = { cat2Journals: [{ title: 'X' }] };
    dropBlankRows(categories);
    expect(categories.cat5Awards).toBeUndefined();
    expect(() => dropBlankRows(undefined)).not.toThrow();
    expect(() => dropBlankRows(null)).not.toThrow();
  });
});
