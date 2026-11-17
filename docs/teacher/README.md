# KDTC TEACHER ATTENDANCE — ครูผู้สอน

Status: code updated on GitHub. NOT YET deployed or verified on the real Apps Script project. Legacy activity scanner remains unchanged.

## User requirements
- Login with the SAME user ID and password/PIN as Home Room (such as U004), without storing or setting another PIN.
- Scan attendance for a course and class session.
- Teacher may correct any scanned/recorded result to PRESENT (มา), LATE (สาย), ABSENT (ขาด), or LEAVE (ลา), during or after the session.
- Every correction requires a reason and writes an audit entry with teacher, timestamp, before/after status. It does not erase the original scan timestamp.
- Missing approved students become ABSENT on session close. LEAVE does not count as PRESENT or ABSENT; the default attendance percentage is (PRESENT+LATE)/closed sessions.

## Authorized project targets
Teacher Apps Script project: https://script.google.com/u/0/home/projects/1uXJoXc2Fp--ozK5nKQcGaqeVYW5TxXIXmfOLk_WkeKHO68MPoeRxwU18/edit
New data Sheet: https://docs.google.com/spreadsheets/d/19fSg7LPl-7u14Owomg1hifsJ6kQgafXcoAEYxGVOwaI/edit
Read-only source: https://docs.google.com/spreadsheets/d/18VmMX7nrE9jKEBbL9qsasS5s-sYeJRhfclRb0llIOvw/edit
GitHub UI: docs/teacher/ .
Backend: appsscript/TeacherAttendance.gs and appsscript/TeacherBridge.html .

## Important privacy gate
The NEW destination Sheet was still shared as ANYONE WITH LINK = WRITER on last check. Change this to Restricted before importing student data. The Apps Script installer attempts to enforce private sharing and refuses to import unless it is private.

## Installation
1. In the NEW Apps Script project, inspect/backup files before editing; add TeacherAttendance.gs and an HTML file named TeacherBridge. Do NOT overwrite the old activity project's code.
2. Set Script Properties (server-side, NEVER in GitHub):
   TEACHER_SHEET_ID = new destination Sheet ID
   SOURCE_SHEET_ID = read-only CARE NEXUS source Sheet ID
   BOOTSTRAP_ADMIN_ID = T004 (only local permission, not a password)
   HOMEROOM_VERIFY_URL = authenticated existing Home Room verifier Apps Script /exec
   HOMEROOM_SHARED_SECRET = strong random secret (minimum 24 chars)
3. Run setupFromSource_ using a temporary editor-only wrapper function once after privacy is restricted. Inspect imported counts (source reference: 388 students, 36 teachers, 195 courses/classes, 2196 suggested enrollments); all SUGGESTED rosters require teacher approval.
4. Delete the privileged temporary wrapper before deploying.
5. Home Room must expose a private server-side verifier that uses its EXISTING login function and supports:
   POST JSON action=KDTC_VERIFY_HOMEROOM_V1, userId=U004, credential=entered Home Room password/PIN, sharedSecret=server side secret
   reply JSON {ok:true,userId:"U004",active:true,kind:"TEACHER"} after REAL validation.
   Failed validation replies ok:false and never reveals password/hash.
   It is NOT verified that Home Room currently exposes this action. Safely integrate after inspecting the REAL login code and existing doPost; never replace current routes.
6. Deploy this teacher project's Web App, run it as owner with required scopes; use its distinct /exec URL in the GitHub Pages teacher UI. All subsequent teacher calls have server-side access checks. GitHub Pages host may need Settings > Pages > main:/docs enabled.

## Tests
- One Home Room identity matched to a new Teachers.HomeRoomUserID (e.g. U004 -> T004), without copying old password/hash.
- Teacher A cannot view/modify a course of teacher B.
- Approval required for suggested enrollment.
- On-time, late, overdue scan; duplicate scan, duplicate manual edit.
- Correction from scanned มา -> ลา and ลา -> สาย, in OPEN and CLOSED sessions, with reason.
- Close session marks only unrecorded approved students ABSENT, preserving leave.
- Report displays มา/สาย/ขาด/ลา, calculates percentage from CLOSED sessions.
- Original activity App Script and Sheets untouched.

## NOT YET COMPLETE
No Apps Script API connector is exposed for direct editor mutation here, so the actual supplied project has not yet received or deployed the new code. Home Room verifier API contract must be confirmed/implemented in its existing backend. Do not represent credential reuse or live scanning as working until both are verified.
