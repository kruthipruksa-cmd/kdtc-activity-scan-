# KDTC TEACHER ATTENDANCE — Production Acceptance Tests

**Status: Code checked on GitHub; Apps Script live deployment not yet tested.** Perform these checks on a private staging copy before production, using real authorized teacher/administrator accounts. Do not put test PINs or personal data in this repository.

## Fast UX / expected performance targets (not measured yet)

| Scenario | Target to check on representative school network |
|---|---|
| Warm Dashboard, unchanged data | p95 under 2 seconds |
| Fresh Dashboard after a write | p95 under 6 seconds |
| Consecutive QR scans, 200 students | p95 acknowledgment under 2 seconds, no lost rows |
| Duplicate scan of same student/session | Single attendance row, returns duplicate indicator |
| Login / denied authorization | No unauthorized access under any account |
| Cache invalidation | Report shows corrections after next load (without waiting TTL) |

Record real measured times on mobile and desktop. These are **targets**, not verified performance claims.

## Data and integrity tests

- Preserve old activity/Home Room Apps Script and Sheets unchanged. Verify a before/after backup and row count.
- New attendance Sheet must be Restricted; CARE NEXUS scanner source must not be publicly readable because it has credential hashes. Coordinate restrictions with system owner first.
- Reconcile teacher IDs U004/U035/U036 (admins where authorized), U001/U002 (executive read-only where authorized), other teachers limited to assigned courses.
- Never copy source PINs, pinSalt or pinHash to GitHub or attendance Sheet.
- Verify student IDs and code4 are unique and original QR token K|code4|qrToken matches actual format before production.
- Confirm Source sheet is read-only; every attendance write targets new Sheet only.
- Session.Periods and ScheduleID, TeachingSchedule, ReferralFollowUps schema match header definitions.

## Attendance and analytics tests

1. Teacher approves proposed roster; no attendance allowed for unapproved learners.
2. Open 1-, 2- and 3-period sessions and confirm totals use periods, not calendar days.
3. Scan before on-time cutoff, after cutoff, and after late cutoff; verify status and Thai timezone.
4. Scan twice and simultaneously; verify 1 UniqueKey per SessionID+StudentID.
5. Change มา→ลา, ขาด→มา and มา→สาย in open and closed sessions. Check original ScanAt preserved and every correction in AuditLog.
6. Close session with missing learners; only missing approved enrollments become ABSENT. Verify re-close idempotence.
7. Grade boundaries: 9.99% NORMAL, 10% RISK, 19.99% RISK, 20% PROBLEM; 7–9.99% early warning.
8. A student missing 2 consecutive *periods* is flagged before the 10% threshold, if that situation arises.
9. No closed sessions => NO_DATA, not NORMAL.

## Schedule automation tests

- Teacher adds/edits/disables schedule without deleting prior sessions.
- AutoOpen and AutoClose default FALSE until explicitly enabled; verify time-driven trigger installed once by project owner.
- Trigger called twice for same day/schedule => no duplicate session.
- AutoClose only if explicitly enabled; missing students marked ABSENT, valid scan results preserved.
- If session remains OPEN for 180+ minutes, home Dashboard shows overdue warning.
- Bangkok timezone and multiple classes per teacher; weekends only if schedule exists.

## Student 360 / case management tests

- Teacher sees student only for assigned approved courses, admin/executive see all.
- Student 360 shows course-by-course statuses and session history.
- After name, teacher can forward PROBLEM learner once per open case with a reason.
- Admin receives NEW, reviews IN_REVIEW, forwards FORWARDED, records FOLLOW_UP, resolves RESOLVED.
- Calls/parent contact/counseling/home visits and next-check dates append to ReferralFollowUps; overdue cases clearly visible.
- Every state change appears in ReferralActions and AuditLog.
- Executive sees all cases read-only, cannot alter attendance, schedule, cases or followups.

## Export / accessibility / scan bridge tests

- Native Apps Script Web App displays navy–gold UI and all extra pages without console errors.
- Clicking Scan opens GitHub QR camera embedded full-screen with no second login. Returning stops camera but keeps session open.
- Browser permission-denied scenario offers manual ID and optional separate window fallback; no hidden domain claims.
- QR postMessage validates sender origin/window and nonce. Only student scan code crosses browser frame; PIN and server session token never sent to GitHub.
- Export executive date-scoped/department-filtered CSV opens in Excel, columns remain intact, formula-injection text not evaluated. Browser Print saves PDF and includes correct period.
- Test ordinary smartphone, tablet, Windows Chrome, and iOS Safari.

## Deployment completion checklist

- Verify Home Room credential verification API against actual project, not an assumed endpoint.
- Install all 5 .gs and both .html files from the latest GitHub main branch into the NEW Apps Script project; inspect/backup existing files first.
- Set required Script Properties securely; do not commit secret.
- Verify new Source and Sheet access Restricted; import and check counts/teacher roster approval.
- Install scheduled trigger only after manual scheduling passes tests.
- Test real scan and correction, rollback backup ready, then deploy correct Web App project. Verify URL via actual browser.
- Do not mark Production Ready until test evidence and deployment URL are recorded.
