(function(){
"use strict";

var W=128,H=96,N=W*H;
var STRIPS=8, STRIP_W=W/STRIPS, STRIP_PIX=STRIP_W*H;

var video=document.getElementById('video');
var stage=document.getElementById('stage');
var cue=document.getElementById('cue');
var readout=document.getElementById('readout');
var statusEl=document.getElementById('status');
var mainBtn=document.getElementById('main');
var haltBtn=document.getElementById('halt');
var redoBtn=document.getElementById('redo');
var bar=document.getElementById('bar');
var mark=document.getElementById('mark');
var lapsEl=document.getElementById('laps');
var lapsEmpty=document.getElementById('lapsEmpty');
var modeEl=document.getElementById('mode');
var sensEl=document.getElementById('sens');
var delayEl=document.getElementById('delay');
var onmoveEl=document.getElementById('onmove');
var loopEl=document.getElementById('loop');
var beepEl=document.getElementById('beep');
var flipBtn=document.getElementById('flip');
var clearBtn=document.getElementById('clear');
var deployEl=document.getElementById('deploy');
var pullBtn=document.getElementById('pull');
var forgetBtn=document.getElementById('forget');
var pullOut=document.getElementById('pullOut');

var canvas=document.createElement('canvas');
canvas.width=W;canvas.height=H;
var ctx=canvas.getContext('2d',{willReadFrequently:true});

var cur=new Uint8Array(N);
var prev=new Uint8Array(N);
var hasPrev=false;
var bg=null, acc=null, accCount=0, accumulating=false;
var strip=new Int32Array(STRIPS);

var PIXEL_DIFF=24;     // background difference that counts as "not the empty scene"
var MOTION_DIFF=16;    // frame to frame difference that counts as movement
var DEB_OUT=3;         // frames to confirm you left
var DEB_IN=2;          // frames to confirm you are back
var MIN_RUN=600;       // ignore a stop before this
var MAX_RUN=240000;    // give up and re-arm if nothing crosses back
var SETTLE=700;        // how long you must be in frame before stand mode arms
var PROVISIONAL=4000;  // movement must turn into leaving within this, or it is a false start
var GATE_SETTLE=1600;  // empty and quiet for this long arms the gate
var AUTO_SETTLE=3000;  // longer in auto, so you have time to step in for stand mode
var NOISE_GRACE=700;   // wait this long after you clear before sampling empty scene noise
var NOISE_WIN=1100;    // how long to sample it for
var RETURN_MIN=0.035, RETURN_MAX=0.095;
var AWAY_GUARD=500;    // no stop allowed for this long after you clear the frame

var state='idle';
var stream=null, raf=null, rvfc=false, pumping=false, facing='user';
var isPresent=null, pend=null, changedAt=0;
var startT=0, countEnd=0, doneAt=0, waitSince=0, emptySince=0;
var leftOnce=false, provisional=false, gateMode=false, stickyGate=false;
var motionHist=[], motionThr=0.015, mpend=null;
var returnThr=0.06, baseNoise=0, awayNoiseMax=0;
var noiseStart=0, noiseEnd=0, noiseLocked=false, awayGuard=0;
var lastFrame=0, frameDt=16.7;
var audioCtx=null;
var laps=[];

var SKEY='timetrial:settings:v1', LKEY='timetrial:laps:v1', PKEY='timetrial:pullkey:v1';

function load(){
  try{
    var s=JSON.parse(localStorage.getItem(SKEY)||'{}');
    if(s.sens) sensEl.value=s.sens;
    if(s.delay) delayEl.value=s.delay;
    if(s.mode) modeEl.value=s.mode;
    if(typeof s.loop==='boolean') loopEl.checked=s.loop;
    if(typeof s.beep==='boolean') beepEl.checked=s.beep;
    if(typeof s.onmove==='boolean') onmoveEl.checked=s.onmove;
    if(s.facing) facing=s.facing;
  }catch(e){}
  try{
    var l=JSON.parse(localStorage.getItem(LKEY)||'[]');
    if(Array.isArray(l)) laps=l.slice(0,50);
  }catch(e){}
  flipBtn.textContent = facing==='user' ? 'Front' : 'Rear';
  renderLaps();
}
function save(){
  try{
    localStorage.setItem(SKEY,JSON.stringify({
      sens:sensEl.value,delay:delayEl.value,mode:modeEl.value,loop:loopEl.checked,
      beep:beepEl.checked,onmove:onmoveEl.checked,facing:facing
    }));
  }catch(e){}
}
function saveLaps(){ try{ localStorage.setItem(LKEY,JSON.stringify(laps.slice(0,50))); }catch(e){} }

function threshold(){
  var s=parseInt(sensEl.value,10);
  return 0.22 - (s-1)*(0.19/9);
}
function effMode(){
  var m=modeEl.value;
  if(m==='auto' && stickyGate) return 'gate';
  return m;
}
function waitCue(){
  var m=effMode();
  if(m==='gate') return 'Stay clear of the frame';
  if(m==='stand') return 'Stand still on your start spot';
  return 'Step in to arm, or stay clear to arm the gate';
}

function fmt(ms){
  if(ms<0) ms=0;
  var t=Math.floor(ms/10);
  var cs=t%100, secs=Math.floor(t/100), m=Math.floor(secs/60);
  secs=secs%60;
  var head = m>0 ? m+':'+(secs<10?'0':'')+secs : String(secs);
  return head+'.<span class="ms">'+(cs<10?'0':'')+cs+'</span>';
}
function show(ms){ readout.innerHTML=fmt(ms); }
function setState(s){ state=s; stage.dataset.state=s; readout.dataset.state=s; }
function cueText(big,small){
  if(big===null){ cue.classList.add('hide'); return; }
  cue.classList.remove('hide');
  cue.innerHTML='<div>'+big+'</div>'+(small?'<small>'+small+'</small>':'');
}

function tone(freq,dur,vol){
  if(!beepEl.checked) return;
  try{
    if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended') audioCtx.resume();
    var o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type='square'; o.frequency.value=freq;
    g.gain.setValueAtTime(vol||0.25,audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime+dur+0.02);
  }catch(e){}
}
function beepGo(){ tone(1180,0.18,0.3); }
function beepStop(){ tone(760,0.12,0.3); setTimeout(function(){tone(520,0.24,0.3);},150); }
function beepTick(){ tone(880,0.07,0.16); }
function beepArm(){ tone(660,0.09,0.2); setTimeout(function(){tone(990,0.14,0.2);},110); }
function beepAbort(){ tone(300,0.22,0.22); }

var wakeLock=null;
function keepAwake(){
  if(!('wakeLock' in navigator)) return;
  navigator.wakeLock.request('screen').then(function(l){
    wakeLock=l; l.addEventListener('release',function(){wakeLock=null;});
  }).catch(function(){});
}
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible' && stream && !wakeLock) keepAwake();
});

