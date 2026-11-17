/**
 * KDTC TeacherSelfService.gs
 * Teacher-created subject/class groups and roster additions.
 * Existing authorized student IDs can be enrolled immediately.
 * Missing central student identities are submitted for admin review;
 * ONLY after verified against read-only CARE NEXUS STUDENTS do we import locally.
 * Never writes to original activity, Home Room or CARE NEXUS Sheets.
 */
function selfActor_(token){
 const actor=auth_(token);
 if(!['TEACHER','ADMIN'].includes(actor.Role))throw Error('ไม่มีสิทธิ์จัดการรายวิชา');
 requireRestrictedSheets_();
 const teacher=rows_('Teachers').find(t=>t.TeacherID===actor.TeacherID&&truth_(t.Active));
 if(!teacher)throw Error('บัญชีครูยังไม่ได้จับคู่กับฐานข้อมูลรายวิชา');
 return {actor,teacher};
}
function trimField_(value,max,what){
 const text=String(value===null||value===undefined?'':value).trim().replace(/\s+/g,' ');
 if(!text||text.length>max)throw Error(what+' ต้องกรอกข้อมูลไม่เกิน '+max+' ตัวอักษร');
 if(/[\u0000-\u001f<>]/.test(text))throw Error(what+' มีอักขระที่ไม่อนุญาต');
 return text;
}
function courseShort_(course){
 return {courseId:course.CourseID,code:course.CourseCode,name:course.Name,classId:course.ClassID,
  teacherId:course.TeacherID,createdAt:course.CreatedAt,status:course.SourceReviewStatus};
}
function createMyCourse(token,input){
 return lock_(()=>{
  const {actor,teacher}=selfActor_(token);
  const code=trimField_(input?.code,25,'รหัสวิชา').toUpperCase();
  const name=trimField_(input?.name,160,'ชื่อรายวิชา');
  const classId=trimField_(input?.classId,85,'ห้องเรียน');
  if(!/^[A-Z0-9ก-๙][A-Z0-9ก-๙._-]{2,24}$/.test(code))throw Error('รูปแบบรหัสวิชาไม่ถูกต้อง เช่น 20106-2003');
  const term=String(setting_('TERM','2/2569')).trim();
  const clashes=rows_('Courses').filter(c=>
   truth_(c.Active)&&c.CourseCode.toUpperCase()===code&&c.ClassID===classId&&c.Term===term);
  if(clashes.length){
   const mine=clashes.find(c=>c.TeacherID===actor.TeacherID);
   if(mine)return {ok:true,duplicate:true,course:courseShort_(mine)};
   throw Error('มีรายวิชารหัสนี้ในห้องและภาคเรียนเดียวกันแล้ว ให้ผู้ดูแลตรวจสอบการมอบหมายก่อน');
  }
  const id='OWN_'+Utilities.getUuid().replace(/-/g,''),at=now_();
  tab_('Courses').appendRow([id,code,name,classId,actor.TeacherID,teacher.Email||'',
    'TRUE','TEACHER_CREATED',at,term]);
  audit_(actor.UserID,'TEACHER_CREATE_COURSE',id,{code,name,classId,term});
  invalidateAnalytics_();
  return {ok:true,duplicate:false,course:{courseId:id,code,name,classId,teacherId:actor.TeacherID,createdAt:at,status:'TEACHER_CREATED'}};
 });
}
/** Only approved real IDs in local Student registry are enrollable. */
function searchCourseStudents(token,courseId,query){
 checkCourse_(token,String(courseId));
 const q=String(query||'').trim().toLowerCase();
 if(q.length<2||q.length>70)throw Error('ค้นหาด้วยรหัสหรือชื่ออย่างน้อย 2 ตัวอักษร');
 const known=new Map(rows_('Enrollments').filter(x=>x.CourseID===courseId)
  .map(x=>[x.StudentID,x.Status]));
 const matches=rows_('Students').filter(x=>x.EnrollStatus==='ACTIVE'&&(
  x.StudentID.toLowerCase().includes(q)||
  x.Name.toLowerCase().includes(q)||
  x.ClassID.toLowerCase().includes(q)||
  x.ScanCode.toLowerCase()===q
 ));
 return matches.slice(0,35).map(x=>({
  studentId:x.StudentID,name:x.Name,classId:x.ClassID,department:x.Department,
  enrollment:known.get(x.StudentID)||'NOT_ENROLLED'
 }));
}
function addExistingStudentToCourse(token,courseId,studentId){
 return lock_(()=>{
  const {t,course}=checkCourse_(token,String(courseId));readOnlyExecutive_(t);requireRestrictedSheets_();
  const id=String(studentId||'').trim();
  const matches=rows_('Students').filter(x=>x.StudentID===id&&x.EnrollStatus==='ACTIVE');
  if(matches.length!==1)throw Error('ไม่พบนักเรียนรหัสนี้ในฐานข้อมูลนักเรียนที่เปิดใช้งาน');
  const record=rows_('Enrollments').find(x=>x.CourseID===course.CourseID&&x.StudentID===id);
  if(record?.Status==='APPROVED')return {ok:true,duplicate:true,studentId:id};
  const at=now_(),sh=tab_('Enrollments');
  if(record)sh.getRange(record._row,3,1,3).setValues([['APPROVED',at,t.TeacherID]]);
  else sh.appendRow([course.CourseID,id,'APPROVED',at,t.TeacherID]);
  audit_(t.UserID,'TEACHER_ADD_STUDENT',course.CourseID,{studentId:id,source:'EXISTING_REGISTRY',was:record?.Status||'NONE'});
  invalidateAnalytics_();invalidateScanIndexes_();
  return {ok:true,duplicate:false,studentId:id,name:matches[0].Name};
 });
}
/** One RPC call and one append batch for up to 50 students. */
function addStudentsToCourse(token,courseId,studentIds){
 return lock_(()=>{
  const {t,course}=checkCourse_(token,String(courseId));readOnlyExecutive_(t);requireRestrictedSheets_();
  if(!Array.isArray(studentIds)||!studentIds.length||studentIds.length>50)throw Error('เลือกนักเรียนได้ครั้งละ 1–50 คน');
  const ids=[...new Set(studentIds.map(x=>String(x||'').trim()))];
  if(ids.length>50)throw Error('เลือกได้ไม่เกิน 50 คน');
  const names=new Map(rows_('Students').filter(x=>x.EnrollStatus==='ACTIVE').map(x=>[x.StudentID,x.Name]));
  if(ids.some(id=>!names.has(id)))throw Error('มีนักเรียนที่ไม่อยู่ในทะเบียนกลางหรือยังไม่เปิดใช้งาน');
  const existing=new Map(rows_('Enrollments').filter(x=>x.CourseID===course.CourseID).map(x=>[x.StudentID,x]));
  const sh=tab_('Enrollments'),created=[],at=now_();
  let updated=0,unchanged=0;
  for(const id of ids){
   const record=existing.get(id);
   if(record?.Status==='APPROVED'){unchanged++;continue}
   if(record){
    sh.getRange(record._row,3,1,3).setValues([['APPROVED',at,t.TeacherID]]);
    updated++;
   }else created.push([course.CourseID,id,'APPROVED',at,t.TeacherID]);
  }
  if(created.length)sh.getRange(sh.getLastRow()+1,1,created.length,5).setValues(created);
  if(updated||created.length){
   audit_(t.UserID,'TEACHER_ADD_STUDENTS_BATCH',course.CourseID,{ids,created:created.length,updated});
   invalidateAnalytics_();invalidateScanIndexes_();
  }
  return {ok:true,created:created.length,updated,unchanged,total:ids.length};
 });
}
function requestNewStudent(token,courseId,input){
 return lock_(()=>{
  const {t,course}=checkCourse_(token,String(courseId));readOnlyExecutive_(t);requireRestrictedSheets_();
  const id=trimField_(input?.studentId,24,'รหัสนักเรียน');
  if(!/^[0-9A-Za-z_-]{6,24}$/.test(id))throw Error('รหัสนักเรียนไม่ถูกต้อง กรุณาใช้รหัสเต็ม');
  const name=trimField_(input?.name,160,'ชื่อ-สกุล');
  const classId=trimField_(input?.classId||course.ClassID,85,'ห้องเรียน');
  const department=trimField_(input?.department,100,'แผนก');
  const level=trimField_(input?.level,50,'ระดับชั้น');
  if(rows_('Students').some(s=>s.StudentID===id&&s.EnrollStatus==='ACTIVE'))
   throw Error('พบรหัสนักเรียนนี้แล้ว ให้ค้นหาและกดเพิ่มเข้ารายวิชาได้ทันที');
  const pending=rows_('StudentAddRequests').find(x=>
   x.StudentID===id&&x.CourseID===course.CourseID&&x.Status==='PENDING');
  if(pending)return {ok:true,duplicate:true,id:pending.RequestID,status:'PENDING'};
  const at=now_(),requestId=rand_();
  tab_('StudentAddRequests').appendRow([
   requestId,id,name,classId,department,level,course.CourseID,t.TeacherID,
   at,'PENDING','','',''
  ]);
  audit_(t.UserID,'NEW_STUDENT_REQUEST',requestId,{studentId:id,courseId:course.CourseID});
  return {ok:true,duplicate:false,id:requestId,status:'PENDING'};
 });
}
function listStudentAddRequests(token){
 const actor=auth_(token);
 if(!['TEACHER','ADMIN','EXECUTIVE'].includes(actor.Role))throw Error('ไม่มีสิทธิ์');
 const list=rows_('StudentAddRequests').filter(x=>
  actor.Role!=='TEACHER'||x.TeacherID===actor.TeacherID);
 return list.slice(-300).reverse().map(x=>({
  id:x.RequestID,studentId:x.StudentID,name:x.Name,classId:x.ClassID,
  department:x.Department,level:x.Level,courseId:x.CourseID,teacherId:x.TeacherID,
  status:x.Status,createdAt:x.CreatedAt,note:x.Note
 }));
}
function reviewNewStudentRequest(token,requestId,approve,comment){
 return lock_(()=>{
  const t=auth_(token);
  if(t.Role!=='ADMIN')throw Error('เฉพาะผู้ดูแลที่ได้รับสิทธิ์สามารถอนุมัติคำขอ');
  requireRestrictedSheets_();
  const request=rows_('StudentAddRequests').find(x=>x.RequestID===String(requestId));
  if(!request||request.Status!=='PENDING')throw Error('คำขอไม่มีอยู่หรือได้รับการพิจารณาแล้ว');
  const accept=approve===true;
  const note=String(comment||'').trim().slice(0,300);
  if(!accept&&note.length<5)throw Error('กรุณาระบุเหตุผลไม่อนุมัติอย่างน้อย 5 ตัวอักษร');
  if(accept){
   // Verify full ID against read-only authoritative STU​DENTS before creating a local record.
   const official=SpreadsheetApp.openById(prop_('SCAN_SOURCE_SHEET_ID')).getSheetByName('STUDENTS');
   if(!official)throw Error('ไม่พบข้อมูลนักเรียนระบบสแกน');
   const last=official.getLastRow();
   const rows=last>1?official.getRange(2,1,last-1,10).getDisplayValues():[];
   const match=rows.filter(r=>String(r[0])===request.StudentID&&String(r[6]).toUpperCase()==='TRUE');
   if(match.length!==1)throw Error('รหัสนักเรียนยังไม่อยู่ในทะเบียนกลางที่เปิดใช้งาน ต้องเพิ่มข้อมูลทะเบียนกลางก่อนอนุมัติ');
   const officialName=String(match[0][2]||'').replace(/\s+/g,'').trim();
   if(officialName!==request.Name.replace(/\s+/g,''))
    throw Error('ชื่อไม่ตรงข้อมูลทะเบียนกลาง กรุณาตรวจสอบก่อนอนุมัติ');
   const local=rows_('Students').find(x=>x.StudentID===request.StudentID);
   if(local&&local.EnrollStatus!=='ACTIVE')throw Error('บัญชีนักเรียนในฐานข้อมูลใหม่ไม่ได้เปิดใช้งาน');
   if(!local){
    tab_('Students').appendRow([request.StudentID,match[0][2],
     match[0][4]||request.ClassID,match[0][5]||request.Department,
     match[0][3]||request.Level,'ACTIVE',match[0][1]||'',now_()]);
   }
   const exists=rows_('Enrollments').find(e=>e.CourseID===request.CourseID&&e.StudentID===request.StudentID);
   if(exists)tab_('Enrollments').getRange(exists._row,3,1,3).setValues([['APPROVED',now_(),t.TeacherID]]);
   else tab_('Enrollments').appendRow([request.CourseID,request.StudentID,'APPROVED',now_(),t.TeacherID]);
   invalidateAnalytics_();invalidateScanIndexes_();
  }
  const now=now_(),status=accept?'APPROVED':'REJECTED';
  tab_('StudentAddRequests').getRange(request._row,10,1,4)
   .setValues([[status,t.UserID,now,note]]);
  audit_(t.UserID,'REVIEW_NEW_STUDENT',request.RequestID,{
   action:status,studentId:request.StudentID,courseId:request.CourseID,note
  });
  return {ok:true,id:request.RequestID,status};
 });
}