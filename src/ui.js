/** Minimal single-page dashboard: toggles, pin-a-deal, and the activity log. */
export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Corgi HubSpot Bot</title>
<style>
  :root { font-family: -apple-system, system-ui, sans-serif; }
  body { max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1d1d1f; }
  h1 { font-size: 1.4rem; }
  .card { border: 1px solid #e3e3e6; border-radius: 12px; padding: 1rem 1.25rem; margin: 1rem 0; }
  .row { display: flex; align-items: center; justify-content: space-between; padding: .4rem 0; }
  .switch { font-weight: 600; }
  input[type=text], input[type=password] { width: 100%; padding: .5rem; border: 1px solid #ccc; border-radius: 8px; box-sizing: border-box; }
  button { padding: .5rem .9rem; border: 0; border-radius: 8px; background: #0071e3; color: #fff; cursor: pointer; }
  button.secondary { background: #e3e3e6; color: #1d1d1f; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  td, th { text-align: left; padding: .35rem .4rem; border-bottom: 1px solid #f0f0f2; vertical-align: top; }
  .muted { color: #86868b; font-size: .85rem; }
  .pill { display:inline-block; padding:.1rem .5rem; border-radius:999px; font-size:.75rem; background:#f0f0f2; }
</style>
</head>
<body>
  <h1>🐕 Corgi HubSpot Bot</h1>
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
  return true;
}
function setBtn(id, on){ const b=document.getElementById(id); b.textContent = on?'ON':'OFF'; b.style.background = on?'#1db954':'#e3e3e6'; b.style.color = on?'#fff':'#1d1d1f'; }
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
