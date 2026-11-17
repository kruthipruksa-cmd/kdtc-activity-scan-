/**
 * TeacherDashboard.gs — business logic for Apps Script MAIN dashboard.
 * Requires TeacherAttendance.gs in same standalone project.
 * Historical activity / Home Room sheets are READ ONLY. Writes go ONLY to new teacher Sheet.
 */
function periodCount_(session){const n=Number(session.Periods||1);return Number.isFinite(n)&&n>=1&&n<=9?n:1}
function percent_(num,den){return den>0?Math.round(num*10000/den)/100:null}
function riskLevel_(absent,total){if(!total)return 'NO_DATA';const pct=absent*100/total;return pct>=20?'PROBLEM':pct>=10?'RISK':'NORMAL'}
function riskLabel_(level){return {PROBLEM:'มีปัญหา',RISK:'เสี่ยง',NORMAL:'ปกติ',NO_DATA:'ยังไม่มีข้อมูล'}[level]||level}
function assembleAnalytics_(fromDate,toDate){
 const courses=rows_('Courses').filter(x=>truth_(x.Active));
 const students=new Map(rows_('Students').filter(x=>x.EnrollStatus==='ACTIVE').map(x=>[x.StudentID,x]));
 const teachers=new Map(rows_('Teachers').map(x=>[x.TeacherID,x]));
 const sessions=rows_('Sessions').filter(x=>x.Status==='CLOSED'&&
  (!fromDate||x.SessionDate>=fromDate)&&(!toDate||x.SessionDate<=toDate));
 const byCourseSessions=new Map();
 for(const sess of sessions){if(!byCourseSessions.has(sess.CourseID))byCourseSessions.set(sess.CourseID,[]);byCourseSessions.get(sess.CourseID).push(sess)}
 const attendance=new Map(rows_('Attendance').map(x=>[x.UniqueKey,x]));
 const byCourseEnrolled=new Map();
 for(const e of rows_('Enrollments').filter(x=>x.Status==='APPROVED')){
  if(!byCourseEnrolled.has(e.CourseID))byCourseEnrolled.set(e.CourseID,new Set());
  byCourseEnrolled.get(e.CourseID).add(e.StudentID);
 }
 const detail=[],courseReports=[];
 for(const course of courses){
  const unitSessions=byCourseSessions.get(course.CourseID)||[];
  const fullUnits=unitSessions.reduce((s,x)=>s+periodCount_(x),0);
  const cohort=byCourseEnrolled.get(course.CourseID)||new Set();
  const detailRows=[];
  for(const studentId of cohort){
   const person=students.get(studentId);if(!person)continue;
   const count={PRESENT:0,LATE:0,ABSENT:0,LEAVE:0};
   for(const sess of unitSessions){
    const record=attendance.get(sess.SessionID+'|'+studentId);
    const status=record&&Object.prototype.hasOwnProperty.call(count,record.Status)?record.Status:'ABSENT';
    count[status]+=periodCount_(sess);
   }
   const rate=percent_(count.ABSENT,fullUnits),attended=percent_(count.PRESENT+count.LATE,fullUnits),risk=riskLevel_(count.ABSENT,fullUnits);
   const row={courseId:course.CourseID,courseCode:course.CourseCode,courseName:course.Name,
    teacherId:course.TeacherID,teacherName:teachers.get(course.TeacherID)?.Name||course.TeacherID,
    room:course.ClassID,department:person.Department||teachers.get(course.TeacherID)?.Department||'ไม่ระบุ',
    studentId,studentName:person.Name,periods:fullUnits,present:count.PRESENT,late:count.LATE,
    absent:count.ABSENT,leave:count.LEAVE,attendancePercent:attended,absencePercent:rate,
    risk,riskLabel:riskLabel_(risk)};
   detail.push(row);detailRows.push(row);
  }
  const present=detailRows.reduce((sum,x)=>sum+x.present,0),late=detailRows.reduce((sum,x)=>sum+x.late,0);
  const absent=detailRows.reduce((sum,x)=>sum+x.absent,0),leave=detailRows.reduce((sum,x)=>sum+x.leave,0);
  const units=detailRows.reduce((sum,x)=>sum+x.periods,0);
  courseReports.push({courseId:course.CourseID,courseCode:course.CourseCode,courseName:course.Name,
   teacherId:course.TeacherID,teacherName:teachers.get(course.TeacherID)?.Name||course.TeacherID,
   room:course.ClassID,department:teachers.get(course.TeacherID)?.Department||detailRows[0]?.department||'ไม่ระบุ',
   students:detailRows.length,closedSessions:unitSessions.length,totalPeriods:fullUnits,
   attendedPercent:percent_(present+late,units),absentPercent:percent_(absent,units),
   problem:detailRows.filter(x=>x.risk==='PROBLEM').length,
   risk:detailRows.filter(x=>x.risk==='RISK').length,normal:detailRows.filter(x=>x.risk==='NORMAL').length,
   totalAbsence:absent,totalLeave:leave});
 }
 return {detail,courseReports};
}
function groupAttendance_(rows,keyOf,labelOf){
 const groups=new Map();
 for(const r of rows){
  const key=keyOf(r)||'ไม่ระบุ';
  if(!groups.has(key))groups.set(key,{key,label:labelOf(r)||key,students:new Map(),subjects:new Set(),units:0,present:0,late:0,absent:0,leave:0});
  const g=groups.get(key);
  g.units+=r.periods;g.present+=r.present;g.late+=r.late;g.absent+=r.absent;g.leave+=r.leave;
  g.subjects.add(r.courseId);
  const existing=g.students.get(r.studentId)||{id:r.studentId,name:r.studentName,units:0,absent:0};
  existing.units+=r.periods;existing.absent+=r.absent;g.students.set(r.studentId,existing);
 }
 return [...groups.values()].map(g=>{
  const ppl=[...g.students.values()];
  return {key:g.key,label:g.label,students:ppl.length,subjects:g.subjects.size,
    periods:g.units,attendancePercent:percent_(g.present+g.late,g.units),
    absencePercent:percent_(g.absent,g.units),
    problem:ppl.filter(s=>riskLevel_(s.absent,s.units)==='PROBLEM').length,
    risk:ppl.filter(s=>riskLevel_(s.absent,s.units)==='RISK').length,
    normal:ppl.filter(s=>riskLevel_(s.absent,s.units)==='NORMAL').length,
    noData:ppl.filter(s=>riskLevel_(s.absent,s.units)==='NO_DATA').length};
 }).sort((a,b)=>(b.problem-a.problem)||(b.risk-a.risk)||a.label.localeCompare(b.label,'th'));
}
function getDashboard(token){
 const actor=auth_(token);
 const all=cachedAnalytics_();
 const detail=actor.Role==='TEACHER'?all.detail.filter(x=>x.teacherId===actor.TeacherID):all.detail;
 const courses=actor.Role==='TEACHER'?all.courseReports.filter(x=>x.teacherId===actor.TeacherID):all.courseReports;
 const personTotals=new Map();
 for(const r of detail){
  const p=personTotals.get(r.studentId)||{units:0,absent:0};
  p.units+=r.periods;p.absent+=r.absent;personTotals.set(r.studentId,p);
 }
 const persons=[...personTotals.values()];
 const weighted=detail.reduce((g,x)=>{g.periods+=x.periods;g.attended+=x.present+x.late;g.absent+=x.absent;g.leave+=x.leave;return g},{periods:0,attended:0,absent:0,leave:0});
 const aggregate={
  students:persons.length,subjects:courses.length,closedPeriods:courses.reduce((n,c)=>n+c.totalPeriods,0),
  attendancePercent:percent_(weighted.attended,weighted.periods),
  absencePercent:percent_(weighted.absent,weighted.periods),
  problem:persons.filter(p=>riskLevel_(p.absent,p.units)==='PROBLEM').length,
  risk:persons.filter(p=>riskLevel_(p.absent,p.units)==='RISK').length,
  normal:persons.filter(p=>riskLevel_(p.absent,p.units)==='NORMAL').length,
   earlyPotential:new Set(detail.filter(r=>r.risk==='NORMAL'&&r.absencePercent!==null&&r.absencePercent>=7).map(r=>r.studentId)).size
 };
 return {actor:{id:actor.UserID,name:actor.Name,role:actor.Role,teacherId:actor.TeacherID},
  aggregate,courses,
  rooms:groupAttendance_(detail,x=>x.room,x=>x.room),
  teachers:groupAttendance_(detail,x=>x.teacherId,x=>x.teacherName),
  departments:groupAttendance_(detail,x=>x.department,x=>x.department),
  riskStudents:detail.filter(x=>x.risk!=='NORMAL'&&x.risk!=='NO_DATA')
    .sort((a,b)=>(b.absencePercent||0)-(a.absencePercent||0)).slice(0,300)};
}
function getCourseReport(token,courseId){
 checkCourse_(token,courseId);
 const a=cachedAnalytics_(),course=a.courseReports.find(x=>x.courseId===courseId);
 if(!course)throw Error('ไม่พบรายวิชา');
 const students=a.detail.filter(x=>x.courseId===courseId).sort((a,b)=>(b.absencePercent||0)-(a.absencePercent||0)||a.studentName.localeCompare(b.studentName,'th'));
 return {course,students};
}
function getStudentCourseHistory(token,courseId,studentId){
 checkCourse_(token,courseId);
 const student=rows_('Students').find(x=>x.StudentID===studentId);
 if(!student)throw Error('ไม่พบนักเรียน');
 const registered=rows_('Enrollments').some(x=>x.CourseID===courseId&&x.StudentID===studentId&&x.Status==='APPROVED');
 if(!registered)throw Error('นักเรียนไม่ได้ลงทะเบียนในวิชานี้');
 const allAttendance=new Map(rows_('Attendance').map(x=>[x.UniqueKey,x]));
 return rows_('Sessions').filter(x=>x.CourseID===courseId&&x.Status==='CLOSED')
  .map(x=>{const record=allAttendance.get(x.SessionID+'|'+studentId);return {
   sessionId:x.SessionID,date:x.SessionDate,topic:x.Topic,periods:periodCount_(x),
   status:record?.Status||'ABSENT',scannedAt:record?.ScanAt||'',note:record?.Note||''
  }}).sort((a,b)=>b.date.localeCompare(a.date));
}
function referralAppendAction_(actor,id,action,oldStatus,newStatus,note){
 tab_('ReferralActions').appendRow([rand_(),id,now_(),actor.UserID,actor.Role,action,oldStatus,newStatus,String(note||'').slice(0,500)]);
}
function createReferral(token,courseId,studentId,reason){
 return lock_(()=>{
  const {t,course}=checkCourse_(token,courseId);readOnlyExecutive_(t);
  const text=String(reason||'').trim().slice(0,600);
  if(text.length<10)throw Error('กรุณาระบุรายละเอียดปัญหาอย่างน้อย 10 ตัวอักษร');
  const stat=cachedAnalytics_().detail.find(x=>x.courseId===courseId&&x.studentId===studentId);
  if(!stat||stat.risk!=='PROBLEM')throw Error('ส่งต่อได้เฉพาะนักเรียนที่ขาดเรียนตั้งแต่ 20% ในรายวิชานี้');
  const duplicates=rows_('Referrals').find(x=>x.CourseID===courseId&&x.StudentID===studentId&&['NEW','IN_REVIEW','FORWARDED'].includes(x.Status));
  if(duplicates)return {ok:true,duplicate:true,id:duplicates.ReferralID,status:duplicates.Status};
  const id=rand_(),when=now_();
  tab_('Referrals').appendRow([id,stat.studentId,stat.studentName,courseId,course.CourseCode,t.TeacherID,course.ClassID,stat.department,
    stat.absencePercent,stat.attendancePercent,'PROBLEM',text,when,'NEW','','','','','',when]);
  referralAppendAction_(t,id,'SUBMITTED','', 'NEW',text);
  audit_(t.UserID,'REFERRAL_SUBMITTED',id,{courseId,studentId,absencePercent:stat.absencePercent});
  return {ok:true,duplicate:false,id,status:'NEW'};
 });
}
function listReferrals(token){
 const t=auth_(token);
 let list=rows_('Referrals');
 if(t.Role==='TEACHER')list=list.filter(x=>x.TeacherID===t.TeacherID);
 const latest=new Map();
 for(const f of rows_('ReferralFollowUps')){
  const old=latest.get(f.ReferralID);
  if(!old||old.ActionAt<f.ActionAt)latest.set(f.ReferralID,f);
 }
 // Executives may VIEW the same full set as admins. Forwarding changes the status to FORWARDED and is logged.
 return list.map(x=>({id:x.ReferralID,studentId:x.StudentID,studentName:x.StudentName,courseId:x.CourseID,
  courseCode:x.CourseCode,teacherId:x.TeacherID,room:x.Room,department:x.Department,
  absentPercent:Number(x.AbsencePct)||0,attendancePercent:Number(x.AttendancePct)||0,
  reason:x.Reason,createdAt:x.CreatedAt,status:x.Status,adminNote:x.AdminNote,
  forwardedAt:x.ExecutiveSentAt,adminBy:x.AdminReviewedBy,
  nextCheckDate:latest.get(x.ReferralID)?.NextCheckDate||'',
  followUpStatus:latest.get(x.ReferralID)?.Status||'',
  overdue:!!latest.get(x.ReferralID)?.NextCheckDate&&
   latest.get(x.ReferralID).NextCheckDate<Utilities.formatDate(new Date(),TZ_,'yyyy-MM-dd')&&x.Status!=='RESOLVED'}))
  .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function referralAction(token,id,action,note){
 return lock_(()=>{
  const t=auth_(token);if(t.Role!=='ADMIN')throw Error('เฉพาะผู้ดูแลระบบจึงสามารถดำเนินการส่งต่อ');
  const row=rows_('Referrals').find(x=>x.ReferralID===String(id));
  if(!row)throw Error('ไม่พบรายการส่งต่อ');
  action=String(action||'').toUpperCase();
  if(!['REVIEW','FORWARD','FOLLOW_UP','RESOLVE'].includes(action))throw Error('ประเภทการดำเนินการไม่ถูกต้อง');
  if(action==='REVIEW'&&row.Status!=='NEW')throw Error('รายการนี้ไม่ได้รอตรวจสอบ');
  if(action==='FORWARD'&&!['NEW','IN_REVIEW'].includes(row.Status))throw Error('รายการนี้ไม่พร้อมส่งต่อ');
  if(action==='FOLLOW_UP'&&row.Status!=='FORWARDED')throw Error('ต้องส่งต่อผู้บริหารก่อนติดตามผล');
  if(action==='RESOLVE'&&!['IN_REVIEW','FORWARDED','FOLLOW_UP'].includes(row.Status))throw Error('สถานะยังไม่พร้อมปิดเรื่อง');
  const detail=String(note||'').trim().slice(0,600);
  if(detail.length<5)throw Error('ระบุรายละเอียดการดำเนินงานอย่างน้อย 5 ตัวอักษร');
  const next=action==='REVIEW'?'IN_REVIEW':action==='FORWARD'?'FORWARDED':action==='FOLLOW_UP'?'FOLLOW_UP':'RESOLVED',at=now_();
  const sh=tab_('Referrals');
  sh.getRange(row._row,14).setValue(next);
  sh.getRange(row._row,15,1,3).setValues([[t.UserID,at,detail]]);
  if(action==='FORWARD')sh.getRange(row._row,18,1,2).setValues([[at,t.UserID]]);
  sh.getRange(row._row,20).setValue(at);
  referralAppendAction_(t,row.ReferralID,action,row.Status,next,detail);
  audit_(t.UserID,'REFERRAL_'+action,row.ReferralID,{before:row.Status,after:next,note:detail});
  return {ok:true,id:row.ReferralID,status:next};
 });
}