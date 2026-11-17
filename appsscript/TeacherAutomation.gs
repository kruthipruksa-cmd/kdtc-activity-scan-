/**
 * KDTC TeacherAutomation.gs — schedule-driven classroom attendance.
 * Manual scheduling is first-class; AutoOpen/AutoClose are opt-in per schedule.
 * ScriptApp time trigger is installed by authorized project OWNER in editor only.
 * No writes to the CARE NEXUS scan or Home Room Sheets.
 */
function localDayInfo_(date){
 const day=Utilities.formatDate(date,TZ_,'yyyy-MM-dd'),
       clock=Utilities.formatDate(date,TZ_,'HH:mm');
 const dow=new Date(day+'T12:00:00+07:00').getUTCDay()||7;
 return {day,clock,dow,minute:Number(clock.slice(0,2))*60+Number(clock.slice(3,5))};
}
function minuteOf_(s){
 if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(s)))throw Error('กรุณาระบุเวลา HH:mm');
 return Number(s.slice(0,2))*60+Number(s.slice(3,5));
}
function listTeachingSchedules(token){
 const actor=auth_(token),cMap=new Map(rows_('Courses').map(c=>[c.CourseID,c]));
 return rows_('TeachingSchedule').filter(x=>
  actor.Role!=='TEACHER'||x.TeacherID===actor.TeacherID
 ).map(x=>{
  const course=cMap.get(x.CourseID);
  return {scheduleId:x.ScheduleID,courseId:x.CourseID,
   teacherId:x.TeacherID,courseCode:course?.CourseCode||'',
   courseName:course?.Name||'',room:x.Room||course?.ClassID||'',
   dayOfWeek:Number(x.DayOfWeek),startTime:x.StartTime,endTime:x.EndTime,
   periods:Number(x.Periods)||1,topic:x.Topic,autoOpen:truth_(x.AutoOpen),
   autoClose:truth_(x.AutoClose),active:truth_(x.Active)};
 }).sort((a,b)=>a.dayOfWeek-b.dayOfWeek||a.startTime.localeCompare(b.startTime));
}
function saveTeachingSchedule(token,payload){
 return lock_(()=>{
  const actor=auth_(token);readOnlyExecutive_(actor);
  const courseId=String(payload?.courseId||'');
  const {course}=checkCourse_(token,courseId);
  if(actor.Role==='TEACHER'&&course.TeacherID!==actor.TeacherID)throw Error('ไม่มีสิทธิ์ตารางสอนนี้');
  const dow=Number(payload?.dayOfWeek),periods=Number(payload?.periods||1);
  const start=String(payload?.startTime||''),end=String(payload?.endTime||'');
  if(!Number.isInteger(dow)||dow<1||dow>7)throw Error('ระบุวันจันทร์ถึงอาทิตย์ (1–7)');
  if(!Number.isInteger(periods)||periods<1||periods>9)throw Error('จำนวนคาบต้องอยู่ระหว่าง 1–9');
  if(minuteOf_(end)<=minuteOf_(start))throw Error('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  const autoOpen=payload?.autoOpen===true?'TRUE':'FALSE',
        autoClose=payload?.autoClose===true?'TRUE':'FALSE',
        active=payload?.active===false?'FALSE':'TRUE';
  const id=String(payload?.scheduleId||'').trim();
  const existing=id?rows_('TeachingSchedule').find(x=>x.ScheduleID===id):null;
  if(id&&!existing)throw Error('ไม่พบตารางสอนที่จะปรับปรุง');
  if(existing&&actor.Role==='TEACHER'&&existing.TeacherID!==actor.TeacherID)throw Error('ไม่มีสิทธิ์แก้ตารางสอนนี้');
  const now=now_(),scheduleId=existing?existing.ScheduleID:rand_();
  const data=[scheduleId,courseId,course.TeacherID,dow,start,end,periods,
    String(payload?.room||course.ClassID||'').slice(0,80),
    String(payload?.topic||'').slice(0,200),autoOpen,autoClose,active,now];
  const sh=tab_('TeachingSchedule');
  if(existing)sh.getRange(existing._row,1,1,data.length).setValues([data]);
  else sh.appendRow(data);
  audit_(actor.UserID,existing?'SCHEDULE_UPDATE':'SCHEDULE_ADD',scheduleId,
   {courseId,dow,start,end,autoOpen,autoClose,active});
  return {ok:true,scheduleId};
 });
}
function disableTeachingSchedule(token,id){
 return lock_(()=>{
  const actor=auth_(token);readOnlyExecutive_(actor);
  const row=rows_('TeachingSchedule').find(x=>x.ScheduleID===String(id));
  if(!row)throw Error('ไม่พบตารางสอน');
  if(actor.Role==='TEACHER'&&row.TeacherID!==actor.TeacherID)throw Error('ไม่มีสิทธิ์ตารางสอนนี้');
  tab_('TeachingSchedule').getRange(row._row,12,1,2).setValues([['FALSE',now_()]]);
  audit_(actor.UserID,'SCHEDULE_DISABLE',id,{});return {ok:true};
 });
}
function getTodayTeaching(token){
 const actor=auth_(token),today=localDayInfo_(new Date());
 const courses=new Map(rows_('Courses').map(c=>[c.CourseID,c]));
 const opened=new Map(rows_('Sessions').filter(x=>x.Status==='OPEN').map(s=>[s.CourseID,s]));
 const active=rows_('TeachingSchedule').filter(x=>
  truth_(x.Active)&&Number(x.DayOfWeek)===today.dow&&
  (actor.Role!=='TEACHER'||x.TeacherID===actor.TeacherID)
 );
 return {date:today.day,now:today.clock,
  rows:active.map(x=>{
   const c=courses.get(x.CourseID),sess=opened.get(x.CourseID);
   return {scheduleId:x.ScheduleID,courseId:x.CourseID,
    courseCode:c?.CourseCode||'',courseName:c?.Name||'',room:x.Room||c?.ClassID||'',
    start:x.StartTime,end:x.EndTime,periods:Number(x.Periods)||1,
    topic:x.Topic,autoOpen:truth_(x.AutoOpen),autoClose:truth_(x.AutoClose),
    openSessionId:sess?.SessionID||'',forgotClose:!!sess&&today.minute>minuteOf_(x.EndTime)+5,
    startsSoon:!sess&&today.minute>=minuteOf_(x.StartTime)-15&&today.minute<=minuteOf_(x.StartTime)+5};
  }).sort((a,b)=>a.start.localeCompare(b.start))
 };
}
/** Reminder: list open sessions that may have been forgotten, without auto-closing them. */
function getOpenSessionWarnings(token){
 const actor=auth_(token),now=Date.now();
 const courses=new Map(rows_('Courses').map(x=>[x.CourseID,x]));
 const open=rows_('Sessions').filter(x=>x.Status==='OPEN'&&
   (actor.Role!=='TEACHER'||x.TeacherID===actor.TeacherID));
 const warnings=[];
 for(const session of open){
  const elapsed=Math.round((now-Date.parse(session.StartAt))/60000);
  if(!Number.isFinite(elapsed)||elapsed<180)continue;
  const course=courses.get(session.CourseID);
  warnings.push({sessionId:session.SessionID,courseId:session.CourseID,
   courseCode:course?.CourseCode||'',room:course?.ClassID||'',
   startAt:session.StartAt,elapsedMinutes:elapsed,periods:periodCount_(session)});
 }
 return warnings.sort((a,b)=>b.elapsedMinutes-a.elapsedMinutes).slice(0,40);
}
/**
 * OWNER ONLY: run once in the Apps Script editor to enable/repair one 5-min trigger.
 * To stop, use ScriptApp.getProjectTriggers() and remove only tickTeachingSchedule_.
 */
function installTeachingScheduleTrigger_(){
 const fn='tickTeachingSchedule_';
 if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===fn))
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(5).create();
 return 'ติดตั้งทริกเกอร์สำเร็จ ตรวจสอบรายการ Triggers ในโครงการนี้';
}
/**
 * Trigger processes only schedules with teacher opt-in. All reads to legacy sources
 * are read-only; attendance writes go to new Sheet under one global script lock.
 */
