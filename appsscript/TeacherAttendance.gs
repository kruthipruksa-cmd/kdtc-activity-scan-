/**
 * KDTC TEACHER ATTENDANCE - separate standalone Google Apps Script project.
 * No writes to the legacy activity database. Requires Script Properties:
 * TEACHER_SHEET_ID, SOURCE_SHEET_ID, BOOTSTRAP_ADMIN_ID, BOOTSTRAP_ADMIN_PIN.
 * Run setupFromSource_ and bootstrapAdmin_ from the script editor, in that order.
 * No PIN, pepper, student list, or credential belongs in GitHub.
 */
const TZ_='Asia/Bangkok';
const HEADERS_={
 Teachers:['TeacherID','Name','Department','Email','Role','Active','Salt','PinHash','FailedAttempts','LockedUntil','AuthVersion','PinChangedAt'],
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
function securePepper_(){let p=prop_('PIN_PEPPER');if(!p){p=rand_();PropertiesService.getScriptProperties().setProperty('PIN_PEPPER',p)}return p}
function pinHash_(pin,salt){return hash_(salt+'|'+pin+'|'+securePepper_())}
function truth_(s){return String(s).toUpperCase()==='TRUE'}
function teacher_(id){return rows_('Teachers').find(t=>t.TeacherID===id)}
function writeTeacher_(t,updates){
 const s=tab_('Teachers');const h=HEADERS_.Teachers;
 Object.keys(updates).forEach(k=>{const j=h.indexOf(k);if(j<0)throw Error('ช่องไม่ถูกต้อง');s.getRange(t._row,j+1).setValue(String(updates[k]))});
}
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
function publicStatus(){return {ready:setting_('IMPORT_STATUS','')==='READY',timeZone:TZ_,version:'1.0.0'}}
function doGet(e){
 if(!e||e.parameter.mode!=='teacherBridge'||!/^[0-9a-f]{32,64}$/i.test(String(e.parameter.nonce||'')))
  return HtmlService.createHtmlOutput('KDTC Teacher Attendance API. Open the GitHub Pages teacher interface.').setTitle('KDTC Teacher Attendance');
 const template=HtmlService.createTemplateFromFile('TeacherBridge');
 template.bridgeNonce=String(e.parameter.nonce);
 return template.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).setTitle('KDTC Teacher Bridge');
}
function login(id,pin){
 id=String(id||'').trim().toUpperCase();pin=String(pin||'');
 if(!/^T\d{3,4}$/.test(id)||!/^\d{8,12}$/.test(pin))throw Error('รหัสครูหรือ PIN ไม่ถูกต้อง');
 return lock_(()=>{
  const t=teacher_(id),n=Date.now();
  if(!t||!truth_(t.Active)||!t.PinHash)throw Error('บัญชีนี้ยังไม่ได้เปิดใช้ หรือข้อมูลไม่ถูกต้อง');
  if(t.LockedUntil&&Date.parse(t.LockedUntil)>n)throw Error('บัญชีล็อกชั่วคราว กรุณาติดต่อผู้ดูแล');
  if(pinHash_(pin,t.Salt)!==t.PinHash){
   const tries=Number(t.FailedAttempts||0)+1;
   writeTeacher_(t,{FailedAttempts:tries,LockedUntil:tries>=5?new Date(n+15*60000).toISOString():''});
   throw Error(tries>=5?'บัญชีถูกล็อก 15 นาที':'รหัสครูหรือ PIN ไม่ถูกต้อง');
  }
  writeTeacher_(t,{FailedAttempts:0,LockedUntil:''});
  const token=rand_();CacheService.getScriptCache().put('TA_'+hash_(token),id+'|'+t.AuthVersion,21600);
  return {token,teacherId:id,name:t.Name,role:t.Role};
 });
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
 return {total:rows.length,present:rows.filter(x=>x.Status==='PRESENT').length,late:rows.filter(x=>x.Status==='LATE').length,absent:rows.filter(x=>x.Status==='ABSENT').length};
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
  const absent=Math.max(0,closed.length-present-late);
  return {studentId:e.StudentID,name:students.get(e.StudentID)?.Name||'',present,late,absent,percent:closed.length?Math.round(10000*(present+late)/closed.length)/100:null};
 });
 return {courseId,closedSessions:closed.length,students:result};
}
function updateAttendance(token,sessionId,studentId,newStatus,note){
 return lock_(()=>{
  if(!['PRESENT','LATE','ABSENT'].includes(newStatus))throw Error('สถานะไม่ถูกต้อง');
  if(String(note||'').trim().length<5)throw Error('ระบุเหตุผลการแก้ไขอย่างน้อย 5 ตัวอักษร');
  const {session,t}=checkSession_(token,sessionId);
  if(session.Status!=='CLOSED')throw Error('แก้ไขด้วยเมนูนี้ได้เมื่อปิดคาบแล้ว');
  const key=sessionId+'|'+studentId,entry=rows_('Attendance').find(x=>x.UniqueKey===key);
  if(!entry)throw Error('ไม่พบรายการเช็กชื่อของนักเรียน');
  const sh=tab_('Attendance'),old=entry.Status;
  sh.getRange(entry._row,6).setValue(newStatus);
  sh.getRange(entry._row,10,1,2).setValues([[now_(),String(note).slice(0,250)]]);
  audit_(t.TeacherID,'CORRECT_ATTENDANCE',key,{before:old,after:newStatus,note:String(note).slice(0,250)});
  return {ok:true,before:old,after:newStatus};
 });
}
function listTeachers(token){
 const t=auth_(token);if(t.Role!=='ADMIN')throw Error('ไม่มีสิทธิ์ผู้ดูแล');
 return rows_('Teachers').map(x=>({teacherId:x.TeacherID,name:x.Name,role:x.Role,hasPin:!!x.PinHash}));
}
function setPin_(t,pin){
 if(!/^\d{8,12}$/.test(String(pin)))throw Error('PIN ต้องเป็นตัวเลข 8-12 หลัก');
 const salt=rand_(),next=String(Number(t.AuthVersion||1)+1);
 writeTeacher_(t,{Salt:salt,PinHash:pinHash_(String(pin),salt),FailedAttempts:0,LockedUntil:'',AuthVersion:next,PinChangedAt:now_()});
}
function adminSetPin(token,teacherId,pin){
 return lock_(()=>{
  const caller=auth_(token);if(caller.Role!=='ADMIN')throw Error('ไม่มีสิทธิ์ผู้ดูแล');
  const target=teacher_(String(teacherId));if(!target)throw Error('ไม่พบบัญชีครู');
  setPin_(target,pin);audit_(caller.TeacherID,'RESET_PIN',target.TeacherID,{});return {ok:true};
 });
}
function changeMyPin(token,oldPin,newPin){
 return lock_(()=>{
  const t=auth_(token);
  if(pinHash_(String(oldPin),t.Salt)!==t.PinHash)throw Error('PIN เดิมไม่ถูกต้อง');
  setPin_(t,String(newPin));logout(token);audit_(t.TeacherID,'CHANGE_PIN',t.TeacherID,{});return {ok:true};
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
 ensurePrivate_();securePepper_();
 return lock_(()=>{
  const source=SpreadsheetApp.openById(prop_('SOURCE_SHEET_ID'));
  const read=name=>{const sh=source.getSheetByName(name);if(!sh)throw Error('ไม่พบตารางต้นทาง '+name);return sh.getDataRange().getDisplayValues().slice(1).filter(r=>r[0])};
  const teachers=read('ImportTeachers'),students=read('Students'),review=read('ImportCourseReview'),courses=read('Courses'),enrolls=read('Enrollments');
  const reviewMap=new Map(review.map(r=>[r[0],r]));
  const adminId=prop_('BOOTSTRAP_ADMIN_ID')||'T004';
  const imported={};
  imported.Teachers=appendMissing_('Teachers',teachers.map(r=>[r[0],r[1],r[2],r[3],r[0]===adminId?'ADMIN':'TEACHER','TRUE','','','0','','1','']),[0]);
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
function bootstrapAdmin_(){
 const p=PropertiesService.getScriptProperties();
 const id=prop_('BOOTSTRAP_ADMIN_ID')||'T004',pin=prop_('BOOTSTRAP_ADMIN_PIN');
 if(!pin)throw Error('ตั้ง BOOTSTRAP_ADMIN_PIN ใน Script Properties ก่อน');
 ensurePrivate_();
 const t=teacher_(id);if(!t||t.Role!=='ADMIN')throw Error('ครูผู้ดูแลไม่ได้ระบุไว้ในตาราง Teachers');
 if(t.PinHash)throw Error('บัญชีผู้ดูแลตั้ง PIN แล้ว ห้าม bootstrap ซ้ำ');
 lock_(()=>{setPin_(t,pin);audit_(id,'BOOTSTRAP_ADMIN',id,{})});
 p.deleteProperty('BOOTSTRAP_ADMIN_PIN');
 return 'เริ่มต้นผู้ดูแลเรียบร้อย กรุณาลบ PIN ชั่วคราวออกจากประวัติการตั้งค่าที่เก็บไว้';
}
