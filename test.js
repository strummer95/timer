// Headless harness: stub just enough DOM to run the timer engine on fake frames.
const fs = require('fs');

const W = 128, H = 96;
let t = 0;                       // virtual clock, ms
let person = null;               // {x0,x1} column span of the body, or null
const rafQ = [];

function el(extra) {
  return Object.assign({
    dataset: {}, style: {}, classList: { add(){}, remove(){}, toggle(){} },
    textContent: '', innerHTML: '', value: '', checked: false, hidden: false,
    disabled: false, handlers: {},
    addEventListener(k, f) { (this.handlers[k] = this.handlers[k] || []).push(f); },
    appendChild(){}, getContext(){ return fakeCtx; },
  }, extra || {});
}

const fakeCtx = {
  drawImage(){},
  getImageData() {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 100 + ((x * 7 + y * 13) % 5);                 // static texture
      v += Math.random() * 3;                                // sensor noise
      const ylo = person && person.y0 != null ? person.y0 : 10;
      const yhi = person && person.y1 != null ? person.y1 : H;
      if (person && x >= person.x0 && x < person.x1 && y > ylo && y < yhi) v = 210;
      const i = (y * W + x) * 4;
      d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
    }
    return { data: d };
  }
};

const els = {};
['video','stage','cue','readout','status','main','halt','redo','bar','mark','laps',
 'lapsEmpty','mode','sens','delay','onmove','loop','beep','flip','clear','deploy',
 'pull','forget','pullOut'].forEach(id => els[id] = el());

els.video.readyState = 4; els.video.videoWidth = 640;
els.video.play = () => Promise.resolve();
els.sens.value = '6'; els.delay.value = '5'; els.mode.value = 'auto';
els.onmove.checked = true; els.loop.checked = true; els.beep.checked = false;

global.document = {
  getElementById: id => els[id] || el(),
  createElement: () => el(),
  addEventListener(){}, visibilityState: 'visible'
};
global.window = { AudioContext: null, prompt: () => '' };
global.location = { hostname: 'localhost', pathname: '/timer/' };
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) } },
  writable: true, configurable: true
});
global.localStorage = {
  store: {}, getItem(k){ return this.store[k] || null; },
  setItem(k,v){ this.store[k] = v; }, removeItem(k){ delete this.store[k]; }
};
global.performance = { now: () => t };
global.requestAnimationFrame = f => { rafQ.push(f); return rafQ.length; };
global.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });

