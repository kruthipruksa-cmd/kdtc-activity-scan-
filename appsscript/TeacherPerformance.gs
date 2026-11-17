/**
 * KDTC TeacherPerformance.gs — bounded, compressed Apps Script cache.
 * All source-of-truth writes stay in the NEW attendance Sheet.
 * Cached role/account snapshots expire within 30 seconds, analytic data within 75s,
 * and all attendance/roster mutations bump the revision immediately.
 */
function cacheGetObject_(key){
 try{
  const c=CacheService.getScriptCache(),n=Number(c.get(key+':n')||0);
  if(!Number.isInteger(n)||n<1||n>24)return null;
  const names=Array.from({length:n},(_,i)=>key+':'+i);
  const all=c.getAll(names);
  if(names.some(k=>typeof all[k]!=='string'))return null;
  const bytes=Utilities.base64Decode(names.map(k=>all[k]).join(''));
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(bytes)).getDataAsString('UTF-8'));
 }catch(e){return null}
}
function cachePutObject_(key,obj,seconds){
 try{
  const c=CacheService.getScriptCache();
  const binary=Utilities.gzip(Utilities.newBlob(JSON.stringify(obj),'application/json','cache.json')).getBytes();
  const str=Utilities.base64Encode(binary),chunkSize=65000;
  const count=Math.ceil(str.length/chunkSize);
  if(count<1||count>24)return false;
  const entries={};
  for(let i=0;i<count;i++)entries[key+':'+i]=str.slice(i*chunkSize,(i+1)*chunkSize);
  c.putAll(entries,seconds);c.put(key+':n',String(count),seconds);return true;
 }catch(e){return false}
}
function analyticsRevision_(){return prop_('TA_ANALYTICS_REV')||'0'}
function invalidateAnalytics_(){
 PropertiesService.getScriptProperties().setProperty('TA_ANALYTICS_REV',String(Date.now())+'-'+Utilities.getUuid().slice(0,8))
}
function scanRevision_(){return prop_('TA_SCAN_REV')||'0'}
function invalidateScanIndexes_(){
 PropertiesService.getScriptProperties().setProperty('TA_SCAN_REV',String(Date.now())+'-'+Utilities.getUuid().slice(0,8))
}
function cachedAnalytics_(){
 const key='TA_ANA_'+analyticsRevision_();
 const hit=cacheGetObject_(key);if(hit)return hit;
 const result=assembleAnalytics_();
 cachePutObject_(key,result,75);return result;
}
function scanStudentIndex_(){
 const key='TA_STUDENTS_'+scanRevision_(),hit=cacheGetObject_(key);
 if(hit)return hit;
 const byCode={},validCourses={};
 for(const student of rows_('Students')){
  const compact={id:student.StudentID,name:student.Name,classId:student.ClassID,active:student.EnrollStatus==='ACTIVE'};
  for(const code of [student.StudentID,student.ScanCode].filter(Boolean)){
   if(Object.prototype.hasOwnProperty.call(byCode,code)){
    byCode[code]=null; // duplicated code: always reject
   }else byCode[code]=compact;
  }
 }
 for(const e of rows_('Enrollments')){
  if(e.Status!=='APPROVED')continue;
  if(!validCourses[e.CourseID])validCourses[e.CourseID]={};
  validCourses[e.CourseID][e.StudentID]=1;
 }
 const data={byCode,validCourses};
 cachePutObject_(key,data,60);
 return data;
}
function scannerQrIndex_(){
 const key='TA_SCANNER_QR_V1',hit=cacheGetObject_(key);
 if(hit)return hit;
 const sh=SpreadsheetApp.openById(prop_('SCAN_SOURCE_SHEET_ID')).getSheetByName('STUDENTS');
 if(!sh)throw Error('ไม่พบแท็บ STUDENTS ของระบบสแกน');
 const size=sh.getLastRow();
 const raw=size>1?sh.getRange(2,1,size-1,8).getDisplayValues():[];
 const qr={};
 for(const r of raw){
  if(String(r[6]).toUpperCase()!=='TRUE')continue;
  const code=String(r[1]),token=String(r[7]).toUpperCase(),studentId=String(r[0]);
  const k=code+'|'+token;
  if(Object.prototype.hasOwnProperty.call(qr,k))qr[k]=null;
  else qr[k]=studentId;
 }
 cachePutObject_(key,qr,30);
 return qr;
}
function lookupFastScan_(raw,courseId){
 const text=String(raw||'').trim();
 if(!text||text.length>150)throw Error('รหัสสแกนไม่ถูกต้อง');
 const qr=text.toUpperCase().match(/^K\|(\d{4})\|([A-Z0-9]{6,20})$/);
 const token=qr?scannerQrIndex_()[qr[1]+'|'+qr[2]]:text.replace(/^STUDENT:/i,'').trim();
 if(!token)throw Error('QR ไม่ถูกต้องหรือไม่พบรหัสนักเรียน');
 const index=scanStudentIndex_(),student=index.byCode[token];
 if(!student)throw Error('ไม่พบรหัสนักเรียน หรือรหัสสแกนซ้ำ');
 if(!student.active)throw Error('บัญชีนักเรียนไม่ได้เปิดใช้งาน');
 if(!index.validCourses[courseId]||!index.validCourses[courseId][student.id])throw Error('นักเรียนยังไม่ได้รับการยืนยันในรายวิชานี้');
 return student;
}
function findAttendanceByKey_(key){
 const sh=tab_('Attendance'),last=sh.getLastRow();
 if(last<2)return null;
 const hit=sh.getRange(2,2,last-1,1).createTextFinder(String(key)).matchEntireCell(true).findNext();
 if(!hit)return null;
 const row=sh.getRange(hit.getRow(),1,1,HEADERS_.Attendance.length).getValues()[0];
 return {row:hit.getRow(),status:String(row[5]),scanAt:String(row[7])};
}
/**
 * Short-lived identity cache reduces Drive/Sheet calls on every scan.
 * 30s TTL means admin role revocation may take up to 30s to propagate.
 * Never caches a PIN, salt, hash, or password.
 */
function cachedActor_(id,loader){
 const key='TA_ACTOR_'+id;
 const cached=CacheService.getScriptCache().get(key);
 if(cached){try{return JSON.parse(cached)}catch(e){}}
 const actor=loader();
 CacheService.getScriptCache().put(key,JSON.stringify(actor),30);
 return actor;
}
function getPerformanceStatus(token){
 const actor=auth_(token);
 return {role:actor.Role,cacheTtlSeconds:75,scanIndexTtlSeconds:60,roleTtlSeconds:30,
  analyticRevision:analyticsRevision_(),scanRevision:scanRevision_()};
}