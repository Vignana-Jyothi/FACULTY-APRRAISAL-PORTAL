# Tutorial — Using the Faculty Appraisal System

This guide walks through the portal from each role's point of view. It assumes
the app is running locally (backend on `:5000`, frontend on `:5173`) and seeded —
see [README.md](README.md) for setup.

Log in at **http://localhost:5173** with any [sample account](README.md#sample-accounts-after-seeding).

There are seven roles: **Faculty**, **Reviewer** (the department "incharge"),
**HoD**, **Dean**, **Principal**, **Scrutinizer** and **Special Scrutinizer**,
plus a maintenance-only **Admin**. A person can hold several at once — every
HoD, for instance, also files their own appraisal as Faculty. Your menu is built
from all the roles you hold.

---

## 1. Logging In & Account Basics

1. Open the portal. You'll see a split-screen login with the institute branding
   on the left and a sign-in card on the right.
2. Enter your **Employee Code** and **password** (e.g. `FAC11` / `faculty123`)
   and click **Sign In**.
3. You land on the dashboard for your roles.

### First sign-in on an account someone else created

If your account was created by an admin or came in through a bulk import, the
password was chosen for you, so the portal **makes you replace it before you can
use anything**. You are sent straight to **Profile**, and every page and API call
except your own profile and the password change is blocked until you're done.
Change the password as described below; you stay signed in afterwards.

### Forgot your password?

1. Click **Forgot password?** under the Sign In button.
2. Enter your employee code → an OTP is emailed to your registered address.
3. Enter the 6-digit OTP, choose a new password (min 8 characters), and confirm.
   You're returned to login.

### Changing your password (while logged in)

1. Go to **Profile**.
2. In **Change Password**, enter your current password and click **Send OTP to Email**.
3. Enter the OTP plus your new password, then **Update Password**. The new
   password must differ from the old one. All your other sessions are signed out.

---

## 2. Faculty Walkthrough

### The draft that lasts the year

There is **one appraisal per faculty per academic year**, and its draft stays
open from the moment you create it until the year's review is over. You are not
filing something every quarter — you keep adding to the same draft as the year
goes along.

1. On the **Dashboard**, pick the **academic year** in the top-right selector. If
   the submission window is open and you have no appraisal yet, a **New
   Appraisal** button appears.
2. Click **New Appraisal** → you enter the multi-step form.
3. Work through the steps:
   - **Leave & Info** — leave counts and any higher-qualification note.
   - **Teaching (Cat 1)** — courses, projects, e-content, ICT entries.
   - **Research (Cat 2)** — journals, conferences, patents, projects,
     consultancy, guidance, etc.
   - **Development (Cat 3)**, **Governance (Cat 4)**, **Supplementary (Cat 5)** —
     fill the relevant rows.
   - Attach a **proof file or link** on the rows that ask for one. Your
     department will check these during the year.
   - The form **auto-saves** as you go; you can leave and return as often as you like.
4. The **Preview & Submit** step shows your **self-appraisal score**
   (Categories 1–5, out of 500) with a per-category breakdown.

### Submitting

Submission opens **the day after the year's Q4 review window ends** (or the day
after the academic year's end date, if no Q4 window is configured). Until then
the **Submit** button tells you the exact date and you simply keep working. Once
you submit you get a confirmation email and the form becomes read-only.

> You never see Category 6 (core values) or the /550 grand total — those are the
> reviewer's assessment of you and are withheld from the API, the PDF, the emails
> and the screen. This holds even if you are a HoD reading your own appraisal.

### Proofs the department rejects

- If a proof is rejected **while your appraisal is still a draft**, you get an
  email and the proof is marked. Nothing is held and you are not red-listed —
  just replace the file or link in the form.
- If a proof is rejected **after you submit**, the appraisal goes on **HOLD**,
  you are red-listed, and you replace the proof from the submission's view page
  before the correction deadline. Miss the deadline (14 days) and the rows behind
  that proof score nothing so the review can go ahead — and you stay red-listed.

### After review

