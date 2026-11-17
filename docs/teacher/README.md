# KDTC Teacher Attendance • separate subsystem

This is an **isolated** course-attendance app added to the existing GitHub repository. It does not change the existing scanner source or database.

## Files

- \`docs/teacher/\` — static mobile/desktop interface, served free via GitHub Pages.
- \`appsscript/TeacherAttendance.gs\` — new standalone Google Apps Script backend.
- \`appsscript/TeacherBridge.html\` — iframe RPC bridge for static GitHub Pages UI.

Do not add student records, teacher PINs, salts, hashes or private Google Sheets URLs to a public GitHub repository.

## Setup (owner must perform once)

1. Use the **new, separate Google Sheet**. Its nine headers/tabs have already been prepared: Teachers, Students, Courses, Enrollments, Sessions, Attendance, AuditLog, Settings, Guide.
2. The new sheet was found to be shared as **anyone with link can edit**. **Restrict sharing to owner/authorized staff before import or real use.** The installer also attempts to enforce Google Drive PRIVATE access and aborts if it cannot verify this.
3. In the new sheet, choose Extensions → Apps Script. This creates an independent script project bound to the new sheet. Keep the legacy activity Apps Script untouched.
4. Replace the default Code.gs content with \`TeacherAttendance.gs\` and add an HTML file named \`TeacherBridge\` containing the code from \`TeacherBridge.html\`.
5. Apps Script Project Settings → Script Properties: set **TEACHER_SHEET_ID**, **SOURCE_SHEET_ID**, **BOOTSTRAP_ADMIN_ID** (e.g. T004), and **BOOTSTRAP_ADMIN_PIN** (a newly chosen 8–12 digit number, not a PIN from the activity system). IDs are supplied privately by the owner and should not be committed to GitHub.
6. Create a temporary file \`InstallOnce.gs\` in that Apps Script project:
   \`\`\`js
   function runTeacherInstallOnce() {
     const result = setupFromSource_();
     const admin = bootstrapAdmin_();
     Logger.log(JSON.stringify({result,admin}));
   }
   \`\`\`
7. **Run \`runTeacherInstallOnce\` from the Apps Script editor** and grant the owner permissions. Confirm data counts (388 students, 36 teachers, 195 courses, 2,196 suggested enrolments based on the 17 Nov 2026 source). Check the destination sheet access is **Restricted** and that original source tabs were not changed.
8. **DELETE the temporary \`InstallOnce.gs\` file** before deployment: it is a privileged initializer that must not be callable through the live web app. Clear the bootstrap PIN property; the private bootstrap function also clears it upon success.
9. Deploy → New deployment → Web app → Execute as **Me** → Who has access **Anyone**. Use a separate URL from the original activity scanner. This web app is publicly reachable, but all attendance methods require server-verified teacher authentication.
10. Use the generated **/exec** URL in \`docs/teacher/\` → connection settings. No access token or PIN is stored in the GitHub files. PIN is kept only transiently in the browser form, and authenticated session tokens are stored in sessionStorage.
11. On GitHub Settings → Pages set branch \`main\`, folder \`/docs\` if this is not already enabled. Then visit \`https://kruthipruksa-cmd.github.io/kdtc-activity-scan-/teacher/\`.
12. Log in as the bootstrap admin and set each teacher's new PIN. Teachers must review and approve the suggested course roster before they can open a class session. Test manual student ID, camera QR, duplicate scan, late scan, overdue scan, close-to-absent, and reporting.

### Status mapping and operational rules

- \`Students.StudentID\`: full student ID. QR input may also match the optional \`ScanCode\` **only when unique**. The existing four-digit activity QR code cannot be assumed unique.
- \`Enrollments.Status=SUGGESTED\` is preserved from the source; there is **no automatic approval**.
- A session is created per course/class, with server timestamps in \`Asia/Bangkok\`. Defaults: on time within 10 minutes, late until 25 minutes, then absent.
- Duplicate scans do not append a second attendance row. The \`UniqueKey\` is session ID + student ID.
- Closing a session generates \`ABSENT\` records for students with approved enrollment and no previous record.
- Percentages are calculated from **closed sessions** only.
- Changes of attendance after closing require an explanation and are written to AuditLog.
- Each teacher accesses only assigned courses; admin can see all courses. New PINs are unrelated to the old system.

### Adding the menu to the existing activity dashboard

Once tested, add **one role-protected link/button** to the legacy web app home menu, without changing its attendance tables or any current scanner route.

\`\`\`html
<a href="https://kruthipruksa-cmd.github.io/kdtc-activity-scan-/teacher/"
   target="_blank" rel="noopener noreferrer">ครูผู้สอน</a>
\`\`\`

This repository **does not deploy or modify the legacy Apps Script app**. A developer with authorized Apps Script project access must make and test that one menu-only change.

### Scope and limitations

- This is a code-complete starting implementation, **not yet production-deployed or end-to-end tested**.
- Web App URL, current GitHub Pages publishing, teacher provisioning and secure data import require owner-side actions.
- GitHub Pages is public static hosting; do not embed student/teacher data or Google credentials in it.
- Backup source data before any future system migration. Keep all original source sheets read-only.