function startCamera(){
  var want={video:{facingMode:facing,width:{ideal:640},height:{ideal:480},frameRate:{ideal:60}},audio:false};
  return navigator.mediaDevices.getUserMedia(want).then(function(s){
    if(stream) stream.getTracks().forEach(function(t){t.stop();});
    stream=s; video.srcObject=s;
    video.classList.toggle('mirror',facing==='user');
    hasPrev=false; lastFrame=0;
    rvfc = typeof video.requestVideoFrameCallback === 'function';
    return video.play().catch(function(){});
  });
}

function sample(){
  ctx.drawImage(video,0,0,W,H);
  var d=ctx.getImageData(0,0,W,H).data;
  var hp=hasPrev, count=0, mcount=0, p=0, x=0;
  strip.fill(0);
  for(var i=0;i<d.length;i+=4,p++){
    var g=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
    if(hp && Math.abs(g-prev[p])>MOTION_DIFF) mcount++;
    cur[p]=g;
    if(bg && Math.abs(g-bg[p])>PIXEL_DIFF){ count++; strip[(x/STRIP_W)|0]++; }
    if(++x===W) x=0;
  }
  prev.set(cur); hasPrev=true;
  var smax=0;
  for(var q=0;q<STRIPS;q++) if(strip[q]>smax) smax=strip[q];
  if(accumulating){
    for(var k=0;k<N;k++) acc[k]+=cur[k];
    accCount++;
  }
  return {s: bg?count/N:0, e: bg?smax/STRIP_PIX:0, m: hp?mcount/N:0};
}

