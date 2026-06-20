/** Single-page dashboard: toggles, pin-a-deal, sweep, enemy watch, activity log. */
export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Iron Dome</title>
<style>
  :root {
    font-family: -apple-system, system-ui, sans-serif;
    --bg:#0d0f13; --panel:#161a21; --panel2:#1c2129; --border:#2b3140;
    --gold:#d4af37; --gold-bright:#e6c258; --ink:#0e0a02;
    --text:#e9eaee; --muted:#8b93a3;
  }
  body { max-width: 780px; margin: 0 auto; padding: 1.5rem 1rem 3rem; color: var(--text); background: var(--bg); }
  header.brand { display:flex; align-items:center; gap:.6rem; padding:.4rem 0 1rem; border-bottom:2px solid var(--gold); margin-bottom:1.2rem; }
  header.brand h1 { font-size:1.7rem; margin:0; letter-spacing:.06em; color:var(--gold);
    text-transform:uppercase; font-weight:800; text-shadow:0 0 18px rgba(212,175,55,.25); }
  header.brand .badge { font-size:.7rem; color:var(--muted); border:1px solid var(--border); border-radius:999px; padding:.15rem .5rem; }
  h3 { color: var(--gold); font-size:1rem; letter-spacing:.02em; margin:.2rem 0 .8rem; }
  .card { background: var(--panel); border: 1px solid var(--border); border-left:3px solid var(--gold);
    border-radius: 12px; padding: 1rem 1.25rem; margin: 1rem 0; }
  .row { display: flex; align-items: center; justify-content: space-between; padding: .45rem 0; }
  .switch { font-weight: 600; }
  input[type=text], input[type=password] { width:100%; padding:.55rem; border:1px solid var(--border);
    border-radius:8px; box-sizing:border-box; background:var(--panel2); color:var(--text); }
  input::placeholder { color:#5d6675; }
  button { padding:.5rem .95rem; border:0; border-radius:8px; background:var(--gold); color:var(--ink);
    cursor:pointer; font-weight:700; letter-spacing:.02em; }
  button:hover { background:var(--gold-bright); }
  button.secondary { background:var(--panel2); color:var(--text); border:1px solid var(--border); font-weight:600; }
  table { width:100%; border-collapse:collapse; font-size:.85rem; }
  td, th { text-align:left; padding:.4rem .45rem; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--gold); font-weight:600; }
  .muted { color:var(--muted); font-size:.85rem; }
  .pill { display:inline-block; padding:.12rem .55rem; border-radius:999px; font-size:.75rem;
    background:var(--panel2); border:1px solid var(--border); }
  a { color:var(--gold); }
</style>
</head>
<body>
  <header class="brand">
    <span style="font-size:1.6rem">🛡️</span>
    <h1>Iron Dome</h1>
    <span class="badge">deal defense</span>
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
async function previewSweep(){ document.getElementById('sweep').textContent='Scanning…'; const r=await api('/api/sweep/preview'); renderSweep(await r.json(), false); }
async function applySweep(){ if(!confirm('Force all matching deals to Inbound now?')) return; document.getElementById('sweep').textContent='Applying…'; const r=await api('/api/sweep/apply',{method:'POST'}); renderSweep(await r.json(), true); refresh(); }
function renderSweep(j, applied){ const el=document.getElementById('sweep'); if(j.error){ el.textContent='Error: '+j.error; return; } const rows=(j.candidates||[]).slice(0,50).map(c=>'<tr><td>'+c.id+'</td><td>'+c.name+'</td><td>'+(c.currentSource||'(none)')+'</td></tr>').join(''); const head = applied ? ('Applied to '+j.applied+' of '+j.count+' deal(s)') : (j.count+' deal(s) would be set to Inbound'); el.innerHTML='<p><b>'+head+'</b></p>'+(rows?'<table><thead><tr><th>ID</th><th>Deal</th><th>Current source</th></tr></thead><tbody>'+rows+'</tbody></table>'+(j.count>50?'<p class="muted">(showing first 50)</p>':''):''); }
setInterval(()=>{ if(PW) refresh(); }, 15000);
</script>
</body>
</html>`;
