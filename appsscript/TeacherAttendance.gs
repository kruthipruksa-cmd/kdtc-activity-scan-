/**
 * KDTC TEACHER ATTENDANCE - separate standalone Google Apps Script project.
 * No writes to the legacy activity database. Requires Script Properties:
 * TEACHER_SHEET_ID, SOURCE_SHEET_ID, SCAN_SOURCE_SHEET_ID, HOMEROOM_VERIFY_URL, HOMEROOM_SHARED_SECRET.
 * Home Room remains the authority for credentials. Never store/copy teacher PINs here.
 * Run setupFromSource_ in the Apps Script editor only after restricting Sheet sharing.
 */
const TZ_='Asia/Bangkok';
const HEADERS_={
 Teachers:['TeacherID','Name','Department','Email','Role','Active','Salt','PinHash','FailedAttempts','LockedUntil','AuthVersion','PinChangedAt','HomeRoomUserID'],
 Students:['StudentID','Name','ClassID','Department','Level','EnrollStatus','ScanCode','SourceUpdatedAt'],
 Courses:['CourseID','CourseCode','Name','ClassID','TeacherID','TeacherEmail','Active','SourceReviewStatus','CreatedAt','Term'],
 Enrollments:['CourseID','StudentID','Status','UpdatedAt','ApprovedBy'],
 Sessions:['SessionID','CourseID','SessionDate','StartAt','PresentUntil','LateUntil','Status','TeacherID','ClosedAt','Topic','Periods','ScheduleID'],
 Attendance:['AttendanceID','UniqueKey','SessionID','CourseID','StudentID','Status','ScanAt','InputMode','TeacherID','UpdatedAt','Note'],
 AuditLog:['EventID','At','ActorTeacherID','Action','Entity','Details'],
 StudentAddRequests:['RequestID','StudentID','Name','ClassID','Department','Level','CourseID','TeacherID','CreatedAt','Status','ReviewedBy','ReviewedAt','Note'],
  Settings:['Key','Value','Description'],
 TeachingSchedule:['ScheduleID','CourseID','TeacherID','DayOfWeek','StartTime','EndTime','Periods','Room','Topic','AutoOpen','AutoClose','Active','UpdatedAt'],
 ReferralFollowUps:['FollowUpID','ReferralID','StudentID','ActorID','ActionAt','ActionType','Note','NextCheckDate','Status','UpdatedAt'],
 Referrals:['ReferralID','StudentID','StudentName','CourseID','CourseCode','TeacherID','Room','Department','AbsencePct','AttendancePct','RiskLevel','Reason','CreatedAt','Status','AdminReviewedBy','AdminReviewedAt','AdminNote','ExecutiveSentAt','ExecutiveSentBy','LastUpdatedAt'],
 ReferralActions:['ActionID','ReferralID','At','ActorID','Role','Action','FromStatus','ToStatus','Note']
};
function prop_(k){return PropertiesService.getScriptProperties().getProperty(k)||''}
function db_(){const id=prop_('TEACHER_SHEET_ID');if(!id)throw Error('ยังไม่ได้ตั้ง TEACHER_SHEET_ID');return SpreadsheetApp.openById(id)}
function tab_(name){const s=db_().getSheetByName(name);if(!s)throw Error('ไม่พบแท็บ '+name);return s}
function rows_(name){
 const s=tab_(name),size=s.getLastRow();if(size<2)return [];
 const h=HEADERS_[name],data=s.getRange(2,1,size-1,h.length).getValues();
 return data.map((row,i)=>{const obj={_row:i+2};h.forEach((key,j)=>obj[key]=String(row[j]===null?'':row[j]).trim());return obj}).filter(r=>r[h[0]]);
}
function now_(){return new Date().toISOString()}
function lock_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(20000))throw Error('ระบบกำลังบันทึกข้อมูล กรุณาลองอีกครั้ง');try{return fn()}finally{lock.releaseLock()}}
function hash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(x=>('0'+(x&255).toString(16)).slice(-2)).join('')}
function rand_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'')}
function truth_(s){return String(s).toUpperCase()==='TRUE'}
function teacher_(id){return rows_('Teachers').find(t=>t.TeacherID===id)}
/** KDTC CARE NEXUS scanner spreadsheet is READ ONLY: TEACHERS role/activation. */
function requireRestrictedSheets_(){
 // Both source account data (including PIN hashes) and new attendance data must be private.
 for(const [label,id] of [['ข้อมูลผู้ใช้ระบบสแกน',prop_('SCAN_SOURCE_SHEET_ID')],['ข้อมูลครูผู้สอน',prop_('TEACHER_SHEET_ID')]]){
   if(!id)throw Error('ยังไม่ตั้งค่าชีท '+label);
   if(DriveApp.getFileById(id).getSharingAccess()!==DriveApp.Access.PRIVATE)
     throw Error('เพื่อความปลอดภัย ต้องตั้งค่าการแชร์เป็น จำกัด (Restricted) ในชีท '+label+' ก่อนใช้งาน');
 }
}
function allowedRoleId_(id,settingName,defaults){
 return (prop_(settingName)||defaults).split(',').map(x=>x.trim().toUpperCase()).filter(Boolean).includes(id);
}
function activityUser_(id){
 requireRestrictedSheets_();
 const sheetId=prop_('SCAN_SOURCE_SHEET_ID');
 if(!sheetId)throw Error('ยังไม่ได้กำหนด SCAN_SOURCE_SHEET_ID');
 const sh=SpreadsheetApp.openById(sheetId).getSheetByName('TEACHERS');
 if(!sh)throw Error('ไม่พบแท็บ TEACHERS ในฐานข้อมูล KDTC CARE NEXUS');
 const last=sh.getLastRow();if(last<2)throw Error('ไม่มีข้อมูลครูใน TEACHERS');
 // Read A:E and active I only. DO NOT fetch pinSalt/pinHash from F:H.
 const basic=sh.getRange(2,1,last-1,5).getDisplayValues();
 const active=sh.getRange(2,9,last-1,1).getDisplayValues();
 const idx=basic.findIndex(row=>String(row[0]).trim().toUpperCase()===id);
 if(idx<0||String(active[idx][0]).trim().toUpperCase()!=='TRUE')throw Error('ไม่พบบัญชีครูที่เปิดสิทธิ์');
 const hit=basic[idx],roles=String(hit[2]||'').toUpperCase().split(',').map(x=>x.trim());
 let role='';
 if(roles.includes('ADMIN')&&allowedRoleId_(id,'ADMIN_USER_IDS','U004,U035,U036'))role='ADMIN';
 else if(allowedRoleId_(id,'EXECUTIVE_USER_IDS','U001,U002')
         &&(/ผู้อำนวยการ/.test(String(hit[4]))))role='EXECUTIVE';
 else if(roles.includes('ADVISOR')||roles.includes('TEACHER'))role='TEACHER';
 if(!role)throw Error('สิทธิ์ผู้ใช้งานยังไม่ได้รับอนุญาตในระบบครูผู้สอน');
 return {id,name:String(hit[1]),role,department:String(hit[4]||'')};
}
function actor_(id){
 return cachedActor_(id,()=>{
  const legacy=activityUser_(id);
  const t=rows_('Teachers').find(x=>x.HomeRoomUserID===id&&truth_(x.Active));
  if(legacy.role==='TEACHER'&&!t)throw Error('กรุณาให้ผู้ดูแลจับคู่ครูผู้สอนกับบัญชี Home Room');
  return {TeacherID:t?t.TeacherID:id,UserID:id,Name:legacy.name,Role:legacy.role,
   Department:legacy.department,AuthVersion:t?t.AuthVersion:'1'};
 });
}
function auth_(token){
 if(typeof token!=='string'||!token||token.length>150)throw Error('กรุณาเข้าสู่ระบบ');
 const cache=CacheService.getScriptCache().get('TA_'+hash_(token));
 if(!cache)throw Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
 const [userId,version]=cache.split('|'),actor=actor_(userId);
 if(actor.AuthVersion!==version)throw Error('สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบใหม่');
 return actor;
}
function readOnlyExecutive_(actor){
 if(actor.Role==='EXECUTIVE')throw Error('ผู้บริหารมีสิทธิ์ดูรายงาน ไม่สามารถเปลี่ยนผลเช็กชื่อได้');
}
function checkCourse_(token,id){
 const t=auth_(token),course=rows_('Courses').find(c=>c.CourseID===String(id));
 if(!course||!truth_(course.Active))throw Error('ไม่พบรายวิชาที่เปิดใช้');
 if(!['ADMIN','EXECUTIVE'].includes(t.Role)&&course.TeacherID!==t.TeacherID)throw Error('ไม่มีสิทธิ์รายวิชานี้');
 return {t,course};
}
function checkSession_(token,id){
 const session=rows_('Sessions').find(s=>s.SessionID===String(id));
 if(!session)throw Error('ไม่พบคาบเรียน');
 const access=checkCourse_(token,session.CourseID);
 return {session,t:access.t,course:access.course};
}
function audit_(who,action,entity,detail){tab_('AuditLog').appendRow([rand_(),now_(),who,action,entity,JSON.stringify(detail||{})])}
function setting_(key,defaultValue){const row=rows_('Settings').find(r=>r.Key===key);return row?row.Value:String(defaultValue)}
function setSetting_(key,val){
 const s=tab_('Settings'),r=rows_('Settings').find(x=>x.Key===key);
 if(r)s.getRange(r._row,2).setValue(String(val));
 else s.appendRow([key,String(val),'']);
}
function publicStatus(){return {ready:setting_('IMPORT_STATUS','')==='READY',authReady:!!(prop_('HOMEROOM_VERIFY_URL')&&prop_('HOMEROOM_SHARED_SECRET')),timeZone:TZ_,version:'1.1.0'}}
function include_(name){
 if(!['TeacherExtras','TeacherSelfService'].includes(name))throw Error('ไม่ได้รับอนุญาตให้แทรกไฟล์นี้');
 return HtmlService.createHtmlOutputFromFile(name).getContent();
}
function doGet(e){
 return HtmlService.createTemplateFromFile('TeacherApp').evaluate()
  .setTitle('KDTC ครูผู้สอน — สรุปเวลาเรียน')
  .addMetaTag('viewport','width=device-width, initial-scale=1');
}
/**
 * TRUSTED SERVER-TO-SERVER ADAPTER: Home Room must expose a private verifier
 * using the user's existing authentication code. This subsystem never accepts
 * a caller-provided role or a locally stored password hash.
 * Home Room verifier's JSON response contract:
 * {ok:true, userId:"U004", active:true, kind:"TEACHER"}
 * Failed validation MUST return ok:false and never echo credentials.
 */