- When your HoD approves or rejects, you get an email. The **View** page then
  shows the reviewer's **per-category marks for Categories 1–5 side by side with
  your own**, the **reviewed total out of 500**, and the **comments**. Download a
  **PDF** copy from the same page.
- Once your HoD issues your **annual feedback**, it appears on the same page
  (strengths, improvements, growth targets, with your targets and standing), and
  you can download it as a PDF.
- During the year you also receive a **quarterly feedback email** at the end of
  each review window: your Category 1–5 remarks, your targets and what counts
  towards them so far. It never mentions your cadre, tier or eligibility.
- If the dean or principal **unlocks** your submission, you're notified and can
  edit and resubmit.

---

## 3. Reviewer (Incharge) Walkthrough

A Reviewer is the department **incharge**, scoped to one department. In practice
the job is verifying evidence, though the review form itself is open to you as
well — with two exceptions: the **draft review** during the year is the HoD's
alone, and so are the department's **reports** and the **annual feedback**.

1. **Uploads** lists every faculty in your department with their proof counts.
   Open one to see each attached file or link.
2. **Verify** a proof you are satisfied with, or **Reject** it with a reason. On
   a draft this just marks the proof and emails the faculty; on a submitted
   appraisal it puts the appraisal on HOLD and red-lists the faculty.
3. **Drafts in progress** shows the department's open drafts so you can check
   proofs as they arrive during the year. Verified proofs carry into the
   submission.
4. **Red List** shows who is currently held or red-listed and why, and is where a
   hold is cleared once the evidence is in order.
5. **Review Queue** lists the department's submitted appraisals. You can open and
   complete a review here (see the HoD walkthrough below); you cannot review your
   own appraisal.

---

## 4. HoD Walkthrough

Everything the incharge can do, plus the review itself, the department's
reports, and the annual feedback.

### During the year: drafts and draft reviews

1. Open **Drafts in progress**. Each row is a faculty's open draft for the year.
2. Click through to see their entries and verify their proofs as they come in.
3. You can also note a **draft review** — provisional Category 1–5 overrides,
   Category 6 core values and a comment — and click **Save draft review**. It is
   never shown to the faculty and nothing is final; it simply **pre-fills your
   real review** once they submit.

### After submission: the review

1. Open **Review Queue** — every submitted appraisal in your department.
2. Click **Review** on a row. The left panel is the faculty's self-appraisal and
   score; the right panel is your review form. Where you noted a draft review,
   the marks and comment are already filled in, and the page says so.
3. Adjust the **Category 1–5** marks where you disagree with the computed score,
   and score **Category 6 — Core Values** (five fields, 10 each, 50 total).
4. Write **per-category comments** and an overall comment. These are released to
   the faculty only on approval or rejection.
5. Choose **Approve** or **Reject** and submit.
   - **Approval is blocked while any proof is still unverified** — the error
     names the sections that are outstanding. Verify them (or wait for the
     deadline to void them) and try again.
   - On approval, the appraisal moves to **FINAL_REVIEW** if the dean has
     assigned scrutinizers to it, and the faculty is emailed when the last step
     completes.

### Annual feedback

On the review page's **Feedback** section, the system auto-drafts strengths,
improvements and growth targets from the faculty's standing. Edit it, **Save**,
then **Issue** it — only then does the faculty see it. Both of you can download
it as a PDF.

### Department reports and tracking

- **Reports** — reviewed appraisals for your department, with summary tiles and a
  faculty-wise table. Every score column names its scale: **Self /500**,
  **Reviewed /500**, **Core values (Cat 6) /50**, **Grand total /550**. The HoD
  decision column is separate from the appraisal's status, because an approval
  that went on to final review is still waiting on a scrutinizer. **Export
  Excel** downloads the same columns. The criteria comparison lets you pick any
  category total or subsection and rank the department on it.
- **Tracking** — each faculty's cadre, criteria standing and tier for the year.

---

## 5. Dean Walkthrough

The dean owns configuration and tier allocation, sees the institute out of 500,
and decides who scrutinises what.

