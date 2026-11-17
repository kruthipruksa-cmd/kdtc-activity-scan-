# KDTC ครูผู้สอน — Apps Script เป็นระบบหลัก / GitHub เฉพาะกล้องสแกน

## สถานะ

**SOURCE READY / NOT DEPLOYED**: โค้ดครบสำหรับระบบต้นแบบ Dashboard และส่งต่อแล้วบน GitHub แต่ยังไม่ได้ติดตั้งลง Apps Script ที่ผู้ใช้ระบุ และยังไม่ได้ทดสอบจาก Web App จริงหรือยืนยันว่าตัวตรวจรหัส Home Room มีบริการพร้อมใช้

ใช้หน้าตากรม–ทอง–ขาวตามแบบที่อนุมัติ และแสดงบนมือถือ/คอมพิวเตอร์

## โครงสร้างที่กำหนด

- **ระบบหลัก Apps Script:** \`appsscript/TeacherAttendance.gs\` + \`appsscript/TeacherDashboard.gs\` + ไฟล์ HTML ชื่อ \`TeacherApp\` ที่มีเนื้อหาจาก \`appsscript/TeacherApp.html\`
- **GitHub Pages สแกนเท่านั้น:** \`docs/teacher/scan.html\` (หน้ากล้อง QR / เครื่องอ่าน USB / ป้อนรหัส) ปลายทาง \`docs/teacher/index.html\` นำมาหน้าสแกนนี้
- **ฐานข้อมูลใหม่:** https://docs.google.com/spreadsheets/d/19fSg7LPl-7u14Owomg1hifsJ6kQgafXcoAEYxGVOwaI/edit
- **แหล่งข้อมูลวิชา/รายชื่อ อ่านอย่างเดียว:** https://docs.google.com/spreadsheets/d/18VmMX7nrE9jKEBbL9qsasS5s-sYeJRhfclRb0llIOvw/edit
- **ต้นทางระบบสแกน อ่านอย่างเดียว (เปลี่ยนล่าสุด):** https://docs.google.com/spreadsheets/d/1b0WamSgNr9oDvu84qst0jOTGByk0t9DWNxmTGyqB1wY/edit — แท็บ `TEACHERS` สำหรับบัญชี/บทบาท และ `STUDENTS` สำหรับรหัสนักเรียน/QR `code4` และ `qrToken`
- **Apps Script โครงการใหม่:** https://script.google.com/u/0/home/projects/1uXJoXc2Fp--ozK5nKQcGaqeVYW5TxXIXmfOLk_WkeKHO68MPoeRxwU18/edit

GitHub ไม่จัดการบัญชี ไม่มี dashboard ไม่มีฐานข้อมูล ไม่บันทึกนักเรียน ไม่รับ PIN และไม่รับ access token โดยหน้า Apps Script รับรหัส QR ผ่าน \`postMessage\` แล้วเรียก \`google.script.run.scanStudent(...)\` ด้วยเซสชันครูที่ผ่านการยืนยัน

## สิทธิ์ผู้ใช้เดิม

- `TEACHERS.roles` มี `ADVISOR` หรือ `TEACHER` → ครูผู้สอน เห็นและแก้ข้อมูลเฉพาะวิชาที่ได้รับมอบหมาย
- `TEACHERS.roles` มี `ADMIN` และ UserID อยู่ใน allowlist → ผู้ดูแล (ตรวจสอบแล้วมี U004, U035, U036) เห็นสรุปทั้งวิทยาลัยและส่งเรื่องให้ผู้บริหาร
- ผู้บริหาร U001/U002 ที่ได้รับอนุญาตใน allowlist และตรวจตำแหน่งผู้อำนวยการจาก `TEACHERS.department` → เห็นรายงานทั้งวิทยาลัย แต่แก้ผลเช็กชื่อ/ส่งเรื่องไม่ได้
- ไม่สร้าง PIN ใหม่ ไม่คัดลอก Salt/Hash หรือรหัสผ่านจากชีทเดิมลงชีทใหม่หรือ GitHub
- ต้องเชื่อม **Home Room verifier ที่ตรวจรหัสจริงบนเซิร์ฟเวอร์เดิม** ก่อนจึงจะล็อกอินได้ (fail-closed) ไม่ยอมรับชื่อ/บทบาท/สถานะจาก browser
- ตัวอย่างที่ตรวจจากต้นทาง: U004 Teacher, U035/U036 Admin, U001/U002 Activity

## ความเสี่ยงที่แสดง

นับ **จำนวนคาบเรียนจริงที่ปิดแล้ว** (Sessions.Periods, ค่าเริ่มต้น 1) ไม่ใช่จำนวนวันที่ต้องเข้าแถว:
- ปกติ: ขาดต่ำกว่า 10%
- เสี่ยง: ขาดตั้งแต่ 10% แต่ต่ำกว่า 20%
- มีปัญหา: ขาดตั้งแต่ 20% ขึ้นไป (รวม 20% เพื่อไม่มีช่วงว่าง)
- หากยังไม่มีคาบที่ปิดจริง: ยังไม่มีข้อมูล ไม่แสดงว่าผ่าน
- เวลาเรียน% = (มา + สาย) / คาบที่ปิดแล้วทั้งหมด × 100
- คาบลาแสดงแยก ไม่รวมในคาบมาและไม่รวมคาบขาด (ต้องกำหนดนโยบายสถานศึกษาถ้าจะหัก/ยกเว้นจากเกณฑ์ในอนาคต)

Dashboard: แยกรายครู รายห้อง รายแผนก และรายวิชา; รวมผู้เรียนที่เสี่ยงตามรหัสนักเรียนเมื่อสรุปข้ามหลายวิชา

## ส่งต่อนักเรียน

1. ครูเลือกวิชา → ตรวจดูผลร้อยละรายคน → หลังชื่อนักเรียนสถานะ **มีปัญหา** (ขาด ≥20%) มีปุ่ม **ส่งต่อ**
2. ครูระบุรายละเอียดเหตุผล (10 ตัวอักษรขึ้นไป) → บันทึกใน **Referrals** สถานะ NEW (กันส่งซ้ำรายการค้าง)
3. ผู้ดูแลเปิดเมนู **นักเรียนส่งต่อ** → รับเรื่องเป็น IN_REVIEW หรือกด **ส่งผู้บริหาร** เปลี่ยนสถานะ FORWARDED → ส่งสถานะ/เหตุผลเข้าสู่ Dashboard ที่ผู้บริหารอ่านได้
4. ผู้บริหารดูภาพรวมทั้งวิทยาลัย และอ่านรายการส่งต่อได้เหมือนผู้ดูแล (read-only)
5. ประวัติทุกการเปลี่ยนสถานะอยู่ใน **ReferralActions** และ **AuditLog**
6. ระบบส่งต่อในขั้นนี้หมายถึง **ภายในแอป** ยังไม่ได้ส่งอีเมลหรือ LINE ให้ผู้บริหารอัตโนมัติ การพิมพ์ PDF ใช้ปุ่มของเบราว์เซอร์

## โครงสร้างชีทปลายทาง

เดิม 9 แท็บ: Teachers, Students, Courses, Enrollments, Sessions, Attendance, AuditLog, Settings, Guide

เพิ่มเฉพาะโครงสร้าง (ไม่มีข้อมูลนักเรียน):
- **Referrals** (รายการที่ครูส่งต่อ + สถานะผู้ดูแล)
- **ReferralActions** (ติดตามการดำเนินการ)
- **Sessions.Periods** จำนวนคาบในครั้งที่สอน (1–9)

ระบบใช้ชีทปลายทางสำหรับการเขียนทั้งหมด และไม่แก้ไขข้อมูลกิจกรรมในชีทเก่า

## ขั้นตอนติดตั้งและสิ่งที่ต้องตรวจสอบก่อนใช้จริง

1. **สำคัญมาก:** ตรวจชีทสแกนใหม่พบ **anyone with link = Reader** (ซึ่งยังไม่เหมาะเพราะมี `pinSalt` และ `pinHash`) และชีทปลายทางเช็กชื่อใหม่เป็น **anyone with link = Writer** ต้องตั้ง **ทั้งสองชีทเป็น Restricted** ก่อนใช้งานจริง โดยตรวจผลกระทบกับระบบเดิมก่อน โค้ดไม่ได้เปลี่ยนสิทธิ์ต้นทางเอง และจะหยุดให้บริการหากยังแชร์สาธารณะ
2. ใน Apps Script โครงการใหม่ ให้ตรวจไฟล์เดิมและสำรองก่อน (ไม่เขียนทับฟังก์ชันที่ยังใช้งาน) เพิ่ม \`TeacherAttendance.gs\`, \`TeacherDashboard.gs\`, \`TeacherApp.html\` โดยไฟล์ HTML ใน Apps Script ต้องชื่อ **TeacherApp**. หากมี \`doGet\` เดิมให้ตรวจและรวมอย่างระมัดระวัง ไม่ใช้ \`TeacherBridge.html\` แล้ว
3. Project Settings → Script Properties กำหนดค่า (แยกเก็บบนเซิร์ฟเวอร์):
   - \`TEACHER_SHEET_ID\`: ID ชีทใหม่
   - \`SOURCE_SHEET_ID\`: ID ชีท CARE NEXUS ที่มี ImportTeachers, TeacherRegistration, Students, Courses, Enrollments, ImportCourseReview
   - `SCAN_SOURCE_SHEET_ID`: `1b0WamSgNr9oDvu84qst0jOTGByk0t9DWNxmTGyqB1wY` — แท็บ `TEACHERS` (teacherId, name, roles, department, active), `STUDENTS` (studentId, code4, qrToken)
   - `ADMIN_USER_IDS`: ค่าเริ่มต้น `U004,U035,U036` ต้องมี `ADMIN` ใน `TEACHERS.roles` ด้วย
   - `EXECUTIVE_USER_IDS`: ค่าเริ่มต้น `U001,U002` ต้องตรวจบทบาทผู้อำนวยการ/รองผู้อำนวยการจาก `TEACHERS.department` ด้วย
   - `BOOTSTRAP_ADMIN_ID`: `T004` (ใช้ระบุเจ้าของภายในชีทใหม่ **ไม่ใช่สิทธิ์หลัก**; สิทธิ์ Admin ตรวจจาก `TEACHERS` ต้นทางร่วมกับ allowlist)
   - \`HOMEROOM_VERIFY_URL\`: URL /exec ของ Home Room backend ที่ได้ตรวจสอบแล้วว่าเปิดการตรวจรหัสแบบ server-to-server
   - \`HOMEROOM_SHARED_SECRET\`: สุ่มค่าแข็งแรง 24 ตัวอักษรขึ้นไป เก็บเฉพาะ server ทั้งสองฝั่ง
4. **จำเป็นต้องตรวจโค้ด Home Room เดิมก่อน:** ปลายทางจะได้รับ JSON POST action=\`KDTC_VERIFY_HOMEROOM_V1\`, userId, credential, sharedSecret; ต้องเรียกฟังก์ชันตรวจรหัสจริงเดิม, ตรวจ sharedSecret, และคืน \`{ok:true,userId:"U004",active:true}\` เฉพาะเมื่อผ่านการพิสูจน์จริง **ยังไม่สามารถยืนยันว่า Home Room ปัจจุบันรองรับ API นี้** หากยังไม่มีต้องเพิ่ม adapter ฝั่ง Home Room อย่างปลอดภัยหลัง backup และตรวจโค้ด doPost เดิม
5. เมื่อตั้งสิทธิ์ Restricted และตั้ง Properties สำเร็จ ให้สร้าง temporary editor-only file \`InstallOnce.gs\` ที่มี:
   \`\`\`js
   function runTeacherImportOnce() {
     Logger.log(JSON.stringify(setupFromSource_()));
   }
   \`\`\`
6. Run จาก Apps Script editor ด้วยบัญชีเจ้าของแล้วตรวจจำนวนรายชื่อจากต้นทาง: 388 นักเรียน, 36 ครู, 195 วิชา/กลุ่มเรียน, 2196 รายการลงทะเบียนสถานะ SUGGESTED จากการตรวจล่าสุด **ทุกวิชาต้องตรวจและยืนยันก่อนใช้**
7. **ลบไฟล์ InstallOnce.gs** ก่อน Deploy เพราะไม่ควรเปิดให้ผู้ใช้เว็บเรียกฟังก์ชันติดตั้งได้
8. Deploy **Apps Script ใหม่** เป็น Web App โดย Execute as Me และ access ตามที่จำเป็น; ใช้ Web App URL ใหม่สำหรับระบบครูผู้สอน ไม่แก้ลิงก์ระบบสแกนกิจกรรมเดิม
9. เปิด Apps Script URL หลัก → Login Home Room → ทดสอบความถูกต้องสิทธิ์ครู/แอดมิน/ผู้บริหาร
10. GitHub Pages \`main:/docs\` ต้องเปิดอยู่ เพื่อให้ iframe scan URL ใช้ได้ \`https://kruthipruksa-cmd.github.io/kdtc-activity-scan-/teacher/scan.html\`
11. ทดสอบกล้องมือถือจริง โดยคำนึงถึงเบราว์เซอร์ที่บล็อกกล้องใน iframe; มีปุ่มเปิดหน้าต่างกล้องแยกและช่องกรอก/เครื่องอ่านเป็นทางเลือก
12. ก่อน Deploy Production ตรวจ: สแกนซ้ำ, มา/สาย/ขาด/ลา, เปลี่ยนสถานะย้อนหลัง, 1–9 คาบ, คิดร้อยละ, 10–19%/≥20%, การส่งต่อ, การส่งต่อถึงผู้บริหาร, ใครเห็นอะไร, ข้อมูลกิจกรรมเดิมไม่เปลี่ยนแปลง

### ข้อจำกัด

- ยังไม่ได้เข้าถึง/แก้ไข/Deploy โครงการ Apps Script จริงจากช่องทางนี้ จึงยังไม่ใช่ระบบ Production ที่ผ่านทดสอบแล้ว
- ข้อมูลส่วนบุคคลยังไม่ได้นำเข้าชีทใหม่ เพราะแชร์เป็น anyone writer
- การใช้รหัส Home Room เดียวกันต้องมีบริการตรวจรหัสของระบบเดิมที่ยืนยันได้จริง
- ตรวจ `STUDENTS` ในชีทสแกนใหม่พบ 388 นักเรียน และ `code4` ไม่ซ้ำกันในข้อมูลที่ตรวจ ณ 17 พ.ย. 2569; installer จะตรวจซ้ำก่อนจับคู่ `ScanCode` ในชีทใหม่ และ QR แบบ `K|code4|qrToken` จะถูกตรวจ token กับต้นทางแบบอ่านอย่างเดียว