function verifyHomeRoom_(userId,credential){
 const endpoint=prop_('HOMEROOM_VERIFY_URL'),secret=prop_('HOMEROOM_SHARED_SECRET');
 if(!endpoint||!secret||secret.length<24)throw Error('ยังไม่เชื่อมระบบยืนยันตัวตน Home Room กรุณาให้ผู้ดูแลตั้งค่า');
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint))throw Error('ลิงก์ตรวจสอบ Home Room ไม่ถูกต้อง');
 const response=UrlFetchApp.fetch(endpoint,{
  method:'post',contentType:'application/json',muteHttpExceptions:true,followRedirects:true,
  payload:JSON.stringify({action:'KDTC_VERIFY_HOMEROOM_V1',userId,credential,sharedSecret:secret})
 });
 if(response.getResponseCode()!==200)throw Error('ตรวจสอบบัญชี Home Room ไม่สำเร็จ');
 let result;try{result=JSON.parse(response.getContentText())}catch(_){throw Error('ระบบ Home Room ไม่ตอบผลตรวจสอบที่ถูกต้อง')}
 if(result.ok!==true||result.userId!==userId||result.active!==true)throw Error('รหัสผู้ใช้หรือรหัสผ่าน Home Room ไม่ถูกต้อง');
 return result;
}
function login(id,pin){
 id=String(id||'').trim().toUpperCase();pin=String(pin||'');
 if(!/^U\d{3,4}$/.test(id)||!pin||pin.length>128)throw Error('กรุณาใช้บัญชีเดียวกับ Home Room');
 const actor=actor_(id); // Verify ACTIVE and role against original activity Users.
 const local=rows_('Teachers').find(x=>x.HomeRoomUserID===id);
 if(local&&local.LockedUntil&&Date.parse(local.LockedUntil)>Date.now())throw Error('บัญชีถูกระงับชั่วคราว');
 verifyHomeRoom_(id,pin); // Must validate credentials against original server, FAIL CLOSED.
 if(local){
  lock_(()=>tab_('Teachers').getRange(local._row,9,1,2).setValues([[0,'']]));
 }
 const token=rand_();
 CacheService.getScriptCache().put('TA_'+hash_(token),id+'|'+actor.AuthVersion,21600);
 audit_(id,'HOMEROOM_LOGIN',id,{role:actor.Role});
 return {token,teacherId:actor.TeacherID,userId:id,name:actor.Name,role:actor.Role};
}
function me(token){
 const t=auth_(token);
 return {teacherId:t.TeacherID,userId:t.UserID,name:t.Name,role:t.Role};
}
function logout(token){if(typeof token==='string'&&token)CacheService.getScriptCache().remove('TA_'+hash_(token));return {ok:true}}
function getCourses(token){
 const t=auth_(token);
 const enrollment=rows_('Enrollments');
 return rows_('Courses').filter(c=>truth_(c.Active)&&(['ADMIN','EXECUTIVE'].includes(t.Role)||c.TeacherID===t.TeacherID)).map(c=>{
   const rr=enrollment.filter(x=>x.CourseID===c.CourseID);
   return {courseId:c.CourseID,code:c.CourseCode,name:c.Name,classId:c.ClassID,teacherId:c.TeacherID,approved:rr.filter(x=>x.Status==='APPROVED').length,suggested:rr.filter(x=>x.Status==='SUGGESTED').length,review:c.SourceReviewStatus};
 });
}
function getRoster(token,courseId){
 checkCourse_(token,courseId);
 const rr=rows_('Enrollments').filter(x=>x.CourseID===courseId);
 const studentMap=new Map(rows_('Students').map(s=>[s.StudentID,s]));
 return rr.map(r=>{const s=studentMap.get(r.StudentID);return {studentId:r.StudentID,name:s?s.Name:'ไม่พบข้อมูล',classId:s?s.ClassID:'',status:r.Status}}).sort((a,b)=>a.studentId.localeCompare(b.studentId));
}
function approveRoster(token,courseId){
 return lock_(()=>{
  const {t}=checkCourse_(token,courseId);readOnlyExecutive_(t);
  const s=tab_('Enrollments'),rows=rows_('Enrollments');
  const candidates=rows.filter(x=>x.CourseID===courseId&&x.Status==='SUGGESTED');
  if(!candidates.length)return {approved:0};
  const studentIds=new Set(rows_('Students').filter(x=>x.EnrollStatus==='ACTIVE').map(x=>x.StudentID));
  let count=0;
  candidates.forEach(x=>{if(!studentIds.has(x.StudentID))return;
   s.getRange(x._row,3,1,3).setValues([['APPROVED',now_(),t.TeacherID]]);count++;
  });
  audit_(t.TeacherID,'APPROVE_ROSTER',courseId,{count});invalidateAnalytics_();invalidateScanIndexes_();return {approved:count};
 });
}
function startSession(token,courseId,topic,periods){
 return lock_(()=>{
  const {t}=checkCourse_(token,courseId);readOnlyExecutive_(t);
  if(!rows_('Enrollments').some(x=>x.CourseID===courseId&&x.Status==='APPROVED'))throw Error('ต้องตรวจสอบและยืนยันรายชื่อนักเรียนก่อน');
  const active=rows_('Sessions').find(s=>s.CourseID===courseId&&s.Status==='OPEN');
  if(active)return sessionView_(active);
  const p=Math.max(0,Math.min(120,Number(setting_('PRESENT_MINUTES',10))||10));
  const l=Math.max(p+1,Math.min(240,Number(setting_('LATE_MINUTES',25))||25));
  const time=new Date(),id=rand_();
  const n=Number(periods||1);if(!Number.isInteger(n)||n<1||n>9)throw Error('จำนวนคาบต้องอยู่ระหว่าง 1 ถึง 9');
  const row=[id,courseId,Utilities.formatDate(time,TZ_,'yyyy-MM-dd'),time.toISOString(),new Date(time.getTime()+p*60000).toISOString(),new Date(time.getTime()+l*60000).toISOString(),'OPEN',t.TeacherID,'',String(topic||'').slice(0,200),n,''];
  tab_('Sessions').appendRow(row);
  audit_(t.TeacherID,'START_SESSION',id,{courseId});invalidateAnalytics_();return sessionView_(Object.fromEntries(HEADERS_.Sessions.map((h,i)=>[h,row[i]])));
 });
}
function sessionView_(s){return {sessionId:s.SessionID,courseId:s.CourseID,date:s.SessionDate,startAt:s.StartAt,presentUntil:s.PresentUntil,lateUntil:s.LateUntil,status:s.Status,topic:s.Topic,periods:Math.max(1,Number(s.Periods)||1),scheduleId:s.ScheduleID||''}}
function getOpenSession(token,courseId){checkCourse_(token,courseId);const x=rows_('Sessions').find(r=>r.CourseID===courseId&&r.Status==='OPEN');return x?sessionView_(x):null}
function scannerCode_(raw){
 const value=String(raw||'').trim();
 const match=value.toUpperCase().match(/^K\|(\d{4})\|([A-Z0-9]{6,20})$/);
 if(!match)return value.replace(/^STUDENT:/i,'').trim();
 // Validate the original activity QR's code + token against read-only SCAN source.
 const sh=SpreadsheetApp.openById(prop_('SCAN_SOURCE_SHEET_ID')).getSheetByName('STUDENTS');
 if(!sh)throw Error('ไม่พบแท็บ STUDENTS ของระบบสแกน');
 const rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,8).getDisplayValues():[];
 const valid=rows.filter(r=>String(r[1])===match[1]&&String(r[7]).toUpperCase()===match[2]&&String(r[6]).toUpperCase()==='TRUE');
 if(valid.length!==1)throw Error('QR ไม่ถูกต้องหรือบัญชีนักเรียนไม่เปิดใช้');
 return String(valid[0][0]); // full StudentID
}
function scanStudent(token,sessionId,raw){
 // Keep the critical section short: one indexed lookup + one atomic append.
 // Session validation and deduplication both occur under the same script lock.
 return lock_(()=>{
  const {session,t,course}=checkSession_(token,sessionId);readOnlyExecutive_(t);
  if(session.Status!=='OPEN')throw Error('คาบเรียนปิดแล้ว');
  const student=lookupFastScan_(raw,course.CourseID);
  const key=sessionId+'|'+student.id,existing=findAttendanceByKey_(key);
  if(existing)return {ok:true,duplicate:true,name:student.name,classId:student.classId,
    status:existing.status,scanAt:existing.scanAt};
  const now=new Date(),epoch=now.getTime();
  const status=epoch<=Date.parse(session.PresentUntil)?'PRESENT':
   epoch<=Date.parse(session.LateUntil)?'LATE':'ABSENT';
  tab_('Attendance').appendRow([rand_(),key,sessionId,course.CourseID,student.id,
    status,now.toISOString(),'QR_OR_MANUAL',t.TeacherID,now.toISOString(),'']);
  // The active scan card is immediate. Closed-only analytics cache need not refresh for an OPEN session.
  return {ok:true,duplicate:false,name:student.name,classId:student.classId,status,scanAt:now.toISOString()};
 });
}
function closeSession(token,sessionId){
 return lock_(()=>{
  const {session,t,course}=checkSession_(token,sessionId);readOnlyExecutive_(t);
  if(session.Status==='CLOSED')return {alreadyClosed:true,...getSessionStats_(sessionId)};
  if(session.Status!=='OPEN')throw Error('สถานะคาบไม่ถูกต้อง');
  const approved=rows_('Enrollments').filter(e=>e.CourseID===course.CourseID&&e.Status==='APPROVED');
  const existing=new Set(rows_('Attendance').filter(x=>x.SessionID===sessionId).map(x=>x.StudentID));
  const at=now_(),newRows=[];
  for(const en of approved){if(existing.has(en.StudentID))continue;newRows.push([rand_(),sessionId+'|'+en.StudentID,sessionId,course.CourseID,en.StudentID,'ABSENT',at,'AUTO_CLOSE',t.TeacherID,at,'ไม่พบการสแกน'])}
  if(newRows.length){const sh=tab_('Attendance');sh.getRange(sh.getLastRow()+1,1,newRows.length,11).setValues(newRows)}
  const sh=tab_('Sessions');sh.getRange(session._row,7).setValue('CLOSED');sh.getRange(session._row,9).setValue(at);
  audit_(t.TeacherID,'CLOSE_SESSION',sessionId,{absentAdded:newRows.length});invalidateAnalytics_();
  return {alreadyClosed:false,...getSessionStats_(sessionId)};
 });
}
function getSessionStats_(sessionId){
 const rows=rows_('Attendance').filter(x=>x.SessionID===sessionId);
 return {total:rows.length,present:rows.filter(x=>x.Status==='PRESENT').length,late:rows.filter(x=>x.Status==='LATE').length,absent:rows.filter(x=>x.Status==='ABSENT').length,leave:rows.filter(x=>x.Status==='LEAVE').length};
}
function getReport(token,courseId){
 const report=getCourseReport(token,courseId);
 return {courseId,closedSessions:report.course.closedSessions,
  totalPeriods:report.course.totalPeriods,
  students:report.students.map(x=>({
    studentId:x.studentId,name:x.studentName,present:x.present,late:x.late,
    absent:x.absent,leave:x.leave,periods:x.periods,
    percent:x.attendancePercent,absencePercent:x.absencePercent,risk:x.risk
  }))};
}
function getCourseSessions(token,courseId){
 checkCourse_(token,courseId);
 return rows_('Sessions').filter(x=>x.CourseID===courseId).sort((a,b)=>Date.parse(b.StartAt)-Date.parse(a.StartAt)).slice(0,40).map(sessionView_);
}
function getSessionAttendance(token,sessionId){
 const {session,course}=checkSession_(token,sessionId);
 const studentMap=new Map(rows_('Students').map(x=>[x.StudentID,x]));
 const enrolled=rows_('Enrollments').filter(x=>x.CourseID===course.CourseID&&x.Status==='APPROVED');
 const recorded=new Map(rows_('Attendance').filter(x=>x.SessionID===sessionId).map(x=>[x.StudentID,x]));
 return {session:sessionView_(session),students:enrolled.map(x=>{
  const a=recorded.get(x.StudentID),student=studentMap.get(x.StudentID);
  return {studentId:x.StudentID,name:student?student.Name:'ไม่พบข้อมูล',classId:student?student.ClassID:'',status:a?a.Status:'',scanAt:a?a.ScanAt:'',note:a?a.Note:''};
 }).sort((a,b)=>a.studentId.localeCompare(b.studentId))};
}
function updateAttendance(token,sessionId,studentId,newStatus,note){
 return lock_(()=>{
  newStatus=String(newStatus||'').toUpperCase();
  const reason=String(note||'').trim().slice(0,250);
  if(!['PRESENT','LATE','ABSENT','LEAVE'].includes(newStatus))throw Error('สถานะไม่ถูกต้อง');
  if(reason.length<5)throw Error('ระบุเหตุผลแก้ไขอย่างน้อย 5 ตัวอักษร');
  const {session,t,course}=checkSession_(token,sessionId);readOnlyExecutive_(t);
  if(!['OPEN','CLOSED'].includes(session.Status))throw Error('ไม่สามารถแก้ไขคาบนี้ได้');
  studentId=String(studentId||'').trim();
  if(!rows_('Enrollments').some(e=>e.CourseID===course.CourseID&&e.StudentID===studentId&&e.Status==='APPROVED'))throw Error('นักเรียนไม่ได้รับการยืนยันในรายวิชา');
  const unique=sessionId+'|'+studentId,entry=findAttendanceByKey_(unique);
  const sh=tab_('Attendance'),changedAt=now_(),previous=entry?entry.status:'NOT_RECORDED';
  if(previous===newStatus) return {ok:true,unchanged:true,before:previous,after:newStatus};
  if(entry){
   // Keep original scan timestamp; change only current status / editor and note.
   sh.getRange(entry.row,6).setValue(newStatus);
   sh.getRange(entry.row,9,1,3).setValues([[t.TeacherID,changedAt,reason]]);
  }else{
   sh.appendRow([rand_(),unique,sessionId,course.CourseID,studentId,newStatus,'','MANUAL',t.TeacherID,changedAt,reason]);
  }
  audit_(t.TeacherID,'CORRECT_ATTENDANCE',unique,{before:previous,after:newStatus,note:reason,sessionState:session.Status,changedAt});invalidateAnalytics_();
  return {ok:true,unchanged:false,before:previous,after:newStatus};
 });
}
/** OWNER-ONLY. Functions suffixed "_" are not callable from google.script.run. */
function ensurePrivate_(){
 const file=DriveApp.getFileById(prop_('TEACHER_SHEET_ID'));
 file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
 if(file.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('ต้องจำกัดสิทธิ์แชร์เป็น Restricted ก่อนนำเข้าข้อมูล');
}
function appendMissing_(name,data,keyIndexes){
 const sh=tab_(name),old=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,HEADERS_[name].length).getValues():[];
 const key=row=>keyIndexes.map(i=>String(row[i]||'')).join('|');
 const known=new Set(old.map(key)),append=[];
 for(const row of data){const k=key(row);if(!k||known.has(k))continue;known.add(k);append.push(row)}
 if(append.length)sh.getRange(sh.getLastRow()+1,1,append.length,HEADERS_[name].length).setValues(append);
 return append.length;
}
function setupFromSource_(){
 const props=PropertiesService.getScriptProperties();
 if(!prop_('TEACHER_SHEET_ID')||!prop_('SOURCE_SHEET_ID'))throw Error('ใส่ Script Properties ของชีทใหม่และต้นทางก่อน');
 if(prop_('TEACHER_SHEET_ID')===prop_('SOURCE_SHEET_ID'))throw Error('ห้ามใช้ชีทต้นทางเป็นชีทปลายทาง');
 ensurePrivate_();requireRestrictedSheets_();
 return lock_(()=>{
  const source=SpreadsheetApp.openById(prop_('SOURCE_SHEET_ID'));
  const read=name=>{const sh=source.getSheetByName(name);if(!sh)throw Error('ไม่พบตารางต้นทาง '+name);return sh.getDataRange().getDisplayValues().slice(1).filter(r=>r[0])};
  const teachers=read('ImportTeachers'),students=read('Students'),review=read('ImportCourseReview'),courses=read('Courses'),enrolls=read('Enrollments'),registrations=read('TeacherRegistration');
  const normalizeName_=x=>String(x||'').replace(/\s+/g,'').trim();
  const regByName=new Map();for(const r of registrations){const k=normalizeName_(r[1]);if(!regByName.has(k))regByName.set(k,[]);regByName.get(k).push(r[0])}
  const reviewMap=new Map(review.map(r=>[r[0],r]));
  const adminId=prop_('BOOTSTRAP_ADMIN_ID')||'T004';
  const imported={};
  imported.Teachers=appendMissing_('Teachers',teachers.map(r=>{const ids=regByName.get(normalizeName_(r[1]))||[];return [r[0],r[1],r[2],r[3],r[0]===adminId?'ADMIN':'TEACHER','TRUE','','','0','','1','',ids.length===1?ids[0]:'']}),[0]);
  // Idempotent backfill for installations created before the Home Room SSO field.
  let mapped=0;const teachersSheet=tab_('Teachers');
  for(const teacher of rows_('Teachers')){
   if(teacher.HomeRoomUserID)continue;
   const matches=regByName.get(normalizeName_(teacher.Name))||[];
   if(matches.length!==1)continue;
   teachersSheet.getRange(teacher._row,13).setValue(matches[0]);mapped++;
  }
  imported.HomeRoomMapped=mapped;
  // Scanner source STUDENTS supplies unique 4-digit code4, not a PIN or auth hash.
  const scannerSheet=SpreadsheetApp.openById(prop_('SCAN_SOURCE_SHEET_ID')).getSheetByName('STUDENTS');
  if(!scannerSheet)throw Error('ไม่พบแท็บ STUDENTS ในชีทสแกน');
  const rawCodes=scannerSheet.getLastRow()>1?scannerSheet.getRange(2,1,scannerSheet.getLastRow()-1,7).getDisplayValues():[];
  const activeCodes=rawCodes.filter(r=>String(r[6]).toUpperCase()==='TRUE');
  const activeById=new Map(activeCodes.map(r=>[String(r[0]),String(r[1])]));
  const codes=activeCodes.map(r=>String(r[1]));
  if(new Set(codes).size!==codes.length||codes.some(c=>!/^\d{4}$/.test(c)))throw Error('รหัสสแกน code4 ไม่ครบ 4 หลักหรือมีรหัสซ้ำ ยกเลิกการนำเข้า');
  imported.Students=appendMissing_('Students',students.map(r=>[r[0],r[1],r[2],r[3],r[4],r[6],activeById.get(String(r[0]))||'',r[7]]),[0]);
  // Fill empty ScanCode only. Existing custom ScanCode and attendance data remain unchanged.
  let codeLinked=0;
  const studentSheet=tab_('Students');
  for(const student of rows_('Students')){
    if(student.ScanCode)continue;
    const code=activeById.get(student.StudentID);
    if(!code)continue;
    studentSheet.getRange(student._row,7).setValue(code);codeLinked++;
  }
  imported.ScannerCodesLinked=codeLinked;
  imported.Courses=appendMissing_('Courses',courses.map(r=>{
   const sourceId=String(r[0]).match(/^AC69_2_(T\d+-C\d+)_/),reviewRow=sourceId?reviewMap.get(sourceId[1]):null;
   const teacherId=reviewRow?reviewRow[1]:(sourceId?sourceId[1].split('-')[0]:'');
   return [r[0],r[1],r[2],r[3],teacherId,r[4],r[5],reviewRow?reviewRow[9]:'REVIEW',r[6],setting_('TERM','2/2569')];
  }),[0]);
  imported.Enrollments=appendMissing_('Enrollments',enrolls.map(r=>[r[0],r[1],r[2],r[3],'']),[0,1]);
  setSetting_('IMPORT_STATUS','READY');invalidateAnalytics_();invalidateScanIndexes_();
  audit_('SYSTEM','READ_ONLY_IMPORT','KDTC_SOURCE',imported);
  return imported;
 });
}
