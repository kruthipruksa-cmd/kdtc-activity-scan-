'use strict';
const $=id=>document.getElementById(id),KEY='kdtc_teacher_endpoint_v1',TOKEN_KEY='kdtc_teacher_session_v1';
const state={endpoint:localStorage.getItem(KEY)||'',token:sessionStorage.getItem(TOKEN_KEY)||'',peer:null,origin:'',nonce:'',requests:new Map(),teacher:null,courses:[],roster:[],session:null,reviewed:null,reader:null,busy:false,lastScan:0};
const channel='KDTC_TEACHER_V1',label={PRESENT:'มา',LATE:'สาย',ABSENT:'ขาด',LEAVE:'ลา',SUGGESTED:'รอยืนยัน',APPROVED:'ยืนยันแล้ว'};
function message(s,err=false){$('notice').textContent=s||'';$('notice').className='notice'+(err?' err':'')}
function random(){return Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('')}
function validEndpoint(s){try{const u=new URL(s);return u.origin==='https://script.google.com'&&/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)&&!u.search&&!u.hash}catch(_){return false}}
function post(data){state.peer.postMessage(Object.assign({channel,nonce:state.nonce},data),state.origin)}
function rpc(method,...args){return new Promise((resolve,reject)=>{
 if(!state.peer)return reject(Error('ยังไม่เชื่อมต่อ Apps Script'));
 const id=random(),timer=setTimeout(()=>{state.requests.delete(id);reject(Error('หมดเวลาการเชื่อมต่อ กรุณาลองใหม่'))},30000);
 state.requests.set(id,{resolve,reject,timer});post({type:'rpc',id,method,args});
})}
window.addEventListener('message',event=>{
 const d=event.data;if(!d||d.channel!==channel||d.nonce!==state.nonce)return;
 let origin;try{origin=new URL(event.origin)}catch(_){return}
 if(origin.protocol!=='https:'||!origin.hostname.endsWith('-script.googleusercontent.com'))return;
 if(d.type==='ready'&&!state.peer){state.peer=event.source;state.origin=event.origin;post({type:'connected'});$('connection').textContent='เชื่อมต่อแล้ว';$('setup').hidden=true;message('เชื่อมต่อเรียบร้อย');restoreLogin();return}
 if(d.type!=='result'||event.source!==state.peer||event.origin!==state.origin)return;
 const p=state.requests.get(d.id);if(!p)return;clearTimeout(p.timer);state.requests.delete(d.id);
 d.error?p.reject(Error(d.error)):p.resolve(d.result);
});
function connect(){
 const value=$('endpoint').value.trim();
 if(!validEndpoint(value))return message('ลิงก์ Apps Script ไม่ถูกต้อง ต้องลงท้าย /exec ของระบบครูผู้สอน',true);
 state.peer=null;state.origin='';state.nonce=random();state.endpoint=value;
 state.requests.forEach(p=>{clearTimeout(p.timer);p.reject(Error('เชื่อมต่อใหม่'))});state.requests.clear();
 localStorage.setItem(KEY,value);$('connection').textContent='กำลังเชื่อมต่อ...';
 const u=new URL(value);u.searchParams.set('mode','teacherBridge');u.searchParams.set('nonce',state.nonce);
 $('bridge').src=u.href;const nonce=state.nonce;
 setTimeout(()=>{if(state.nonce===nonce&&!state.peer)message('ยังเชื่อมต่อไม่ได้: ตรวจการดีพลอยและไฟล์ TeacherBridge.html',true)},16000);
}
async function restoreLogin(){
 try{
  const status=await rpc('publicStatus');
  if(!status.ready)message('ระบบยังไม่นำเข้าข้อมูล กรุณาให้ผู้ดูแลตั้งค่าสิทธิ์แชร์และรัน setupFromSource_',true);
   if(!status.authReady)message('ยังไม่ได้เชื่อมการเข้าสู่ระบบ Home Room กับโครงการ Apps Script',true);
  if(state.token){try{const t=await rpc('me',state.token);return await showApp(t)}catch(e){sessionStorage.removeItem(TOKEN_KEY);state.token=''}}
  $('login').hidden=false;$('app').hidden=true;
 }catch(e){message(e.message,true)}
}
async function login(e){
 e.preventDefault();try{
  const result=await rpc('login',$('teacherId').value.trim(),$('pin').value);
  state.token=result.token;sessionStorage.setItem(TOKEN_KEY,state.token);$('pin').value='';
  await showApp({teacherId:result.teacherId,name:result.name,role:result.role});
  message('เข้าสู่ระบบแล้ว');
 }catch(e){message(e.message,true)}
}
async function showApp(t){
 state.teacher=t;$('identity').textContent=t.name+' · '+t.teacherId;
 $('app').hidden=false;$('login').hidden=true;
 await loadCourses();
}
async function loadCourses(){
 try{
  state.courses=await rpc('getCourses',state.token);
  const select=$('course');select.replaceChildren();
  const ordered=[...state.courses].sort((a,b)=>(a.teacherId===state.teacher.teacherId?-1:0)-(b.teacherId===state.teacher.teacherId?-1:0)||a.code.localeCompare(b.code));
  for(const c of ordered){const opt=document.createElement('option');opt.value=c.courseId;opt.textContent=c.code+' · '+c.name+' ('+c.classId+')';select.append(opt)}
  $('courseCount').textContent=state.courses.length+' รายวิชา';
  if(ordered.length)await loadCourse();else message('ไม่พบวิชาที่ได้รับมอบหมาย กรุณาติดต่อผู้ดูแล',true);
 }catch(e){message(e.message,true)}
}
function selectedCourse(){return state.courses.find(c=>c.courseId===$('course').value)}
async function loadCourse(){
 try{
  await stopCamera();state.session=null;updateSession();
  const c=selectedCourse();if(!c)return;
  state.roster=await rpc('getRoster',state.token,c.courseId);
  $('approvedCount').textContent=state.roster.filter(r=>r.status==='APPROVED').length;
  $('suggestedCount').textContent=state.roster.filter(r=>r.status==='SUGGESTED').length;
  $('rosterInfo').textContent=state.roster.length+' คน';
  renderRoster();
  state.session=await rpc('getOpenSession',state.token,c.courseId);
  updateSession();$('reportPanel').hidden=true;await refreshSessions(true);
 }catch(e){message(e.message,true)}
}
function renderRoster(){
 const body=$('rosterRows');body.replaceChildren();
 for(const r of state.roster){
  const tr=document.createElement('tr');[r.studentId,r.name,r.classId,label[r.status]||r.status].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});body.append(tr);
 }
 $('approveRoster').disabled=!state.roster.some(r=>r.status==='SUGGESTED')||!!state.session;
}
async function approveRoster(){
 const c=selectedCourse();if(!c)return;
 const waiting=state.roster.filter(r=>r.status==='SUGGESTED').length;
 if(!waiting)return message('ไม่มีรายชื่อรอตรวจสอบ');
 if(!confirm('ตรวจสอบรายชื่อแล้วใช่หรือไม่? ยืนยันนักเรียน '+waiting+' คนใน '+c.code+' '+c.classId+' เพื่อใช้งานเช็กชื่อ'))return;
 try{
  const r=await rpc('approveRoster',state.token,c.courseId);
  message('ยืนยันแล้ว '+r.approved+' คน');await loadCourse();
 }catch(e){message(e.message,true)}
}
function updateSession(){
 const s=state.session;
 $('sessionState').textContent=s?'เปิดอยู่':'ยังไม่เปิด';
 $('sessionInfo').textContent=s?'เปิด '+new Date(s.startAt).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}):'ยังไม่มีคาบที่เปิด';
 $('start').disabled=!!s||!selectedCourse()||!state.roster.some(r=>r.status==='APPROVED');
 $('close').disabled=!s;$('scanTools').hidden=!s;
 $('approveRoster').disabled=!!s||!state.roster.some(r=>r.status==='SUGGESTED');
 if(s)$('scanResult').textContent='พร้อมสแกน • '+s.date;
}
async function startSession(){
 const c=selectedCourse();if(!c)return;
 try{state.session=await rpc('startSession',state.token,c.courseId,$('topic').value);updateSession();await refreshSessions(false);await loadSessionAttendance();message('เปิดคาบเรียนแล้ว');}
 catch(e){message(e.message,true)}
}
async function closeSession(){
 if(!state.session||!confirm('ปิดคาบนี้และบันทึก "ขาด" ให้นักเรียนที่ไม่มีผลสแกนใช่หรือไม่?'))return;
 try{
  await stopCamera();
  const r=await rpc('closeSession',state.token,state.session.sessionId);
  message('ปิดคาบแล้ว • มา '+r.present+' สาย '+r.late+' ขาด '+r.absent+' ลา '+r.leave);
   state.session=null;updateSession();await refreshSessions(false);await loadSessionAttendance();await showReport();
 }catch(e){message(e.message,true)}
}
async function scan(raw){
 const now=Date.now();if(state.busy||!state.session||now-state.lastScan<900)return;
 state.busy=true;state.lastScan=now;
 try{
  const r=await rpc('scanStudent',state.token,state.session.sessionId,String(raw).trim());
  const statusText=label[r.status]||r.status;
  $('scanResult').textContent=r.name+' · '+r.classId+' · '+(r.duplicate?'สแกนซ้ำ':statusText);
  $('scanResult').className='scanResult '+(r.duplicate?'dup':r.status==='PRESENT'?'ok':r.status==='LATE'?'late':'absent');
  speak(r.duplicate?'สแกนซ้ำ':r.status==='PRESENT'?'ผ่านครับ':r.status==='LATE'?'สายแล้วครับ':'ขาดครับ');
  if(!r.duplicate){const li=document.createElement('li');li.textContent=r.name+' · '+statusText+' · '+new Date(r.scanAt).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok'});$('recent').prepend(li);while($('recent').children.length>12)$('recent').lastChild.remove()}
   if($('reviewSession').value===state.session.sessionId)await loadSessionAttendance();
 }catch(e){$('scanResult').textContent=e.message;$('scanResult').className='scanResult err';speak('ไม่ผ่านครับ')}
 finally{state.busy=false}
}
function speak(text){
 try{if('speechSynthesis' in window){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='th-TH';u.rate=1;speechSynthesis.speak(u);return}}catch(_){}
 try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const ctx=new A(),o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=840;g.gain.value=.15;o.start();o.stop(ctx.currentTime+.13)}catch(_){}
}
async function startCamera(){
 if(!state.session)return message('เปิดคาบเรียนก่อน',true);
 if(!window.Html5Qrcode)return message('โหลดเครื่องสแกนกล้องไม่สำเร็จ ให้ป้อนรหัสนักเรียนแทน',true);
 if(state.reader)return;
 try{state.reader=new Html5Qrcode('reader');await state.reader.start({facingMode:'environment'},{fps:8,qrbox:{width:220,height:220}},code=>scan(code),()=>{});message('เปิดกล้องแล้ว')}
 catch(e){state.reader=null;message('เปิดกล้องไม่ได้: '+e.message,true)}
}
async function stopCamera(){
 if(!state.reader)return;
 const r=state.reader;state.reader=null;
 try{await r.stop()}catch(_){}
 try{await r.clear()}catch(_){}
}
async function showReport(){
 const c=selectedCourse();if(!c)return;
 try{
  const r=await rpc('getReport',state.token,c.courseId);
  $('reportPanel').hidden=false;
  $('reportInfo').textContent='คาบเรียนที่ปิดแล้ว '+r.closedSessions+' คาบ • คิดร้อยละจากคาบเรียนที่ปิดจริง (ลาแสดงแยก ไม่นับเป็นมา)';
  const tbody=$('reportRows');tbody.replaceChildren();
  for(const s of r.students){
   const tr=document.createElement('tr');
   [s.name+' ('+s.studentId+')',s.present,s.late,s.absent,s.leave||0,s.percent===null?'-':s.percent.toFixed(2)+'%'].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td)});tbody.append(tr);
  }
 }catch(e){message(e.message,true)}
}
async function logout(){await stopCamera();try{if(state.token)await rpc('logout',state.token)}catch(_){}state.token='';state.teacher=null;sessionStorage.removeItem(TOKEN_KEY);$('app').hidden=true;$('login').hidden=false;message('ออกจากระบบแล้ว')}
$('connect').addEventListener('click',connect);
$('loginForm').addEventListener('submit',login);
$('course').addEventListener('change',loadCourse);
$('rosterBtn').addEventListener('click',()=>{$('rosterPanel').hidden=!$('rosterPanel').hidden});
$('hideRoster').addEventListener('click',()=>{$('rosterPanel').hidden=true});
$('approveRoster').addEventListener('click',approveRoster);
$('start').addEventListener('click',startSession);
$('close').addEventListener('click',closeSession);
$('camera').addEventListener('click',startCamera);
$('stopCamera').addEventListener('click',stopCamera);
$('manualForm').addEventListener('submit',e=>{e.preventDefault();const s=$('studentCode').value.trim();$('studentCode').value='';if(s)scan(s);$('studentCode').focus()});
$('reportBtn').addEventListener('click',showReport);
$('hideReport').addEventListener('click',()=>{$('reportPanel').hidden=true});
$('logout').addEventListener('click',logout);
$('refreshAttendance').addEventListener('click',loadSessionAttendance);
$('reviewSession').addEventListener('change',loadSessionAttendance);
$('openAttendance').addEventListener('click',async()=>{if(state.session)$('reviewSession').value=state.session.sessionId;await loadSessionAttendance();$('attendancePanel').scrollIntoView({behavior:'smooth',block:'start'});});
$('reconnect').addEventListener('click',()=>{$('setup').hidden=false;$('endpoint').focus();message('ใส่ลิงก์ Web App ของระบบครูผู้สอนใหม่')});
$('endpoint').value=state.endpoint;
if(validEndpoint(state.endpoint))connect();
