# KDTC Mobile Scanner

หน้าเครื่องสแกนมือถือสร้างแล้วใน `docs/` รองรับกล้อง QR เสียง รหัส/เครื่องอ่าน การจำเครื่อง เรียกคืนเครื่องเดิม ขออนุมัติเครื่อง และคิวรอส่ง

ผู้ดูแล จอแม่ กิจกรรม และ Google Sheets ใช้ Apps Script เดิม

## เปิดใช้งาน
1. ช่องเชื่อมต่อ ScannerBridge และ doGet บันทึกใน Apps Script เดิมแล้ว เจ้าของต้องดีพลอยเวอร์ชันใหม่
2. เปิด [Settings → Pages](https://github.com/kruthipruksa-cmd/kdtc-activity-scan-/settings/pages) เลือก Deploy from a branch → main → /docs → Save
3. หลัง GitHub เผยแพร่ เปิด https://kruthipruksa-cmd.github.io/kdtc-activity-scan-/
4. เรียกคืนเครื่องด้วยรหัสจากผู้ดูแล หรือขออนุมัติเครื่องใหม่ จากนั้นเลือกกิจกรรมและเปิดกล้อง

ดูรายละเอียด [SETUP.md](SETUP.md)

## สถานะตรวจสอบ
ทดสอบซอร์สและการกรอง origin/source/nonce/รายชื่อฟังก์ชันของช่องเชื่อมต่อแล้ว ยังต้องทดสอบการส่งผลจริงหลังดีพลอย และกล้อง/เสียงบนมือถือจริง ไม่ใช่การยืนยันว่าเว็บออนไลน์แล้ว
