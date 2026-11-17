/**
 * KDTC TeacherInsights.gs — early warnings, student 360, executive one-page,
 * follow-up chronology and attendance audit. Uses only NEW attendance data.
 */
function allowedDetail_(actor,row){
 return actor.Role!=='TEACHER'||row.teacherId===actor.TeacherID;
}
function studentAccess_(actor,studentId,all){
 const detail=all.detail.filter(r=>r.studentId===studentId&&allowedDetail_(actor,r));
 if(!detail.length)throw Error('ไม่มีสิทธิ์ดูนักเรียนคนนี้ หรือไม่มีรายวิชาที่อนุมัติ');
 return detail;
}
function riskNotice_(row,streak){
 if(row.risk==='PROBLEM')return 'PROBLEM';
 if(row.risk==='RISK')return 'RISK';
 if(streak>=2||row.absencePercent!==null&&row.absencePercent>=7)return 'EARLY';
 return 'NORMAL';
}
function getEarlyWarnings(token){
 const actor=auth_(token),a=cachedAnalytics_();
 const sessions=rows_('Sessions').filter(s=>s.Status==='CLOSED');
 const byCourse=new Map();
 for(const x of sessions){
  if(!byCourse.has(x.CourseID))byCourse.set(x.CourseID,[]);
  byCourse.get(x.CourseID).push(x);
 }
 for(const arr of byCourse.values())arr.sort((a,b)=>Date.parse(b.StartAt)-Date.parse(a.StartAt));
 const results=new Map(rows_('Attendance').map(x=>[x.UniqueKey,x.Status]));
 const alerts=[];
 for(const item of a.detail){
  if(!allowedDetail_(actor,item)||!item.periods)continue;
  let consecutive=0;
  for(const session of (byCourse.get(item.courseId)||[]).slice(0,10)){
   const status=results.get(session.SessionID+'|'+item.studentId)||'ABSENT';
   if(status==='ABSENT')consecutive+=periodCount_(session);else break;
  }
  const level=riskNotice_(item,consecutive);
  if(level==='NORMAL')continue;
  alerts.push({...item,warning:level,consecutiveAbsentPeriods:consecutive,
   message:level==='EARLY'?'เริ่มขาดบ่อย / ขาดต่อเนื่อง':level==='RISK'?'เสี่ยงขาดเรียน':'มีปัญหาขาดเรียน'});
 }
 const rank={PROBLEM:3,RISK:2,EARLY:1};
 alerts.sort((a,b)=>(rank[b.warning]-rank[a.warning])||(b.consecutiveAbsentPeriods-a.consecutiveAbsentPeriods)||(b.absencePercent-a.absencePercent));
 return {updatedAt:now_(),total:alerts.length,
  problem:alerts.filter(a=>a.warning==='PROBLEM').length,
  risk:alerts.filter(a=>a.warning==='RISK').length,
  early:alerts.filter(a=>a.warning==='EARLY').length,
  students:alerts.slice(0,500)};
}
function getStudent360(token,studentId){
 const actor=auth_(token),a=cachedAnalytics_(),id=String(studentId||'').trim();
 const detail=studentAccess_(actor,id,a);
 const student=rows_('Students').find(s=>s.StudentID===id);
 if(!student)throw Error('ไม่พบข้อมูลนักเรียน');
 const allowedCourseIds=new Set(detail.map(r=>r.courseId));
 const sessions=rows_('Sessions').filter(s=>s.Status==='CLOSED'&&allowedCourseIds.has(s.CourseID));
 const scans=new Map(rows_('Attendance').filter(s=>s.StudentID===id).map(x=>[x.SessionID,x]));
 const byCourse=new Map();
 for(const x of sessions){if(!byCourse.has(x.CourseID))byCourse.set(x.CourseID,[]);byCourse.get(x.CourseID).push(x)}
 const courses=detail.map(row=>{
  const history=(byCourse.get(row.courseId)||[]).sort((a,b)=>Date.parse(b.StartAt)-Date.parse(a.StartAt)).slice(0,8)
   .map(session=>{
    const scan=scans.get(session.SessionID);
    return {date:session.SessionDate,periods:periodCount_(session),
     topic:session.Topic,status:scan?.Status||'ABSENT',scannedAt:scan?.ScanAt||''};
   });
  return {...row,history};
 });
 const allReferrals=rows_('Referrals').filter(x=>x.StudentID===id&&
  (actor.Role!=='TEACHER'||x.TeacherID===actor.TeacherID));
 const totals=detail.reduce((out,x)=>{
  out.periods+=x.periods;out.present+=x.present;out.late+=x.late;out.absent+=x.absent;out.leave+=x.leave;return out;
 },{periods:0,present:0,late:0,absent:0,leave:0});
 return {student:{id,name:student.Name,classId:student.ClassID,department:student.Department},
  summary:{...totals,attendancePercent:percent_(totals.present+totals.late,totals.periods),
   absencePercent:percent_(totals.absent,totals.periods),risk:riskLevel_(totals.absent,totals.periods),
   problemCourses:detail.filter(x=>x.risk==='PROBLEM').length},
  courses,referrals:allReferrals.map(x=>({id:x.ReferralID,courseCode:x.CourseCode,
   status:x.Status,createdAt:x.CreatedAt,reason:x.Reason})).slice(0,40)};
}
function getAttendanceAudit(token,courseId,studentId){
 checkCourse_(token,courseId);
 const id=String(studentId||'');
 if(!rows_('Enrollments').some(x=>x.CourseID===courseId&&x.StudentID===id&&x.Status==='APPROVED'))
  throw Error('ไม่พบการลงทะเบียนในรายวิชานี้');
 const sessions=new Set(rows_('Sessions').filter(x=>x.CourseID===courseId).map(x=>x.SessionID+'|'+id));
 return rows_('AuditLog').filter(x=>x.Action==='CORRECT_ATTENDANCE'&&sessions.has(x.Entity))
   .map(x=>{let detail={};try{detail=JSON.parse(x.Details||'{}')}catch(_){}
    return {at:x.At,by:x.ActorTeacherID,before:detail.before||'',after:detail.after||'',
     note:detail.note||'',sessionId:x.Entity.split('|')[0]};
   }).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,70);
}
function executiveScope_(token){
 const actor=auth_(token);
 if(!['ADMIN','EXECUTIVE'].includes(actor.Role))throw Error('รายงานนี้สำหรับผู้ดูแลและผู้บริหาร');
 return actor;
}
function executiveRange_(start,end){
 const from=String(start||''),to=String(end||'');
 if(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))throw Error('วันที่เริ่มต้นไม่ถูกต้อง');
 if(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))throw Error('วันที่สิ้นสุดไม่ถูกต้อง');
 if(from&&to&&from>to)throw Error('วันที่สิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น');
 return {from,to};
}
function executiveData_(token,start,end,department){
 executiveScope_(token);
 const {from,to}=executiveRange_(start,end);
 const src=from||to?assembleAnalytics_(from,to):cachedAnalytics_();
 const target=String(department||'').trim();
 const detail=target?src.detail.filter(x=>x.department===target):src.detail;
 const courses=target?src.courseReports.filter(x=>x.department===target):src.courseReports;
 return {from,to,department:target,detail,courses};
}
function getExecutiveOnePage(token,start,end,department){
 const data=executiveData_(token,start,end,department),d=data.detail;
 const persons=new Map();
 for(const row of d){
  const person=persons.get(row.studentId)||{studentId:row.studentId,studentName:row.studentName,room:row.room,department:row.department,periods:0,absent:0};
  person.periods+=row.periods;person.absent+=row.absent;persons.set(row.studentId,person);
 }
 const values=[...persons.values()].map(p=>({...p,
  absencePercent:percent_(p.absent,p.periods),risk:riskLevel_(p.absent,p.periods)}));
 const totalUnits=d.reduce((a,x)=>a+x.periods,0),attended=d.reduce((a,x)=>a+x.present+x.late,0);
 const severe=values.filter(x=>x.risk==='PROBLEM').sort((a,b)=>b.absencePercent-a.absencePercent);
 const state={students:values.length,courses:data.courses.length,
  attendancePercent:percent_(attended,totalUnits),absencePercent:percent_(d.reduce((a,x)=>a+x.absent,0),totalUnits),
  problem:severe.length,risk:values.filter(x=>x.risk==='RISK').length,
  normal:values.filter(x=>x.risk==='NORMAL').length};
 return {from:data.from,to:data.to,department:data.department,generatedAt:now_(),
  summary:state,rooms:groupAttendance_(d,x=>x.room,x=>x.room),
  departments:groupAttendance_(d,x=>x.department,x=>x.department),
  teachers:groupAttendance_(d,x=>x.teacherId,x=>x.teacherName),
  problematicCourses:data.courses.filter(x=>x.problem).sort((a,b)=>b.problem-a.problem).slice(0,12),
  problemStudents:severe.slice(0,20)};
}
function getExecutiveExport(token,start,end,department){
 const data=executiveData_(token,start,end,department);
 const headers=['รหัสนักเรียน','ชื่อ-สกุล','ห้อง','แผนก','รหัสวิชา','ชื่อวิชา','ผู้สอน','คาบทั้งหมด','มา','สาย','ขาด','ลา','เข้าเรียน%','ขาด%','สถานะ'];
 const rows=data.detail.slice(0,10000).map(x=>[
  x.studentId,x.studentName,x.room,x.department,x.courseCode,x.courseName,x.teacherName,
  x.periods,x.present,x.late,x.absent,x.leave,x.attendancePercent,x.absencePercent,x.riskLabel
 ]);
 return {headers,rows,from:data.from,to:data.to,department:data.department,truncated:data.detail.length>10000};
}
function referralAuthorized_(actor,referral){
 if(!referral)throw Error('ไม่พบข้อมูลส่งต่อ');
 if(actor.Role==='TEACHER'&&referral.TeacherID!==actor.TeacherID)throw Error('ไม่มีสิทธิ์รายการนี้');
 return referral;
}
function getReferralTimeline(token,referralId){
 const actor=auth_(token),row=referralAuthorized_(actor,rows_('Referrals').find(x=>x.ReferralID===String(referralId)));
 const actions=rows_('ReferralActions').filter(x=>x.ReferralID===row.ReferralID).map(x=>({
  at:x.At,actor:x.ActorID,kind:'STATUS',action:x.Action,
  note:x.Note,before:x.FromStatus,after:x.ToStatus
 }));
 const followups=rows_('ReferralFollowUps').filter(x=>x.ReferralID===row.ReferralID).map(x=>({
  at:x.ActionAt,actor:x.ActorID,kind:'FOLLOWUP',action:x.ActionType,note:x.Note,
  nextCheckDate:x.NextCheckDate,status:x.Status
 }));
 return {referralId:row.ReferralID,status:row.Status,
  timeline:actions.concat(followups).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,100)};
}
function addReferralFollowUp(token,referralId,actionType,note,nextDate){
 return lock_(()=>{
  const actor=auth_(token);readOnlyExecutive_(actor);
  const row=referralAuthorized_(actor,rows_('Referrals').find(x=>x.ReferralID===String(referralId)));
  if(row.Status==='RESOLVED')throw Error('เรื่องนี้ปิดแล้ว');
  const type=String(actionType||'').toUpperCase();
  if(!['CALL','PARENT_CONTACT','COUNSEL','HOME_VISIT','OTHER'].includes(type))throw Error('ประเภทการช่วยเหลือไม่ถูกต้อง');
  const message=String(note||'').trim().slice(0,800);
  if(message.length<10)throw Error('อธิบายผลการติดตามอย่างน้อย 10 ตัวอักษร');
  const date=String(nextDate||'');
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('วันที่ติดตามครั้งถัดไปไม่ถูกต้อง');
  const at=now_(),id=rand_();
  tab_('ReferralFollowUps').appendRow([id,row.ReferralID,row.StudentID,actor.UserID,at,
    type,message,date,'OPEN',at]);
  referralAppendAction_(actor,row.ReferralID,'FOLLOWUP_NOTE',row.Status,row.Status,message);
  tab_('Referrals').getRange(row._row,20).setValue(at);
  audit_(actor.UserID,'REFERRAL_FOLLOWUP',row.ReferralID,{type,nextDate:date});
  return {ok:true,id,referralId:row.ReferralID};
 });
}