// rate is per second, so adaptation speed no longer depends on frame rate
function adaptBg(perSec,dt){
  if(!bg||!perSec) return;
  var rate=perSec*(dt/1000);
  if(rate>0.5) rate=0.5;
  for(var k=0;k<N;k++) bg[k]+=(cur[k]-bg[k])*rate;
}
function beginCapture(){ acc=new Float32Array(N); accCount=0; accumulating=true; }
function finishCapture(){
  accumulating=false;
  if(!accCount){ bg=Float32Array.from(cur); }
  else{
    bg=new Float32Array(N);
    for(var k=0;k<N;k++) bg[k]=acc[k]/accCount;
  }
  isPresent=false; pend=null; changedAt=performance.now();
}

function quietMax(n){
  var max=0, start=Math.max(0,motionHist.length-n);
  for(var i=start;i<motionHist.length;i++) if(motionHist[i]>max) max=motionHist[i];
  return max;
}

// score is normalized so 1 is the trigger point, whatever metric fed it
function classify(score,now,fast){
  if(!bg) return;
  var raw = isPresent ? (score>0.55) : (score>1);
  if(isPresent===null){ isPresent=raw; changedAt=now; pend=null; return; }
  if(raw===isPresent){ pend=null; return; }
  if(raw && fast){                                  // unmistakable body, do not wait
    isPresent=true; changedAt=(pend&&pend.v)?pend.since:now; pend=null; return;
  }
  var need = raw ? (frameDt>26?1:DEB_IN) : DEB_OUT; // slow phone, one frame is all you get
  if(!pend || pend.v!==raw) pend={v:raw,since:now,n:1};
  else pend.n++;
  if(pend.n>=need){ isPresent=raw; changedAt=pend.since; pend=null; }
}

function beginAway(at){
  leftOnce=true; provisional=false;
  awayNoiseMax=0;
  noiseStart=at+NOISE_GRACE;          // do not sample while you are still clearing the edge
  noiseEnd=noiseStart+NOISE_WIN;
  noiseLocked=false;
  awayGuard=at+AWAY_GUARD;
}

function frame(){
  var now=performance.now();
  frameDt = lastFrame ? Math.min(200, now-lastFrame) : 16.7;
  lastFrame=now;
  if(video.readyState>=2 && video.videoWidth){
    var r=sample();
    motionHist.push(r.m);
    if(motionHist.length>90) motionHist.shift();

    var crossing = (state==='running' && leftOnce) || (state==='ready' && gateMode);
    var score, fast=false;
    if(crossing){
      var tFull=Math.max(0.02,threshold()*0.85);
      score=Math.max(r.e/returnThr, r.s/tFull);   // edge strip or whole frame, whichever fires first
      fast = score>2 && r.m>motionThr*2;
    }else{
      score=r.s/Math.max(0.02,threshold());
    }
    classify(score,now,fast);

    bar.style.width=Math.min(100,score*50).toFixed(1)+'%';
    mark.style.left='calc(50% - 1px)';
    stage.dataset.present = isPresent ? '1':'0';
    tick(now,r);
  }
  if(state==='running') show(now-startT);
}