- **Dashboard** (`/oversight`) — the institute-wide status board: where
  submissions stand, which scrutinizer sign-offs are outstanding, how far
  tier/eligibility allocation has got, how many faculty are red-listed, and the
  average **reviewed /500**.
- **Academic Years** — create a year and open or close its submission window.
- **Review Windows** — the four quarterly windows per year. See below; this is
  the page that controls mass email.
- **Cadre Targets** and **Cadre Tiers** — the per-cadre eligibility targets and
  tier thresholds the tracking engine measures against.
- **Departments** — create, edit, deactivate and reactivate. Deactivating never
  erases anything.
- **Appraisals** — every submission institute-wide, filterable by year, status
  and department. From here you **assign scrutinizers** (any number, from any
  department), **unlock** a submission back to the faculty, or **reopen a review**
  for the HoD to redo. Reopening requires a reason.
- **Tracking** — set each faculty's tier and eligibility by hand, and run a
  quarterly snapshot.
- **Institute Reports** / **Department Reports** — institute-wide, with a
  department picker. Your rows come back **without** Category 6 and the /550;
  those belong to the principal and to each faculty's own HoD.

### Arming a review window (this is the mass-email control)

The daily 09:00 job fires on a window's end date. It takes the criteria snapshot
either way, but it **only emails faculty for a window you have armed**:

1. Open **Review Windows** and click **Preview** on the window. It tells you
   exactly how many faculty would be mailed and who.
2. If that is right, click **Arm**. The window now emails when its end date comes.
3. An **unarmed** window that comes due snapshots and **holds** the mail. It
   shows as held, and you send it with **Release** when you're ready.
4. **Disarm** takes the arming back. Changing a window's dates disarms it
   automatically.

> Never arm or release a window against real faculty to try it out — that is a
> real bulk send to real `@vnrvjiet.in` addresses.

### Running a snapshot by hand

On **Tracking**, **Run quarterly snapshot** is a **dry run first**: it reports
the quarter, the number of faculty and how many would be emailed, and only sends
when you confirm.

---

## 6. Principal Walkthrough

The principal sees everything the dean does, and is the only role that sees
Category 6 and the /550 grand total across the whole institute.

- **Dashboard** (`/oversight`) — as the dean's, but the average is the **/550**.
- **All Appraisals** — every submission institute-wide, with the full review.
- **Institute Reports** / **Department Reports** — with the **Core values (Cat
  6) /50** and **Grand total /550** columns filled in.
- **Red List** — institute-wide.
- The dean's configuration pages are open to the principal too.

---

## 7. Scrutinizer Walkthrough

Scrutinizers are the cross-department layer above the HoD. Holding the role does
not by itself give you sight of anything: the dean assigns you to a specific
submission, and only then does it appear.

1. **Final Review** in the menu shows the submissions assigned to you (with a
   count when any are waiting).
2. Open one. You see the appraisal and the HoD's review **out of 500** —
   Category 6 and the /550 are not yours to see.
3. Record **Approve** or **Reject** with a comment. **One approval from any
   assigned scrutinizer finalises the appraisal**; a rejection puts it back for
   correction.

A **Special Scrutinizer** does all of the above and can also set tiers on the
**Tracking** page.

---

## 8. Admin Walkthrough

The admin account is **maintenance only** — accounts, roles, the email queue and
the audit log. It holds no appraisal content and cannot see anyone's scores.

### Manage users

1. **Users** lists everyone with search and pagination. Deleting a user
   **deactivates** them — nothing is erased, and they can be reactivated.
