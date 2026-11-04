'use strict';
const $ = id => document.getElementById(id);
const config = window.POCKETPAD_CONFIG || {};
const defaults = {sensitivity:14,dead:4,invert:false};
let settings = {...defaults}, mode = 'arrows', held = new Set(), seq = 0;
let ws, topic, session, cryptoKey, paired = false, joined = false, gyroEnabled = false, baseline = null, latest = null, sensorCount = 0, touchOrigin = null;
const b64bytes = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-s.length%4)%4)), c=>c.charCodeAt(0));
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function status(s){$('status').textContent=s;}
function updateDirection(){ $('direction').textContent='Direction: '+([...held].join(' + ')||'neutral'); }
function setKeys(keys){ held = new Set(keys); updateDirection(); send(); }
async function send(){
  if(!joined || ws?.readyState!==WebSocket.OPEN || !cryptoKey)return;
  try{
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const data=new TextEncoder().encode(JSON.stringify({seq:++seq,keys:[...held]}));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(session)},cryptoKey,data);
    ws.send(JSON.stringify({topic,event:'broadcast',payload:{type:'broadcast',event:'control',payload:{n:b64(iv),c:b64(new Uint8Array(encrypted))}},ref:null}));
  }catch(e){status('Send error');}
}
function release(){setKeys([]);}
function reset(){settings={...defaults};$('sensitivity').value=14;$('dead').value=4;$('invert').checked=false;renderSettings();baseline=null;release();}
function renderSettings(){$('sensitivityValue').textContent=settings.sensitivity;$('deadValue').textContent=settings.dead;}
function directional(dx,dy,threshold){let keys=[];if(dy< -threshold)keys.push('up');if(dy>threshold)keys.push('down');if(dx< -threshold)keys.push(settings.invert?'right':'left');if(dx>threshold)keys.push(settings.invert?'left':'right');return keys;}
function chooseMode(m){mode=m;release();for(const id of ['arrows','joystick','gyro','touch'])$(id).hidden=id!==m; if(m==='gyro')gyroDiagnostics();}
function gyroDiagnostics(){let secure=isSecureContext; $('diagnostics').textContent=`Secure context: ${secure?'yes':'NO'} | Sensor API: ${'DeviceOrientationEvent' in window?'present':'missing'} | Sensor events: ${sensorCount} | Relay: ${joined?'connected':'disconnected'}`;}
function orientation(e){
  if(!gyroEnabled)return;
  if(e.beta==null||e.gamma==null){$('gyroStatus').textContent='Sensor returned no readings';return;}
  sensorCount++;latest={beta:e.beta,gamma:e.gamma};
  if(!baseline)baseline={...latest};
  let dx=(latest.gamma-baseline.gamma),dy=(latest.beta-baseline.beta);
  $('readings').textContent=`β ${e.beta.toFixed(1)}° | γ ${e.gamma.toFixed(1)}° | Δx ${dx.toFixed(1)}° | Δy ${dy.toFixed(1)}°`;
  $('gyroStatus').textContent='Sensors working — tilt to steer';gyroDiagnostics();
  if(mode==='gyro')setKeys(directional(dx,dy,settings.dead*14/settings.sensitivity));
}
async function enableGyro(){
  gyroDiagnostics();
  if(!isSecureContext){$('gyroStatus').textContent='Blocked: open the Vercel HTTPS URL, not local HTTP.';return;}
  if(!('DeviceOrientationEvent' in window)){$('gyroStatus').textContent='Device orientation unsupported in this browser.';return;}
  try{
    if(typeof DeviceOrientationEvent.requestPermission==='function'){
      const permission=await DeviceOrientationEvent.requestPermission();
      if(permission!=='granted')throw Error('Sensor permission denied');
    }
    gyroEnabled=true;baseline=null;sensorCount=0;
    window.addEventListener('deviceorientation',orientation);
    $('gyroStatus').textContent='Listening for sensor events. Move the phone.';
    setTimeout(()=>{if(gyroEnabled&&sensorCount===0)$('gyroStatus').textContent='No sensor events received. Check Chrome site permissions and device sensors.';},2500);
  }catch(e){$('gyroStatus').textContent='Sensor access failed: '+e.message;}
}
function connect(){
  const p=new URLSearchParams(location.hash.slice(1));session=p.get('session');const key=p.get('key');
  history.replaceState(null,'',location.pathname); // Never retain the pairing secret in URL history.
  if(!/^[a-f0-9]{32}$/.test(session||'') || !/^[A-Za-z0-9_-]{43}$/.test(key||'')){$('pairError').textContent='No valid pairing QR detected.';return;}
  if(!/^https:\/\//.test(config.supabaseUrl||'') || !config.supabaseAnonKey){$('pairError').textContent='Site is not configured with Supabase Realtime.';return;}
  crypto.subtle.importKey('raw',b64bytes(key),'AES-GCM',false,['encrypt']).then(k=>{cryptoKey=k;paired=true;$('pair').hidden=true;$('controller').hidden=false;openRelay();}).catch(()=>{$('pairError').textContent='Invalid pairing secret.';});
}
function openRelay(){
  if(!paired)return;
  const host=new URL(config.supabaseUrl).host;
  topic='realtime:pocketpad-'+session;
  ws=new WebSocket(`wss://${host}/realtime/v1/websocket?apikey=${encodeURIComponent(config.supabaseAnonKey)}&vsn=1.0.0`);
  ws.onopen=()=>{ws.send(JSON.stringify({topic,event:'phx_join',payload:{config:{broadcast:{ack:false,self:false},presence:{key:''},private:false}},ref:'1'}));};
  ws.onmessage=ev=>{try{const msg=JSON.parse(ev.data);if(msg.event==='phx_reply'&&msg.ref==='1'&&msg.payload?.status==='ok'){joined=true;status('Relay connected');send();}if(msg.event==='phx_error'){joined=false;status('Relay error');}}catch{}};
  ws.onclose=()=>{joined=false;release();status('Reconnecting…');if(paired)setTimeout(openRelay,2500);};
  ws.onerror=()=>{status('Relay connection failed');};
}
function start(){
  $('mode').addEventListener('change',e=>chooseMode(e.target.value));
  $('disconnect').onclick=()=>{release();paired=false;joined=false;ws?.close();$('controller').hidden=true;$('pair').hidden=false;$('pairError').textContent='Disconnected. Scan a new QR code to reconnect.';status('Disconnected');};
  $('reset').onclick=reset;
  $('sensitivity').oninput=e=>{settings.sensitivity=+e.target.value;renderSettings();};
  $('dead').oninput=e=>{settings.dead=+e.target.value;renderSettings();};
  $('invert').onchange=e=>settings.invert=e.target.checked;
  for(const button of document.querySelectorAll('[data-key]')){
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);setKeys([button.dataset.key]);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,release);
  }
  const stick=$('stick'),knob=$('knob');
  function moveStick(e){const r=stick.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,max=r.width/2-38;const scale=Math.min(1,max/Math.max(1,Math.hypot(x,y)));const dx=x*scale,dy=y*scale;knob.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;setKeys(directional(dx,dy,Math.max(7,settings.dead*2*14/settings.sensitivity)));}
  stick.onpointerdown=e=>{stick.setPointerCapture(e.pointerId);moveStick(e);};stick.onpointermove=e=>{if(stick.hasPointerCapture(e.pointerId))moveStick(e);};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,()=>{knob.style.transform='translate(-50%,-50%)';release();});
  $('enableGyro').onclick=enableGyro;$('calibrate').onclick=()=>{if(latest){baseline={...latest};release();$('gyroStatus').textContent='Neutral position calibrated';}else $('gyroStatus').textContent='Enable sensors and wait for readings first';};
  const zone=$('touchzone');
  function three(e){e.preventDefault();if(e.touches.length!==3){touchOrigin=null;release();return;}let x=0,y=0;for(const t of e.touches){x+=t.clientX;y+=t.clientY;}x/=3;y/=3;if(!touchOrigin)touchOrigin={x,y};const dx=x-touchOrigin.x,dy=y-touchOrigin.y;setKeys(directional(dx,dy,Math.max(8,settings.dead*3*14/settings.sensitivity)));$('touchlabel').textContent='Δx '+Math.round(dx)+' | Δy '+Math.round(dy);}
  for(const type of ['touchstart','touchmove','touchend','touchcancel'])zone.addEventListener(type,three,{passive:false});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});window.addEventListener('blur',release);
  setInterval(()=>{if(paired&&joined)send();},250);
  setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(Date.now())}));},20000);
  reset();gyroDiagnostics();connect();
}
start();