function pump(){
  if(rvfc && typeof video.requestVideoFrameCallback==='function'){
    video.requestVideoFrameCallback(function(){ frame(); pump(); });
  }else{
    raf=requestAnimationFrame(function(){ frame(); pump(); });
  }
}
function paint(){                     // keeps the readout smooth if the camera cadence dips
  requestAnimationFrame(paint);
  if(state==='running') show(performance.now()-startT);
}

var lastTick=-1;
function tick(now,r){
  if(state==='countdown'){
    var left=Math.max(0,countEnd-now);
    var s=Math.ceil(left/1000);
    if(s!==lastTick){ lastTick=s; if(s>0) beepTick(); }
    cue.classList.remove('hide');
    cue.innerHTML='<div class="count">'+s+'</div><small>Step out of the frame</small>';
    if(left<=900 && !accumulating) beginCapture();
    if(left<=0){
      finishCapture();
      setState('waitin'); waitSince=now; emptySince=0; baseNoise=0;
      cueText('Scene memorized', waitCue());
      statusEl.textContent = effMode()==='gate'
        ? 'Arming as a gate. Stay clear and it will be ready in a moment.'
        : 'Walk in and hold still, or stay clear to arm it as a gate.';
    }
    return;
  }

  if(state==='waitin'){
    var m=effMode();
    if(isPresent){
      emptySince=0;
      if(m==='gate') return;                       // gate only, wait for the frame to clear
      var still=quietMax(20);
      var settled = now-changedAt>SETTLE;
      var timedOut = now-waitSince>7000;
      if(settled && (still<0.02 || timedOut)) armStand(now, timedOut?0.02:still);
      return;
    }
    adaptBg(1.0,frameDt);
    if(r.e>baseNoise) baseNoise=r.e;
    if(!emptySince) emptySince=now;
    if(m==='stand') return;
    if(now-emptySince > (m==='gate'?GATE_SETTLE:AUTO_SETTLE)) armGate(now);
    return;
  }

  if(state==='ready'){
    if(gateMode){
      adaptBg(isPresent?0:0.25,frameDt);
      if(isPresent){
        startT=changedAt; provisional=false; leftOnce=false;
        awayGuard=0; noiseLocked=true;             // thresholds already set at arm time
        go();
      }
      return;
    }
    if(!isPresent){                                // cleared the frame without a movement trigger
      startT=changedAt; beginAway(changedAt); go();
      return;
    }
    if(onmoveEl.checked){
      if(r.m>motionThr){
        if(!mpend) mpend={since:now,n:1}; else mpend.n++;
        if(mpend.n>=2){ startT=mpend.since; provisional=true; leftOnce=false; mpend=null; go(); }
      } else mpend=null;
    }
    return;
  }

  if(state==='running'){
    if(!leftOnce){
      if(!isPresent){ beginAway(changedAt); }
      else if(now-startT>PROVISIONAL){             // moved but never cleared the frame
        abort('You never cleared the frame. Re-arming.','False start');
        return;
      }
    }
    if(leftOnce && !isPresent){
      adaptBg(0.35,frameDt);
      if(!noiseLocked){
        if(now>=noiseStart && now<noiseEnd){ if(r.e>awayNoiseMax) awayNoiseMax=r.e; }
        else if(now>=noiseEnd){
          var lift=Math.min(RETURN_MAX, awayNoiseMax*2.0);
          if(lift>returnThr) returnThr=lift;
          noiseLocked=true;
        }
      }
    }
    if(leftOnce && isPresent && now>awayGuard && now-startT>MIN_RUN){ finish(changedAt); return; }
    if(now-startT>MAX_RUN){ abort('Nothing crossed back. Re-arming.','Timed out'); return; }
    return;
  }

  if(state==='done'){
    if(loopEl.checked && now-doneAt>2200){
      stickyGate=gateMode;
      setState('waitin'); waitSince=now; changedAt=now; emptySince=0; baseNoise=0;
      isPresent=null; pend=null; motionHist=[];
      cueText('Next rep', waitCue());
      statusEl.textContent='Re-arming.';
      haltBtn.hidden=true; redoBtn.hidden=false; mainBtn.hidden=true;
    }
    return;
  }
}