const html = fs.readFileSync('index.html', 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
eval(js);

const step = (ms = 16.7) => {
  t += ms;
  const q = rafQ.splice(0, rafQ.length);
  q.forEach(f => f(t));
};
const run = (frames, occupancy) => {
  for (let i = 0; i < frames; i++) { person = occupancy ? occupancy(i, frames) : null; step(); }
  person = null;
};
const log = (label) => console.log(
  `  ${String(label).padEnd(26)} state=${String(els.stage.dataset.state).padEnd(9)} ` +
  `reps=${els.laps.innerHTML === '' ? 0 : '?'} "${els.status.textContent}"`
);

// a body sweeping across the frame left to right over `frames` frames
const sweep = (i, frames) => {
  const w = 26, span = W + w;
  const x = Math.round(-w + (span * i) / frames);
  return { x0: Math.max(0, x), x1: Math.min(W, x + w) };
};

function reps() {
  // the engine keeps laps in localStorage
  try { return JSON.parse(global.localStorage.getItem('timetrial:laps:v1') || '[]'); }
  catch (e) { return []; }
}


const flush = () => new Promise(r => setImmediate(r));

(async () => {
console.log('\n=== TEST 1: run past (gate), nobody ever stops in frame ===');
els.main.handlers.click[0]();
await flush(); await flush(); await flush();
step();
run(330);                                      // 5s countdown, empty frame
log('after countdown');
run(200);                                      // empty, should arm the gate
log('after empty settle');

run(24, sweep);                                // START: sprint through, ~400ms
log('after first pass');

run(480);                                      // 8s away
run(24, sweep);                                // STOP: second pass
log('after second pass');

const l = reps();
console.log('  reps recorded:', l.length, l.map(x => (x.ms/1000).toFixed(2) + 's').join(', '));
console.log('  PASS 1:', (l.length === 1 && l[0].ms > 7000 && l[0].ms < 10000) ? 'yes' : 'NO');

console.log('\n=== TEST 2: auto re-arm without standing in frame ===');
run(250);
log('after re-arm window');
const armed = els.stage.dataset.state === 'ready';
console.log('  re-armed hands free:', armed ? 'yes' : 'NO');
run(24, sweep);
run(300);
run(24, sweep);
const l2 = reps();
console.log('  reps now:', l2.length, l2.map(x => (x.ms/1000).toFixed(2) + 's').join(', '));
console.log('  PASS 2:', (armed && l2.length === 2) ? 'yes' : 'NO');

console.log('\n=== TEST 3: stand and go still works ===');
global.localStorage.store = {};
els.mode.value = 'stand';
els.main.handlers.click[0]();
await flush(); await flush(); await flush();
run(330);
run(150, () => ({ x0: 50, x1: 78 }));          // stand still ~2.5s
log('standing still');
const armed3 = els.stage.dataset.state === 'ready';
run(40);                                       // leave
log('after leaving');
const running = els.stage.dataset.state === 'running';
run(400);
run(40, () => ({ x0: 50, x1: 78 }));           // return and stay
log('after return');
const l3 = reps();
console.log('  reps:', l3.length, l3.map(x => (x.ms/1000).toFixed(2) + 's').join(', '));
console.log('  PASS 3:', (armed3 && running && l3.length === 3) ? 'yes' : 'NO');

console.log('\n=== TEST 4: fast pass, 4 frames only (very close to camera) ===');
global.localStorage.store = {};
els.mode.value = 'gate';
els.main.handlers.click[0]();
await flush(); await flush(); await flush();
run(330); run(150);
const armed4 = els.stage.dataset.state === 'ready';
run(4, sweep);
const started = els.stage.dataset.state === 'running';
run(300);
run(4, sweep);
const l4 = reps();
console.log('  armed:', armed4, ' started on a 4-frame pass:', started,
            ' newest rep:', (l4[0].ms/1000).toFixed(2)+'s');
console.log('  PASS 4:', (armed4 && started && l4.length === 4 && l4[0].ms > 4500 && l4[0].ms < 6500) ? 'yes' : 'NO');

console.log('\n=== TEST 5: small moving object must NOT trip the gate ===');
els.loop.checked = false;
els.mode.value = 'gate';
els.main.handlers.click[0]();
await flush(); await flush(); await flush();
run(330); run(150);
const armed5 = els.stage.dataset.state === 'ready';
const before5 = reps().length;
// a leaf: small blob, 5px across
run(60, (i, n) => { const x = Math.round((W * i) / n); return { x0: x, x1: x + 5, y0: 40, y1: 45 }; });
const tripped = els.stage.dataset.state !== 'ready';
console.log('  armed:', armed5, ' tripped by a 3px object:', tripped, ' new reps:', reps().length - before5);
console.log('  PASS 5:', (armed5 && !tripped) ? 'yes' : 'NO');

console.log('\n=== TEST 6: slow light drift must NOT trip the gate ===');
els.main.handlers.click[0]();
await flush(); await flush(); await flush();
run(330); run(150);
const armed6 = els.stage.dataset.state === 'ready';
// ramp the whole scene brighter over 12s, like sun coming out
const realGet = fakeCtx.getImageData;
let lift = 0;
fakeCtx.getImageData = function(){ const r = realGet.call(this);
  for (let i = 0; i < r.data.length; i += 4){ r.data[i]+=lift; r.data[i+1]+=lift; r.data[i+2]+=lift; } return r; };
for (let i = 0; i < 720; i++){ lift = (i / 720) * 45; person = null; step(); }
const tripped6 = els.stage.dataset.state !== 'ready';
fakeCtx.getImageData = realGet;
console.log('  armed:', armed6, ' tripped by +45 levels over 12s:', tripped6);
console.log('  PASS 6:', (armed6 && !tripped6) ? 'yes' : 'NO');

console.log('\n=== TEST 7: distant runner (thin, full height) SHOULD still trip ===');
els.main.handlers.click[0]();
await flush(); await flush(); await flush();
run(330); run(150);
const armed7 = els.stage.dataset.state === 'ready';
for (let i = 0; i < 40; i++) {
  const x = Math.round((W * i) / 40);
  person = { x0: x, x1: x + 6 };
  step();
  if (i % 8 === 0) console.log('    f' + i + ' state=' + els.stage.dataset.state +
    ' present=' + els.stage.dataset.present + ' bar=' + els.bar.style.width);
}
person = null;
console.log('    final state=', els.stage.dataset.state, 'status=', els.status.textContent);
const tripped7 = els.stage.dataset.state === 'running';
console.log('  armed:', armed7, ' distant runner started the clock:', tripped7);
console.log('  PASS 7:', (armed7 && tripped7) ? 'yes' : 'NO');

console.log('\n=== TEST 8: slow phone, 20fps, 3-frame pass ===');
els.loop.checked = false;
els.mode.value = 'gate';
els.main.handlers.click[0]();
await flush(); await flush(); await flush();
const slow = (n, occ) => { for (let i = 0; i < n; i++) { person = occ ? occ(i, n) : null; step(50); } person = null; };
slow(110); slow(50);
const armed8 = els.stage.dataset.state === 'ready';
const before8 = reps().length;
slow(3, sweep);
const started8 = els.stage.dataset.state === 'running';
slow(120);
slow(3, sweep);
const l8 = reps();
const got8 = l8.length - before8;
console.log('  armed:', armed8, ' started:', started8, ' new reps:', got8,
            got8 ? ' time: ' + (l8[0].ms/1000).toFixed(2) + 's (true 6.15s)' : '');
console.log('  PASS 8:', (armed8 && started8 && got8 === 1 && Math.abs(l8[0].ms - 6150) < 250) ? 'yes' : 'NO');
})();
