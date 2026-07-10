/** Single-page dashboard: toggles, pin-a-deal, sweep, enemy watch, activity log. */
export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Iron Dome · כִּפַּת בַּרְזֶל</title>
<style>
  :root {
    font-family: -apple-system, system-ui, sans-serif;
    --bg:#0a0f1d; --panel:#121a2e; --panel2:#1a2440; --border:#25304d;
    --blue:#0038b8; --blue-bright:#2f6be0; --gold:#d4af37; --gold-bright:#e6c258;
    --ink:#0e0a02; --white:#f3f6ff; --text:#e9eef7; --muted:#8a98b5;
  }
  body { max-width:780px; margin:0 auto; padding:1.5rem 1rem 3rem; color:var(--text);
    background:
      radial-gradient(900px 380px at 50% -160px, rgba(0,56,184,.28), transparent 70%),
      var(--bg);
    border-top:5px solid var(--blue); }
  header.brand { display:flex; align-items:center; gap:.85rem; padding:.6rem 0 1rem;
    border-bottom:2px solid var(--gold); margin-bottom:1.2rem; }
  header.brand .titles h1 { font-size:1.75rem; margin:0; letter-spacing:.10em; color:var(--white);
    text-transform:uppercase; font-weight:800; text-shadow:0 0 22px rgba(47,107,224,.5); }
  header.brand .heb { color:var(--gold); font-size:.85rem; letter-spacing:.04em; margin-top:.15rem; }
  header.brand .heb .sep { color:var(--muted); }
  .star { filter: drop-shadow(0 0 10px rgba(212,175,55,.45)); flex:0 0 auto; }
  h3 { color:var(--gold); font-size:1rem; letter-spacing:.02em; margin:.2rem 0 .8rem; }
  .card { background:var(--panel); border:1px solid var(--border); border-left:3px solid var(--blue);
    border-radius:12px; padding:1rem 1.25rem; margin:1rem 0; }
  .row { display:flex; align-items:center; justify-content:space-between; padding:.45rem 0; }
  .switch { font-weight:600; }
  input[type=text], input[type=password] { width:100%; padding:.55rem; border:1px solid var(--border);
    border-radius:8px; box-sizing:border-box; background:var(--panel2); color:var(--text); }
  input::placeholder { color:#5d6675; }
  button { padding:.5rem .95rem; border:0; border-radius:8px; background:var(--gold); color:var(--ink);
    cursor:pointer; font-weight:700; letter-spacing:.02em; }
  button:hover { background:var(--gold-bright); }
  button.secondary { background:var(--panel2); color:var(--white); border:1px solid var(--blue); font-weight:600; }
  button.secondary:hover { border-color:var(--blue-bright); }
  table { width:100%; border-collapse:collapse; font-size:.85rem; }
  td, th { text-align:left; padding:.4rem .45rem; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--gold); font-weight:600; }
  .muted { color:var(--muted); font-size:.85rem; }
  .pill { display:inline-block; padding:.12rem .55rem; border-radius:999px; font-size:.75rem;
    background:var(--panel2); border:1px solid var(--blue); }
  a { color:var(--gold); }
</style>
</head>
<body>
  <header class="brand">
    <svg class="star" width="40" height="40" viewBox="0 0 100 100" fill="none"
         stroke="var(--gold)" stroke-width="6" stroke-linejoin="round">
      <polygon points="50,7 89,74 11,74" />
      <polygon points="50,93 11,26 89,26" />
    </svg>
    <div class="titles">
      <h1>Iron Dome</h1>
      <div class="heb">כִּפַּת בַּרְזֶל <span class="sep">·</span> deal defense</div>
    </div>
  </header>

  <div id="gate" class="card">
    <p>Enter dashboard password:</p>
    <input type="password" id="pw" placeholder="password" />
    <p><button onclick="unlock()">Unlock</button></p>
  </div>

  <div id="app" style="display:none">
    <div class="card">
      <h3>Functions</h3>
      <div class="row"><span class="switch">1 · Lock BDR / AM / Owner</span><button id="t1" onclick="toggle('function1_enabled')"></button></div>
      <div class="row"><span class="switch">2 · Force Inbound (Corgi Tech)</span><button id="t2" onclick="toggle('function2_enabled')"></button></div>
      <div class="row"><span class="switch">3 · Daily reassign to Emily</span><button id="t3" onclick="toggle('function3_enabled')"></button></div>
      <div class="row"><span>Function 3 deals per day</span>
        <span><input type="text" id="cnt" style="width:60px" /> <button class="secondary" onclick="saveCount()">Save</button></span>
      </div>
    </div>

    <div class="card">
      <h3>Pin a deal to Inbound</h3>
      <p class="muted">Paste a HubSpot deal URL. It will be set to Inbound and held there (Corgi Tech deals only; requires Function 2 ON).</p>
      <input type="text" id="url" placeholder="https://app-na2.hubspot.com/contacts/.../record/0-3/123..." />
      <p><button onclick="pin()">Pin to Inbound</button></p>
      <div id="pins"></div>
    </div>

    <div class="card">
      <h3>Exempt a deal from the Corp lock (Function 1)</h3>
      <p class="muted">Paste a HubSpot deal URL. That deal will be ignored by the auto-revert-to-Corp lock until removed from this list.</p>
      <input type="text" id="exurl" placeholder="https://app-na2.hubspot.com/contacts/.../record/0-3/123..." />
      <p><button onclick="exempt()">Exempt deal</button></p>
      <div id="exempts"></div>
    </div>

    <div class="card">
      <h3>Inbound sweep (Function 2)</h3>
      <p class="muted">Find Corgi Tech deals sourced from Tail / Deep River that aren't marked Inbound. Preview shows what would change; Apply sets them to Inbound now.</p>
      <p><button class="secondary" onclick="previewSweep()">Preview (dry run)</button> <button onclick="applySweep()">Apply</button></p>
      <div id="sweep"></div>
    </div>

    <div class="card">
      <h3>⚠️ Detected enemy integrations</h3>
      <p class="muted">Apps caught reassigning Corgi Corp deals. <button class="secondary" onclick="enemyScan()">Scan now</button></p>
      <table id="enemies"><tbody></tbody></table>
    </div>

    <div class="card">
      <h3>Recent activity</h3>
      <table id="log"><tbody></tbody></table>
    </div>
  </div>

