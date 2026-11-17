/**
 * KDTC TEACHER ATTENDANCE - separate standalone Google Apps Script project.
 * No writes to the legacy activity database. Requires Script Properties:
 * TEACHER_SHEET_ID, SOURCE_SHEET_ID, HOMEROOM_VERIFY_URL, HOMEROOM_SHARED_SECRET.
 * Home Room remains the authority for credentials. Never store/copy teacher PINs here.
 * Run setupFromSource_ in the Apps Script editor only after restricting Sheet sharing.
 */
const TZ_='Asia/Bangkok';
const HEADERS_={
 Teachers:['TeacherID','Name','Department','Email','Role','Active','Salt','PinHash','FailedAttempts','LockedUntil','AuthVersion','PinChangedAt','HomeRoomUserID'],
 Students:['StudentID','Name','ClassID','Department','Level','EnrollStatus','ScanCode','SourceUpdatedAt'],
 Courses:['CourseID','CourseCode','Name','ClassID','TeacherID','TeacherEmail','Active','SourceReviewStatus','CreatedAt','Term'],
 Enrollments:['CourseID','StudentID','Status','UpdatedAt','ApprovedBy'],
 Sessions:['SessionID','CourseID','SessionDate','StartAt','PresentUntil','LateUntil','Status','TeacherID','ClosedAt','Topic'],
 Attendance:['AttendanceID','UniqueKey','SessionID','CourseID','StudentID','Status','ScanAt','InputMode','TeacherID','UpdatedAt','Note'],
 AuditLog:['EventID','At','ActorTeacherID','Action','Entity','Details'],
 Settings:['Key','Value','Description']
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
function auth_(token){
 if(typeof token!=='string'||!token||token.length>150)throw Error('กรุณาเข้าสู่ระบบ');
 const cache=CacheService.getScriptCache().get('TA_'+hash_(token));if(!cache)throw Error('หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบอีกครั้ง');
 const parts=cache.split('|'),t=teacher_(parts[0]);
 if(!t||!truth_(t.Active)||t.AuthVersion!==parts[1])throw Error('สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบใหม่');
 return t;
}
function checkCourse_(token,id){
 const t=auth_(token),course=rows_('Courses').find(c=>c.CourseID===String(id));
 if(!course||!truth_(course.Active))throw Error('ไม่พบรายวิชาที่เปิดใช้');
 if(t.Role!=='ADMIN'&&course.TeacherID!==t.TeacherID)throw Error('ไม่มีสิทธิ์รายวิชานี้');
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
function doGet(e){
 if(!e||e.parameter.mode!=='teacherBridge'||!/^[0-9a-f]{32,64}$/i.test(String(e.parameter.nonce||'')))
  return HtmlService.createHtmlOutput('KDTC Teacher Attendance API. Open the GitHub Pages teacher interface.').setTitle('KDTC Teacher Attendance');
 const template=HtmlService.createTemplateFromFile('TeacherBridge');
 template.bridgeNonce=String(e.parameter.nonce);
 return template.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).setTitle('KDTC Teacher Bridge');
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
 if(result.ok!==true||result.userId!==userId||result.active!==true||result.kind!=='TEACHER')throw Error('รหัสผู้ใช้หรือรหัสผ่าน Home Room ไม่ถูกต้อง');
 return result;
}
function login(id,pin){
 id=String(id||'').trim().toUpperCase();pin=String(pin||'');
 if(!/^U\d{3,4}$/.test(id)||!pin||pin.length>128)throw Error('กรอกรหัสครูและรหัสผ่านเดียวกับ Home Room');
 const t=rows_('Teachers').find(x=>x.HomeRoomUserID===id&&truth_(x.Active));
 if(!t)throw Error('บัญชีครูยังไม่ได้จับคู่กับ Home Room');
 if(t.LockedUntil&&Date.parse(t.LockedUntil)>Date.now())throw Error('ถูกจำกัดการเข้าใช้ชั่วคราว กรุณาลองใหม่ภายหลัง');
 try{verifyHomeRoom_(id,pin)}catch(e){
  if(e.message.startsWith('ยังไม่เชื่อม')||e.message.startsWith('ลิงก์ตรวจสอบ')||e.message.startsWith('ตรวจสอบบัญชี Home Room ไม่สำเร็จ')||e.message.startsWith('ระบบ Home Room ไม่ตอบ'))throw e;
  lock_(()=>{
    const sh=tab_('Teachers'),fresh=teacher_(t.TeacherID),failed=Number(fresh.FailedAttempts||0)+1;
    sh.getRange(fresh._row,9,1,2).setValues([[failed,failed>=5?new Date(Date.now()+15*60000).toISOString():'']]);
  });
  throw Error('รหัสผู้ใช้หรือรหัสผ่าน Home Room ไม่ถูกต้อง');
 }
 lock_(()=>{const sh=tab_('Teachers');sh.getRange(t._row,9,1,2).setValues([[0,'']])});
 const token=rand_();
 CacheService.getScriptCache().put('TA_'+hash_(token),t.TeacherID+'|'+t.AuthVersion,21600);
 audit_(t.TeacherID,'HOMEROOM_LOGIN',t.TeacherID,{source:'Home Room'});
 return {token,teacherId:t.TeacherID,name:t.Name,role:t.Role};
}
function me(token){const t=auth_(token);return {teacherId:t.TeacherID,name:t.Name,role:t.Role}}
function logout(token){if(typeof token==='string'&&token)CacheService.getScriptCache().remove('TA_'+hash_(token));return {ok:true}}
function getCourses(token){
 const t=auth_(token);
 const enrollment=rows_('Enrollments');
 return rows_('Courses').filter(c=>truth_(c.Active)&&(t.Role==='ADMIN'||c.TeacherID===t.TeacherID)).map(c=>{
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
  const {t}=checkCourse_(token,courseId),s=tab_('Enrollments'),rows=rows_('Enrollments');
  const candidates=rows.filter(x=>x.CourseID===courseId&&x.Status==='SUGGESTED');
  if(!candidates.length)return {approved:0};
  const studentIds=new Set(rows_('Students').filter(x=>x.EnrollStatus==='ACTIVE').map(x=>x.StudentID));
  let count=0;
  candidates.forEach(x=>{if(!studentIds.has(x.StudentID))return;
   s.getRange(x._row,3,1,3).setValues([['APPROVED',now_(),t.TeacherID]]);count++;
  });
  audit_(t.TeacherID,'APPROVE_ROSTER',courseId,{count});return {approved:count};
 });
}
function startSession(token,courseId,topic){
 return lock_(()=>{
  const {t}=checkCourse_(token,courseId);
  if(!rows_('Enrollments').some(x=>x.CourseID===courseId&&x.Status==='APPROVED'))throw Error('ต้องตรวจสอบและยืนยันรายชื่อนักเรียนก่อน');
  const active=rows_('Sessions').find(s=>s.CourseID===courseId&&s.Status==='OPEN');
  if(active)return sessionView_(active);
  const p=Math.max(0,Math.min(120,Number(setting_('PRESENT_MINUTES',10))||10));
  const l=Math.max(p+1,Math.min(240,Number(setting_('LATE_MINUTES',25))||25));
  const time=new Date(),id=rand_();
  const row=[id,courseId,Utilities.formatDate(time,TZ_,'yyyy-MM-dd'),time.toISOString(),new Date(time.getTime()+p*60000).toISOString(),new Date(time.getTime()+l*60000).toISOString(),'OPEN',t.TeacherID,'',String(topic||'').slice(0,200)];
  tab_('Sessions').appendRow(row);
  audit_(t.TeacherID,'START_SESSION',id,{courseId});return sessionView_(Object.fromEntries(HEADERS_.Sessions.map((h,i)=>[h,row[i]])));
 });
}
function sessionView_(s){return {sessionId:s.SessionID,courseId:s.CourseID,date:s.SessionDate,startAt:s.StartAt,presentUntil:s.PresentUntil,lateUntil:s.LateUntil,status:s.Status,topic:s.Topic}}
function getOpenSession(token,courseId){checkCourse_(token,courseId);const x=rows_('Sessions').find(r=>r.CourseID===courseId&&r.Status==='OPEN');return x?sessionView_(x):null}
function scanStudent(token,sessionId,raw){
 return lock_(()=>{
  const {session,t,course}=checkSession_(token,sessionId);
  if(session.Status!=='OPEN')throw Error('คาบเรียนปิดแล้ว');
  const text=String(raw||'').trim();
  if(text.length>150)throw Error('รหัสยาวเกินไป');
  const scanCode=text.replace(/^STUDENT:/i,'').trim();
  const matches=rows_('Students').filter(s=>s.StudentID===scanCode||(s.ScanCode&&s.ScanCode===scanCode));
  if(matches.length!==1)throw Error(matches.length?'รหัสสแกนซ้ำกับนักเรียนหลายคน':'ไม่พบรหัสนักเรียน กรุณาใช้รหัสนักเรียนเต็ม');
  const s=matches[0];
  if(s.EnrollStatus!=='ACTIVE')throw Error('นักเรียนไม่ได้อยู่ในสถานะกำลังศึกษา');
  if(!rows_('Enrollments').some(e=>e.CourseID===course.CourseID&&e.StudentID===s.StudentID&&e.Status==='APPROVED'))throw Error('นักเรียนยังไม่ได้ลงทะเบียนหรือยืนยันในรายวิชานี้');
  const unique=sessionId+'|'+s.StudentID;
  const existing=rows_('Attendance').find(x=>x.UniqueKey===unique);
  if(existing)return {ok:true,duplicate:true,name:s.Name,classId:s.ClassID,status:existing.Status,scanAt:existing.ScanAt};
  const when=new Date(),status=when.getTime()<=Date.parse(session.PresentUntil)?'PRESENT':when.getTime()<=Date.parse(session.LateUntil)?'LATE':'ABSENT';
  tab_('Attendance').appendRow([rand_(),unique,sessionId,course.CourseID,s.StudentID,status,when.toISOString(),'QR_OR_MANUAL',t.TeacherID,when.toISOString(),'']);
  return {ok:true,duplicate:false,name:s.Name,classId:s.ClassID,status,scanAt:when.toISOString()};
 });
}
function closeSession(token,sessionId){
 return lock_(()=>{
  const {session,t,course}=checkSession_(token,sessionId);
  if(session.Status==='CLOSED')return {alreadyClosed:true,...getSessionStats_(sessionId)};
  if(session.Status!=='OPEN')throw Error('สถานะคาบไม่ถูกต้อง');
  const approved=rows_('Enrollments').filter(e=>e.CourseID===course.CourseID&&e.Status==='APPROVED');
  const existing=new Set(rows_('Attendance').filter(x=>x.SessionID===sessionId).map(x=>x.StudentID));
  const at=now_(),newRows=[];
  for(const en of approved){if(existing.has(en.StudentID))continue;newRows.push([rand_(),sessionId+'|'+en.StudentID,sessionId,course.CourseID,en.StudentID,'ABSENT',at,'AUTO_CLOSE',t.TeacherID,at,'ไม่พบการสแกน'])}
  if(newRows.length){const sh=tab_('Attendance');sh.getRange(sh.getLastRow()+1,1,newRows.length,11).setValues(newRows)}
  const sh=tab_('Sessions');sh.getRange(session._row,7).setValue('CLOSED');sh.getRange(session._row,9).setValue(at);
  audit_(t.TeacherID,'CLOSE_SESSION',sessionId,{absentAdded:newRows.length});
  return {alreadyClosed:false,...getSessionStats_(sessionId)};
 });
}
function getSessionStats_(sessionId){
 const rows=rows_('Attendance').filter(x=>x.SessionID===sessionId);
 return {total:rows.length,present:rows.filter(x=>x.Status==='PRESENT').length,late:rows.filter(x=>x.Status==='LATE').length,absent:rows.filter(x=>x.Status==='ABSENT').length,leave:rows.filter(x=>x.Status==='LEAVE').length};
}
function getReport(token,courseId){
 checkCourse_(token,courseId);
 const closed=rows_('Sessions').filter(s=>s.CourseID===courseId&&s.Status==='CLOSED');
 const approved=rows_('Enrollments').filter(e=>e.CourseID===courseId&&e.Status==='APPROVED');
 const students=new Map(rows_('Students').map(s=>[s.StudentID,s]));
 const data=rows_('Attendance').filter(x=>x.CourseID===courseId&&closed.some(s=>s.SessionID===x.SessionID));
 const result=approved.map(e=>{
  const r=data.filter(x=>x.StudentID===e.StudentID);
  const present=r.filter(x=>x.Status==='PRESENT').length,late=r.filter(x=>x.Status==='LATE').length;
  const leave=r.filter(x=>x.Status==='LEAVE').length;
  const absent=Math.max(0,closed.length-present-late-leave);
  return {studentId:e.StudentID,name:students.get(e.StudentID)?.Name||'',present,late,absent,leave,percent:closed.length?Math.round(10000*(present+late)/closed.length)/100:null};
 });
 return {courseId,closedSessions:closed.length,students:result};
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
  const {session,t,course}=checkSession_(token,sessionId);
  if(!['OPEN','CLOSED'].includes(session.Status))throw Error('ไม่สามารถแก้ไขคาบนี้ได้');
  studentId=String(studentId||'').trim();
  if(!rows_('Enrollments').some(e=>e.CourseID===course.CourseID&&e.StudentID===studentId&&e.Status==='APPROVED'))throw Error('นักเรียนไม่ได้รับการยืนยันในรายวิชา');
  const unique=sessionId+'|'+studentId,entry=rows_('Attendance').find(x=>x.UniqueKey===unique);
  const sh=tab_('Attendance'),changedAt=now_(),previous=entry?entry.Status:'NOT_RECORDED';
  if(previous===newStatus) return {ok:true,unchanged:true,before:previous,after:newStatus};
  if(entry){
   // Keep original scan timestamp; change only current status / editor and note.
   sh.getRange(entry._row,6).setValue(newStatus);
   sh.getRange(entry._row,9,1,3).setValues([[t.TeacherID,changedAt,reason]]);
  }else{
   sh.appendRow([rand_(),unique,sessionId,course.CourseID,studentId,newStatus,'','MANUAL',t.TeacherID,changedAt,reason]);
  }
  audit_(t.TeacherID,'CORRECT_ATTENDANCE',unique,{before:previous,after:newStatus,note:reason,sessionState:session.Status,changedAt});
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
 ensurePrivate_();
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
  imported.Students=appendMissing_('Students',students.map(r=>[r[0],r[1],r[2],r[3],r[4],r[6],'',r[7]]),[0]);
  imported.Courses=appendMissing_('Courses',courses.map(r=>{
   const sourceId=String(r[0]).match(/^AC69_2_(T\d+-C\d+)_/),reviewRow=sourceId?reviewMap.get(sourceId[1]):null;
   const teacherId=reviewRow?reviewRow[1]:(sourceId?sourceId[1].split('-')[0]:'');
   return [r[0],r[1],r[2],r[3],teacherId,r[4],r[5],reviewRow?reviewRow[9]:'REVIEW',r[6],setting_('TERM','2/2569')];
  }),[0]);
  imported.Enrollments=appendMissing_('Enrollments',enrolls.map(r=>[r[0],r[1],r[2],r[3],'']),[0,1]);
  setSetting_('IMPORT_STATUS','READY');
  audit_('SYSTEM','READ_ONLY_IMPORT','KDTC_SOURCE',imported);
  return imported;
 });
}