2. **New User** — fill the form and pick a **Department** from the existing list.
   (Departments themselves are the dean's to create.) The account is flagged to
   change its password at first sign-in.
3. **Import CSV** — bulk-create faculty:
   - Click **Import CSV → Download template**.
   - Fill the roster columns: `S.NO, EMP ID, Name of the Faculty, Designation,
     D.O.J, Mobile Number, E - Mail ID`. **EMP ID, Name and E-Mail ID** are
     required; `D.O.J` accepts `DD-MM-YYYY` or `YYYY-MM-DD`. `.xlsx` works too
     (first sheet).
   - Pick the target **department** — it applies to every row — and **Validate**.
     Every row is checked and the header row is auto-detected, so title banners
     and section rows are skipped.
   - Review the green/red preview, then **Import N valid rows**. All rows import
     as **Faculty** with the shared default password, flagged to change it at
     first sign-in.
4. **Roles** (per user) — assign FACULTY / HOD / REVIEWER / ADMIN / PRINCIPAL /
   DEAN / SCRUTINIZER / SPECIAL_SCRUTINIZER. **HoD and Reviewer require a
   department** and are rejected for any other one; the institute-wide roles are
   rejected **with** a department. Revoke a role with the trash icon. All changes
   are audit-logged.
5. **Incharges** — the same REVIEWER role presented as first-class department
   incharges: pick a person, pick their department, done.

### Emails and audit

- **Emails** — the notification queue: filter by status (Pending/Sent/Failed),
  **Retry** failed sends, or manually trigger **Draft Reminders** / **Reviewer
  Digest**.
- **Audit Log** — a paginated, filterable record of every sensitive action. Click
  a row to expand its JSON metadata.

---

## 9. Common Tasks Cheat-Sheet

| I want to… | Go to |
|------------|-------|
| Start this year's appraisal | Faculty → Dashboard → New Appraisal |
| Keep adding to it during the year | Faculty → Dashboard → the open draft |
| See my score | Appraisal → Preview step, or the View page after submit |
| Find out when I can submit | The draft's Preview & Submit step |
| Download my appraisal or feedback as PDF | The View page → **PDF** button |
| Replace a rejected proof | The appraisal form (draft) or the View page (submitted) |
| Check a faculty's proofs | Reviewer/HoD → Uploads, or Drafts in progress |
| Note provisional marks during the year | HoD → Drafts in progress → Save draft review |
| Review a submitted appraisal | HoD → Review Queue |
| Find out why approval is blocked | The error on Submit Review names the unverified proofs |
| Issue a faculty's annual feedback | HoD → Review page → Feedback → Save → Issue |
| Rank my department on one criterion | HoD → Reports → criteria comparison |
| Assign scrutinizers to a submission | Dean → Appraisals → Assign |
| Sign off as a scrutinizer | Final Review |
| Set a faculty's tier | Dean / Special Scrutinizer → Tracking |
| Send the quarterly feedback mail | Dean → Review Windows → Preview → Arm (or Release) |
| Open/close submission for a year | Dean → Academic Years |
| Re-open a locked submission | Dean → Appraisals → Unlock |
| Send a review back to the HoD | Dean → Appraisals → Reopen review (reason required) |
| Add many faculty at once | Admin → Users → Import CSV |
| Make someone an incharge | Admin → Incharges |
| Make someone a dean/scrutinizer | Admin → Users → Roles |
| Check why an email didn't arrive | Admin → Emails (filter Failed → Retry) |
| See who changed what | Admin → Audit Log |

---

## 10. Tips & Notes

- **Auto-save**: the appraisal form saves automatically; a manual **Save Draft**
  is also available. A save that would empty a draft with real content in it is
  refused, so a bad connection cannot wipe your year's work.
- **Blank rows score nothing.** A row you added but never filled in is dropped
  before it is saved and earns no marks.
- **Submission window**: if **New Appraisal** is missing, either you already have
  an appraisal for that year, or the year's window is closed — ask the dean.
- **Email in dev**: with `EMAIL_DISABLED=true`, no real email is sent, but you
  can still see queued messages (and OTP codes in the backend console) at
  Admin → Emails.
- **Draft reminders** arrive at most once a week, and only after a full week
  without edits.
- **PDF first load**: the very first PDF export after a server start is slower (a
  few seconds) while the headless browser warms up; later ones are fast.
- **Mobile**: on narrow screens the sidebar collapses into a hamburger menu in
  the top bar.