function armGate(now){
  gateMode=true; stickyGate=true;
  motionThr=Math.max(0.010, quietMax(40)*3.5);
  returnThr=Math.min(RETURN_MAX, Math.max(RETURN_MIN, baseNoise*2.5));
  isPresent=false; pend=null; mpend=null; changedAt=now;
  leftOnce=false; provisional=false;
  setState('ready'); beepArm(); show(0);
  cueText('Armed, run past','Clock starts the instant you cross the frame');
  statusEl.textContent='Gate armed. First pass starts it, next pass stops it.';
  mainBtn.hidden=true; haltBtn.hidden=true; redoBtn.hidden=false;
  redoBtn.textContent='Recalibrate';
}

function armStand(now,still){
  gateMode=false; stickyGate=false;
  motionThr=Math.max(0.010, still*3.5);
  returnThr=Math.min(RETURN_MAX, Math.max(RETURN_MIN, baseNoise*2.5));
  setState('ready');
  mpend=null; leftOnce=false; provisional=false;
  beepArm(); show(0);
  cueText('Go when you are ready', onmoveEl.checked
    ? 'Clock starts the moment you move'
    : 'Clock starts as you clear the frame');
  statusEl.textContent='Armed. Run.';
  mainBtn.hidden=true; haltBtn.hidden=true; redoBtn.hidden=false;
  redoBtn.textContent='Recalibrate';
}

function go(){
  setState('running'); beepGo(); cueText(null);
  statusEl.textContent = gateMode
    ? 'Running. Cross the frame again to stop.'
    : (provisional ? 'Running. Clear the frame to confirm.' : 'Running. Come back into frame to stop.');
  mainBtn.hidden=true; redoBtn.hidden=true; haltBtn.hidden=false;
}

function abort(msg,head){
  setState('waitin'); waitSince=performance.now();
  emptySince=0; baseNoise=0; provisional=false; leftOnce=false;
  isPresent=null; pend=null; mpend=null;
  beepAbort(); show(0);
  cueText(head, waitCue());
  statusEl.textContent=msg;
  haltBtn.hidden=true; redoBtn.hidden=false; mainBtn.hidden=true;
}

function finish(stopTime){
  var ms=stopTime-startT;
  setState('done'); show(ms); beepStop();
  doneAt=performance.now();
  laps.unshift({ms:Math.round(ms),at:Date.now()});
  laps=laps.slice(0,50);
  saveLaps(); renderLaps();
  var best=Math.min.apply(null,laps.map(function(l){return l.ms;}));
  statusEl.textContent=(Math.round(ms)===best && laps.length>1)?'Best rep so far.':'Rep logged.';
  cueText('Stopped', loopEl.checked
    ? (gateMode?'Re-arming once the frame is clear':'Re-arming in a moment')
    : 'Tap reset for another');
  haltBtn.hidden=true; redoBtn.hidden=false; mainBtn.hidden=true;
  redoBtn.textContent=loopEl.checked?'Recalibrate':'Go again';
}

function renderLaps(){
  lapsEl.innerHTML='';
  if(!laps.length){ lapsEmpty.hidden=false; return; }
  lapsEmpty.hidden=true;
  var best=Math.min.apply(null,laps.map(function(l){return l.ms;}));
  laps.forEach(function(l,i){
    var li=document.createElement('li');
    if(l.ms===best) li.className='best';
    var n=document.createElement('span'); n.className='n'; n.textContent='Rep '+(laps.length-i);
    var t=document.createElement('span'); t.className='t'; t.innerHTML=fmt(l.ms);
    li.appendChild(n); li.appendChild(t); lapsEl.appendChild(li);
  });
}