<script>
let PW = '';
const api = (path, opts={}) => fetch(path, { ...opts, headers: { 'x-ui-password': PW, 'content-type':'application/json', ...(opts.headers||{}) } });
function unlock(){ PW = document.getElementById('pw').value; refresh().then(ok => { if(ok){ document.getElementById('gate').style.display='none'; document.getElementById('app').style.display='block'; }}); }
async function refresh(){
  const res = await api('/api/status'); if(!res.ok) { alert('Wrong password'); return false; }
  const s = await res.json();
  setBtn('t1', s.config.function1_enabled); setBtn('t2', s.config.function2_enabled); setBtn('t3', s.config.function3_enabled);
  document.getElementById('cnt').value = s.config.function3_daily_count;
  document.getElementById('pins').innerHTML = s.pinned.map(p => '<span class="pill">'+p.deal_id+' <a href="#" onclick="unpin(\\''+p.deal_id+'\\')">✕</a></span>').join(' ') || '<span class="muted">none</span>';
  document.getElementById('exempts').innerHTML = (s.exempt||[]).map(p => '<span class="pill">'+p.deal_id+' <a href="#" onclick="unexempt(\\''+p.deal_id+'\\')">✕</a></span>').join(' ') || '<span class="muted">none</span>';
  document.getElementById('log').querySelector('tbody').innerHTML = s.audit.map(a =>
    '<tr><td>'+new Date(a.created_at).toLocaleString()+'</td><td><b>'+a.fn+'</b></td><td>'+(a.deal_id||'')+'</td><td>'+(a.note||'')+'</td></tr>').join('');
  const en = s.enemies || [];
  document.getElementById('enemies').querySelector('tbody').innerHTML = en.length
    ? en.map(e => '<tr><td><b>app '+e.app_id+'</b></td><td>'+e.hits+' hits</td><td>last: '+new Date(e.last_seen).toLocaleString()+'</td><td>'+(e.sample_deal||'')+'</td></tr>').join('')
    : '<tr><td class="muted">none detected</td></tr>';
  return true;
}
async function enemyScan(){ await api('/api/enemy-scan',{method:'POST'}); refresh(); }
function setBtn(id, on){ const b=document.getElementById(id); b.textContent = on?'ON':'OFF'; b.style.background = on?'var(--gold)':'var(--panel2)'; b.style.color = on?'var(--ink)':'var(--muted)'; }
async function toggle(key){ const res=await api('/api/status'); const s=await res.json(); const next = !s.config[key]; await api('/api/toggle',{method:'POST',body:JSON.stringify({key,value:next})}); refresh(); }
async function saveCount(){ await api('/api/toggle',{method:'POST',body:JSON.stringify({key:'function3_daily_count',value:document.getElementById('cnt').value})}); refresh(); }
async function pin(){ const url=document.getElementById('url').value; const res=await api('/api/pin',{method:'POST',body:JSON.stringify({url})}); const j=await res.json(); if(!res.ok) alert(j.error||'failed'); document.getElementById('url').value=''; refresh(); }
async function unpin(id){ await api('/api/unpin',{method:'POST',body:JSON.stringify({dealId:id})}); refresh(); }
async function exempt(){ const url=document.getElementById('exurl').value; const res=await api('/api/exempt',{method:'POST',body:JSON.stringify({url})}); const j=await res.json(); if(!res.ok) alert(j.error||'failed'); document.getElementById('exurl').value=''; refresh(); }
async function unexempt(id){ await api('/api/unexempt',{method:'POST',body:JSON.stringify({dealId:id})}); refresh(); }
async function previewSweep(){ document.getElementById('sweep').textContent='Scanning…'; const r=await api('/api/sweep/preview'); renderSweep(await r.json(), false); }
async function applySweep(){ if(!confirm('Force all matching deals to Inbound now?')) return; document.getElementById('sweep').textContent='Applying…'; const r=await api('/api/sweep/apply',{method:'POST'}); renderSweep(await r.json(), true); refresh(); }
function renderSweep(j, applied){ const el=document.getElementById('sweep'); if(j.error){ el.textContent='Error: '+j.error; return; } const rows=(j.candidates||[]).slice(0,50).map(c=>'<tr><td>'+c.id+'</td><td>'+c.name+'</td><td>'+(c.currentSource||'(none)')+'</td></tr>').join(''); const head = applied ? ('Applied to '+j.applied+' of '+j.count+' deal(s)') : (j.count+' deal(s) would be set to Inbound'); el.innerHTML='<p><b>'+head+'</b></p>'+(rows?'<table><thead><tr><th>ID</th><th>Deal</th><th>Current source</th></tr></thead><tbody>'+rows+'</tbody></table>'+(j.count>50?'<p class="muted">(showing first 50)</p>':''):''); }
setInterval(()=>{ if(PW) refresh(); }, 15000);
</script>
</body>
</html>`;