function tickTeachingSchedule_(){
 requireRestrictedSheets_();
 return lock_(()=>{
  const now=new Date(),time=localDayInfo_(now);
  const schedules=rows_('TeachingSchedule').filter(s=>truth_(s.Active)&&Number(s.DayOfWeek)===time.dow&&
    (truth_(s.AutoOpen)||truth_(s.AutoClose)));
  if(!schedules.length)return {opened:0,closed:0};
  const sessions=rows_('Sessions'),courses=new Map(rows_('Courses').map(c=>[c.CourseID,c]));
  const approved=new Set(rows_('Enrollments').filter(e=>e.Status==='APPROVED').map(e=>e.CourseID));
  const activeSessions=new Map(sessions.filter(s=>s.Status==='OPEN').map(s=>[s.CourseID,s]));
  const enrolled=rows_('Enrollments').filter(e=>e.Status==='APPROVED');
  const attendance=schedules.some(s=>truth_(s.AutoClose))?rows_('Attendance'):[];
  const missingRecords=[];
  let opened=0,closed=0;
  for(const sch of schedules){
   const course=courses.get(sch.CourseID);
   if(!course||!truth_(course.Active))continue;
   const start=minuteOf_(sch.StartTime),end=minuteOf_(sch.EndTime);
   if(truth_(sch.AutoOpen)&&time.minute>=start&&time.minute<start+10&&approved.has(sch.CourseID)){
    const already=sessions.some(s=>s.ScheduleID===sch.ScheduleID&&s.SessionDate===time.day);
    if(!already&&!activeSessions.has(sch.CourseID)){
     const p=Math.max(0,Math.min(120,Number(setting_('PRESENT_MINUTES',10))||10));
     const l=Math.max(p+1,Math.min(240,Number(setting_('LATE_MINUTES',25))||25));
     const id=rand_(),ts=now.toISOString();
     const row=[id,sch.CourseID,time.day,ts,new Date(now.getTime()+p*60000).toISOString(),
       new Date(now.getTime()+l*60000).toISOString(),'OPEN',sch.TeacherID,'',sch.Topic,
       Number(sch.Periods)||1,sch.ScheduleID];
     tab_('Sessions').appendRow(row);
     activeSessions.set(sch.CourseID,Object.fromEntries(HEADERS_.Sessions.map((h,i)=>[h,row[i]])));
     audit_('SCHEDULER','AUTO_START',id,{scheduleId:sch.ScheduleID,courseId:sch.CourseID});
     opened++;
    }
   }
   const sess=activeSessions.get(sch.CourseID);
   if(truth_(sch.AutoClose)&&sess&&sess.ScheduleID===sch.ScheduleID&&
     sess.SessionDate===time.day&&time.minute>=end+5){
    const seen=new Set(attendance.filter(x=>x.SessionID===sess.SessionID).map(x=>x.StudentID));
    const when=now.toISOString();
    const extra=enrolled.filter(x=>x.CourseID===sch.CourseID&&!seen.has(x.StudentID))
      .map(x=>[rand_(),sess.SessionID+'|'+x.StudentID,sess.SessionID,sch.CourseID,x.StudentID,
       'ABSENT',when,'AUTO_SCHEDULE_CLOSE',sch.TeacherID,when,'ระบบปิดคาบตามตารางที่เปิดใช้งาน']);
    missingRecords.push(...extra);
    const sh=tab_('Sessions');
    sh.getRange(sess._row,7).setValue('CLOSED');
    sh.getRange(sess._row,9).setValue(when);
    audit_('SCHEDULER','AUTO_CLOSE',sess.SessionID,{absentAdded:extra.length,scheduleId:sch.ScheduleID});
    activeSessions.delete(sch.CourseID);
    closed++;
   }
  }
  if(missingRecords.length){
   const sh=tab_('Attendance');
   sh.getRange(sh.getLastRow()+1,1,missingRecords.length,11).setValues(missingRecords);
  }
  if(opened||closed)invalidateAnalytics_();
  return {opened,closed};
 });
}