function calibrate(){
  bg=null; isPresent=null; pend=null; mpend=null; lastTick=-1;
  accumulating=false; leftOnce=false; provisional=false;
  gateMode=false; stickyGate=false;
  motionHist=[]; baseNoise=0; emptySince=0; returnThr=0.06;
  noiseLocked=false; awayGuard=0;
  setState('countdown');
  countEnd=performance.now()+parseInt(delayEl.value,10)*1000;
  show(0);
  statusEl.textContent='Clear the frame so it can learn the empty scene.';
  mainBtn.hidden=true; haltBtn.hidden=true; redoBtn.hidden=false;
  redoBtn.textContent='Cancel';
}

mainBtn.addEventListener('click',function(){
  tone(880,0.05,0.12);
  mainBtn.disabled=true; mainBtn.textContent='Starting camera';
  startCamera().then(function(){
    mainBtn.disabled=false; keepAwake();
    if(!pumping){ pumping=true; pump(); paint(); }
    calibrate();
  }).catch(function(err){
    mainBtn.disabled=false; mainBtn.textContent='Start camera';
    cueText('Camera blocked','Allow camera access, or open this page directly in your browser');
    statusEl.innerHTML='<span class="err">No camera: '+(err&&err.name?err.name:'unavailable')+'</span>';
  });
});
redoBtn.addEventListener('click',function(){ calibrate(); });
haltBtn.addEventListener('click',function(){ if(state==='running') finish(performance.now()); });
flipBtn.addEventListener('click',function(){
  facing = facing==='user' ? 'environment' : 'user';
  flipBtn.textContent = facing==='user' ? 'Front' : 'Rear';
  save();
  if(stream) startCamera().then(function(){ calibrate(); }).catch(function(){});
});
clearBtn.addEventListener('click',function(){ laps=[]; saveLaps(); renderLaps(); });
[modeEl,sensEl,delayEl,loopEl,beepEl,onmoveEl].forEach(function(el){ el.addEventListener('change',save); });
modeEl.addEventListener('change',function(){
  stickyGate=false;
  if(state==='ready'||state==='waitin'){ if(bg) calibrate(); }
});

/* deploy */
if(/duckandrabbit\.co$/i.test(location.hostname)) deployEl.hidden=false;
forgetBtn.addEventListener('click',function(){
  try{ localStorage.removeItem(PKEY); }catch(e){}
  pullOut.hidden=false; pullOut.textContent='Key cleared.';
});
pullBtn.addEventListener('click',function(){
  var k='';
  try{ k=localStorage.getItem(PKEY)||''; }catch(e){}
  if(!k){ k=(window.prompt('Pull key')||'').trim(); if(!k) return; }
  pullBtn.disabled=true; pullBtn.textContent='Updating';
  fetch('pull.php?key='+encodeURIComponent(k),{cache:'no-store'})
    .then(function(res){ return res.text().then(function(txt){ return {status:res.status,ok:res.ok,txt:txt}; }); })
    .then(function(res){
      pullOut.hidden=false; pullOut.textContent=res.txt.trim()||('HTTP '+res.status);
      if(res.status===401){
        try{ localStorage.removeItem(PKEY); }catch(e){}
        pullBtn.textContent='Wrong key, tap to retry'; pullBtn.disabled=false; return;
      }
      if(!res.ok){ pullBtn.textContent='Update failed'; pullBtn.disabled=false; return; }
      try{ localStorage.setItem(PKEY,k); }catch(e){}
      pullBtn.textContent='Updated, reloading';
      setTimeout(function(){ location.href=location.pathname+'?v='+Date.now(); },1000);
    })
    .catch(function(){
      pullOut.hidden=false; pullOut.textContent='No response from pull.php';
      pullBtn.textContent='Update from GitHub'; pullBtn.disabled=false;
    });
});

load(); show(0);
})();
