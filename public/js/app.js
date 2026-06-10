'use strict';
/* PocketTCG Frontend v3 — English, Wizard, Full Judge Panel */

const API = '';
let _token = localStorage.getItem('ptcg_token');
let _me    = JSON.parse(localStorage.getItem('ptcg_me') || 'null');
let _currentDetailId = null;
let _currentTournament = null;
let _myReg = null;
let _detailTab = 'details';
let _subTab = 'all';
let _myTab = 'organized';
let _phases = [];
let _tregDecks = [];
let _tregTournament = null;
let _resultMatch = null;
let _wizardStep = 1;

const MATCH_MODES = {
  'Bo1':          { icon:'1️⃣', label:'Best of 1',          desc:'Single game decides the match.' },
  'Bo3':          { icon:'3️⃣', label:'Best of 3',          desc:'First to win 2 games.' },
  'Bo5':          { icon:'5️⃣', label:'Best of 5',          desc:'First to win 3 games.' },
  '2-Game':       { icon:'2️⃣', label:'2-Game Format',      desc:'Exactly 2 games. Ties possible.' },
  'Conquest':     { icon:'⚔️', label:'Conquest',           desc:'Win once with each of your decks. First to conquer all wins.' },
  'LastHero':     { icon:'🦸', label:'Last Hero Standing', desc:'Loser swaps deck. Winner keeps theirs.' },
  'BringBanPick': { icon:'🚫', label:'Bring 2 Ban 1',      desc:'Bring 2 decks, ban 1 opponent deck, Bo3 with the rest.' },
  'Specialist':   { icon:'🎯', label:'Specialist',         desc:'Lock in 1 deck for all games. No swapping.' },
};
const PHASE_TYPES = {
  'swiss':       { icon:'🔄', label:'Swiss' },
  'single_elim': { icon:'🏆', label:'Single Elimination' },
  'double_elim': { icon:'💪', label:'Double Elimination' },
  'round_robin': { icon:'♻️', label:'Round Robin' },
};
const PENALTY_TYPES = [
  { value:'warning',    label:'Warning',    color:'warning' },
  { value:'game_loss',  label:'Game Loss',  color:'game_loss' },
  { value:'match_loss', label:'Match Loss', color:'match_loss' },
  { value:'dq',         label:'Disqualification', color:'dq' },
];

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const opts = { method, headers:{'Content-Type':'application/json'} };
  if (_token) opts.headers['Authorization'] = 'Bearer '+_token;
  if (body)   opts.body = JSON.stringify(body);
  try { const r = await fetch(API+url, opts); return await r.json(); }
  catch(e) { return { error:'Network error' }; }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  const u=_v('login-user'), p=_v('login-pass');
  if(!u||!p) return toast('Fill in all fields','error');
  const r = await api('POST','/api/login',{username:u,password:p});
  if(r.error) return toast(r.error,'error');
  saveAuth(r); closeModal('modal-login'); toast('Welcome, '+r.username+'!','success'); refreshAuthUI();
}
async function doRegister() {
  const u=_v('reg-user'), p=_v('reg-pass'), e=_v('reg-email');
  if(!u||!p) return toast('Username and password required','error');
  const r = await api('POST','/api/register',{username:u,password:p,email:e});
  if(r.error) return toast(r.error,'error');
  saveAuth(r); closeModal('modal-register'); toast('Account created!','success'); refreshAuthUI();
}
function saveAuth(r) {
  _token=r.token; _me={id:r.id,username:r.username};
  localStorage.setItem('ptcg_token',_token); localStorage.setItem('ptcg_me',JSON.stringify(_me));
}
function logout() {
  _token=null; _me=null;
  localStorage.removeItem('ptcg_token'); localStorage.removeItem('ptcg_me');
  refreshAuthUI(); showPage('home');
}
function refreshAuthUI() {
  const li=!!_token;
  _id('auth-out').style.display=li?'none':'flex';
  _id('auth-in').style.display=li?'flex':'none';
  _id('tab-create').style.display=li?'':'none';
  _id('tab-my').style.display=li?'':'none';
  if(li) _id('nav-username').textContent=_me.username;
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(name, extra) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  _id('page-'+name)?.classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.page===name));
  window.scrollTo(0,0);
  // Update URL
  if(name==='home')       window.history.pushState({page:'home'}, '', '/');
  if(name==='create')     window.history.pushState({page:'create'}, '', '/organize');
  if(name==='my')         window.history.pushState({page:'my'}, '', '/my-events');
  if(name==='tournament'&&extra) window.history.pushState({page:'tournament',id:extra}, '', `/tournament/${extra}`);
  if(name==='home')   loadTournamentList();
  if(name==='create') initWizard();
  if(name==='my')     loadMyPage();
  if(name==='tournament'&&extra) openTournament(extra);
}

// Handle browser back/forward
window.addEventListener('popstate', e => {
  const s = e.state;
  if(!s || s.page==='home') { document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); _id('page-home').classList.add('active'); loadTournamentList(); }
  else if(s.page==='tournament'&&s.id) { document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); _id('page-tournament').classList.add('active'); openTournament(s.id); }
  else if(s.page==='create') { document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); _id('page-create').classList.add('active'); initWizard(); }
  else if(s.page==='my') { document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); _id('page-my').classList.add('active'); loadMyPage(); }
});
function setSubTab(el,val){ document.querySelectorAll('#page-home .sub-tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); _subTab=val; loadTournamentList(); }
function setDetailTab(el,val){ document.querySelectorAll('#page-tournament .sub-tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); _detailTab=val; renderDetailContent(); }
function setMyTab(el,val){ document.querySelectorAll('#page-my .sub-tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); _myTab=val; loadMyPage(); }

// ── Home ──────────────────────────────────────────────────────────────────────
let _searchQuery = '';
async function loadTournamentList() {
  const el=_id('tournament-list');
  el.innerHTML=loader();
  const all=await api('GET','/api/tournaments');
  if(all.error){el.innerHTML=empty('Failed to load tournaments');return;}
  let list=all;
  if(_subTab!=='all') list=all.filter(t=>t.status===_subTab);
  if(_searchQuery) list=list.filter(t=>t.name.toLowerCase().includes(_searchQuery.toLowerCase())||t.organizer?.toLowerCase().includes(_searchQuery.toLowerCase()));
  list=list.sort((a,b)=>b.createdAt-a.createdAt);
  if(!list.length){
    el.innerHTML=empty(_subTab==='registration'?'No open tournaments yet.':_subTab==='ongoing'?'No live tournaments.':'No tournaments found.')
      +(_token?`<div style="text-align:center;margin-top:-20px"><button class="btn btn-primary" onclick="showPage('create')">Create one</button></div>`:'');
    return;
  }
  const groups={ongoing:[],registration:[],completed:[]};
  list.forEach(t=>(groups[t.status]||groups.completed).push(t));
  let html='';
  if(groups.ongoing.length)      html+=buildTournamentTable('Live',groups.ongoing,'ongoing');
  if(groups.registration.length) html+=buildTournamentTable('Registration Open',groups.registration,'registration');
  if(groups.completed.length)    html+=buildTournamentTable('Completed',groups.completed,'completed');
  el.innerHTML=html||empty('No tournaments in this category');
}

function buildTournamentTable(title,list,type) {
  const rows=list.map(t=>{
    const mm=t.phases?.[0]?.matchMode||'Bo3';
    const deckBadge=t.maxDecks>1?`<span class="badge badge-purple">${t.minDecks}–${t.maxDecks} decks</span>`:`<span class="badge badge-blue">1 deck</span>`;
    const phases=(t.phases||[]).map(p=>`<span class="badge badge-gray" style="font-size:10px">${PHASE_TYPES[p.type]?.label||p.type}</span>`).join(' ');
    const prize=t.prizePool?`<div class="text-xs text-gold mt-8">🏆 ${esc(t.prizePool)}</div>`:'';
    if(type==='registration') return `<tr>
      <td><span class="t-link" onclick="openTournament('${t.id}')">${esc(t.name)}</span>${prize}</td>
      <td>${phases} <span class="badge badge-teal" style="font-size:10px">${MATCH_MODES[mm]?.icon||''} ${mm}</span></td>
      <td>${deckBadge}</td>
      <td class="text-muted">${t.playerCount}${t.maxPlayers?'/'+t.maxPlayers:''}</td>
      <td class="text-dim">${esc(t.organizer)}</td>
      <td><button class="btn btn-primary btn-sm" onclick="openTournament('${t.id}')">Register</button></td>
    </tr>`;
    return `<tr>
      <td><span class="t-link" onclick="openTournament('${t.id}')">${esc(t.name)}</span>${prize}</td>
      <td>${phases}</td>
      <td>${deckBadge}</td>
      <td class="text-muted">${t.playerCount}</td>
      <td class="text-dim">${esc(t.organizer)}</td>
      <td>${type==='ongoing'?'<span class="badge badge-green">● Live</span>':''}</td>
    </tr>`;
  }).join('');
  const cols=type==='registration'
    ?'<th>Tournament</th><th>Format</th><th>Decks</th><th>Players</th><th>Organizer</th><th></th>'
    :'<th>Tournament</th><th>Format</th><th>Decks</th><th>Players</th><th>Organizer</th><th></th>';
  return `<div style="margin-bottom:28px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:8px">${title}</div>
    <table class="tbl"><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

// ── Tournament Detail ─────────────────────────────────────────────────────────
async function openTournament(id) {
  _currentDetailId=id; _detailTab='details'; _currentTournament=null; _myReg=null; _playersCache=null;
  showPage('tournament');
  _id('detail-title').textContent='Loading…';
  _id('tournament-content').innerHTML=loader();
  document.querySelectorAll('#page-tournament .sub-tab').forEach((t,i)=>t.classList.toggle('active',i===0));
  const [t,myReg]=await Promise.all([api('GET',`/api/tournaments/${id}`),_token?api('GET',`/api/tournaments/${id}/my-registration`):Promise.resolve(null)]);
  if(t.error){_id('tournament-content').innerHTML=empty('Tournament not found');return;}
  _currentTournament=t; _myReg=myReg;
  _id('detail-title').textContent=t.name;
  const isJudge=_me&&(t.organizerId===_me.id||(t.judges||[]).includes(_me.id));
  _id('judge-tab').style.display=isJudge?'':'none';
  _id('results-tab').style.display=t.status==='completed'?'':'none';
  // Auto-show Results tab for completed tournaments
  if(t.status==='completed' && _detailTab==='details') {
    _detailTab='results';
    document.querySelectorAll('#page-tournament .sub-tab').forEach(tab=>{
      tab.classList.toggle('active', tab.getAttribute('onclick')?.includes("'results'"));
    });
  }
  renderDetailContent();
}

async function renderDetailContent() {
  const t=_currentTournament;
  const el=_id('tournament-content');
  const isOrg=_me&&t.organizerId===_me.id;
  const isJudge=_me&&(isOrg||(t.judges||[]).includes(_me.id));
  if(_detailTab==='details')       renderDetailsTab(t,isOrg,isJudge,el);
  else if(_detailTab==='pairings') { el.innerHTML=loader(); const d=await api('GET',`/api/tournaments/${_currentDetailId}/pairings`); renderPairingsTab(d,t,isJudge,el); }
  else if(_detailTab==='standings'){ el.innerHTML=loader(); const d=await api('GET',`/api/tournaments/${_currentDetailId}/standings`); renderStandingsTab(d,t,isJudge,el); }
  else if(_detailTab==='players')  { el.innerHTML=loader(); const d=await api('GET',`/api/tournaments/${_currentDetailId}/registrations`); renderPlayersTab(d,t,isJudge,el); }
  else if(_detailTab==='results')  { el.innerHTML=loader(); const [s,r]=await Promise.all([api('GET',`/api/tournaments/${_currentDetailId}/standings`),api('GET',`/api/tournaments/${_currentDetailId}/registrations`)]); renderResultsTab(s,r,t,el); }
  else if(_detailTab==='judge')    renderJudgePanel(t,el);
}

function renderDetailsTab(t,isOrg,isJudge,el) {
  const phase0=t.phases?.[0]||{};
  const mm=MATCH_MODES[phase0.matchMode]||MATCH_MODES['Bo3'];
  const fill=t.maxPlayers?Math.round((t.registrations?.length||0)/t.maxPlayers*100):0;
  const joinUrl=`${location.origin}/?join=${t.id}`;

  let actions='';
  if(!_token){
    if(t.status==='registration') actions=`<button class="btn btn-primary btn-block" onclick="openModal('modal-login')">Log in to Register</button>`;
  } else if(_myReg&&!_myReg.waitlist&&!_myReg.dropped) {
    actions=`<div class="reg-status"><strong>✓ You are registered</strong><span>${(_myReg.decks||[]).length} deck(s) submitted</span></div>
      <button class="btn btn-outline btn-block btn-sm mb-8" onclick="openMyDecks()">View my decklists</button>
      ${t.status==='registration'?`<button class="btn btn-outline btn-block btn-sm mb-8" onclick="openEditDecks()">✏ Edit my decklists</button><button class="btn btn-danger btn-block btn-sm" onclick="doDrop()">Drop from tournament</button>`:''}`;
    if(t.checkinRequired&&!_myReg.checkedIn&&t.status==='registration')
      actions=`<button class="btn btn-teal btn-block mb-8" onclick="doCheckin()">✓ Check In</button>`+actions;
  } else if(_myReg?.waitlist) {
    actions=`<div class="reg-status" style="border-color:rgba(245,166,35,.3);background:rgba(245,166,35,.08)"><strong style="color:var(--gold)">On Waitlist</strong><span>You'll be added if a spot opens</span></div>`;
  } else if(t.status==='registration') {
    actions=`<button class="btn btn-primary btn-block" onclick="openRegistration()">Register</button>`;
  }

  if(isOrg) {
    actions+=`<hr class="divider">`;
    if(t.status==='registration') actions+=`<button class="btn btn-success btn-block mb-8" onclick="doStart()">▶ Start Tournament</button>`;
    if(t.status==='ongoing') {
      // Timer
      const curPairing=t.pairings?.find(p=>p.phaseIdx===t.currentPhase&&p.round===t.currentRound);
      const timerEnd=curPairing?.timerEnd;
      actions+=`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Round Timer</div>
        <div id="timer-display" style="font-family:var(--display);font-size:22px;font-weight:700;color:var(--teal);margin-bottom:8px">${timerEnd?formatTimer(timerEnd):'—'}</div>
        <div style="display:flex;gap:6px">
          <input class="form-input" type="number" id="timer-mins" placeholder="mins" min="1" max="120" value="${t.roundMinutes||50}" style="width:70px">
          <button class="btn btn-outline btn-sm" onclick="setTimer()">Set</button>
          <button class="btn btn-ghost btn-sm" onclick="clearTimer()">Clear</button>
        </div>
      </div>`;
      actions+=`<button class="btn btn-outline btn-block mb-8" onclick="doNextRound()">Next Round →</button>`;
    }
    if(t.status==='registration') {
      actions+=`<button class="btn btn-danger btn-block btn-sm mb-8" onclick="doDeleteTournament()">🗑 Delete Tournament</button>`;
    }
    // Join link
    actions+=`<div style="margin-top:8px">
      <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Invite Link</div>
      <div style="display:flex;gap:6px">
        <input class="form-input" style="font-size:11px" value="${joinUrl}" readonly id="join-url-input">
        <button class="btn btn-outline btn-sm" onclick="copyJoinLink()">Copy</button>
      </div>
    </div>`;
  }
  if(isJudge&&!isOrg&&t.status==='ongoing') {
    actions+=`<hr class="divider"><button class="btn btn-outline btn-block btn-sm" onclick="setDetailTab(document.querySelector('[onclick*=judge]'),'judge')">Open Judge Panel</button>`;
  }

  // Timer display for players (non-org)
  let timerBanner='';
  if(!isOrg && t.status==='ongoing') {
    const curPairing=t.pairings?.find(p=>p.phaseIdx===t.currentPhase&&p.round===t.currentRound);
    if(curPairing?.timerEnd) {
      timerBanner=`<div style="background:rgba(0,212,170,.1);border:1px solid rgba(0,212,170,.3);border-radius:var(--r);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:13px;color:var(--text2)">⏱ Round Timer</span>
        <span id="timer-display" style="font-family:var(--display);font-size:20px;font-weight:700;color:var(--teal)">${formatTimer(curPairing.timerEnd)}</span>
      </div>`;
    }
  }
  const phaseBadges=(t.phases||[]).map((p,i)=>{
    const pt=PHASE_TYPES[p.type]||{};
    const mm2=MATCH_MODES[p.matchMode]||{};
    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="width:26px;height:26px;border-radius:50%;background:var(--accent2);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">${pt.icon||'📋'}</div>
      <div style="flex:1"><div style="font-weight:600;font-size:13px">${p.name||pt.label}</div>
      <div style="font-size:11px;color:var(--text3)">${mm2.icon||''} ${p.matchMode} · ${p.type==='swiss'||p.type==='round_robin'?p.rounds+' rounds':'Bracket'}</div></div>
      ${i===t.currentPhase&&t.status==='ongoing'?'<span class="badge badge-green">Active</span>':''}
    </div>`;
  }).join('');
  el.innerHTML=`<div class="detail-grid">
    <div>
      ${timerBanner}
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          ${statusBadge(t.status)}<span class="text-dim text-sm">${t.isOnline!==false?'🌐 Online':'🏢 Offline'}</span>
        </div>
        ${t.description?`<p style="color:var(--text2);margin-bottom:16px;line-height:1.6">${esc(t.description).replace(/\n/g,'<br>')}</p>`:''}
        <div class="info-grid">
          <div class="info-item"><label>Match Format</label><span>${mm.icon} ${phase0.matchMode||'Bo3'}</span></div>
          <div class="info-item"><label>Phases</label><span>${(t.phases||[]).length}</span></div>
          <div class="info-item"><label>Decks/Player</label><span>${t.minDecks===t.maxDecks?t.minDecks:t.minDecks+'–'+t.maxDecks}</span></div>
          <div class="info-item"><label>Round</label><span>${t.currentRound?`R${t.currentRound} / Ph.${t.currentPhase+1}`:'—'}</span></div>
          <div class="info-item"><label>Organizer</label><span><a onclick="showProfile('${esc(t.organizerName)}')" style="cursor:pointer;color:var(--teal)">${esc(t.organizerName)}</a></span></div>
          <div class="info-item"><label>Players</label><span>${(t.registrations||[]).length}${t.maxPlayers?'/'+t.maxPlayers:''}</span></div>
        </div>
        ${t.maxPlayers?`<div class="progress mt-8"><div class="progress-fill" style="width:${fill}%"></div></div>`:''}
      </div>
      <div class="card"><div class="card-title">📋 Structure</div>${phaseBadges}</div>
      ${t.deckRules?`<div class="card"><div class="card-title">📜 Deck Rules</div><p style="color:var(--text2);line-height:1.6">${esc(t.deckRules).replace(/\n/g,'<br>')}</p></div>`:''}
      ${t.prizePool?`<div class="card"><div class="card-title">🏆 Prize Pool</div><div style="color:var(--gold);font-weight:600;font-size:15px">${esc(t.prizePool)}</div></div>`:''}
      ${t.discord?`<div class="card"><div class="card-title">🔗 Links</div><a href="${esc(t.discord)}" target="_blank" class="btn btn-outline btn-sm">💬 Discord</a></div>`:''}
    </div>
    <div><div class="card">${actions||'<div class="text-dim text-sm">This tournament has ended.</div>'}</div></div>
  </div>`;

  // Start timer interval
  const curP=t.pairings?.find(p=>p.phaseIdx===t.currentPhase&&p.round===t.currentRound);
  if(curP?.timerEnd) startTimerTick(curP.timerEnd);
}

function renderPairingsTab(data,t,isJudge,el) {
  if(!data.pairings?.length){el.innerHTML=empty('No pairings yet. Tournament has not started.');return;}
  const reg=t.registrations||[];
  const uname=id=>reg.find(r=>r.userId===id)?.username||'?';

  // Phase pills if multiple phases
  const phases=data.phases||[];
  let phasePills='';
  if(phases.length>1) {
    phasePills=`<div class="phase-tabs" style="margin-bottom:16px">${phases.map((p,i)=>`
      <div class="phase-pill ${i===_detailPhaseIdx?'active':''}" onclick="setDetailPhase(${i},this)">
        ${p.name||'Phase '+(i+1)}
      </div>`).join('')}</div>`;
  }

  // Filter pairings by current phase
  const phasePairings=data.pairings.filter(p=>p.phaseIdx===_detailPhaseIdx);
  const phase=phases[_detailPhaseIdx]||{};
  const isElim=phase.type==='single_elim'||phase.type==='double_elim';

  let html=phasePills;

  if(isElim && phasePairings.length) {
    // ── BRACKET VIEW ─────────────────────────────────────────
    html+=`<div class="bracket-wrap"><div class="bracket">`;
    const roundGroups={};
    for(const p of phasePairings) (roundGroups[p.round]=roundGroups[p.round]||[]).push(...p.matches);
    const rounds=Object.entries(roundGroups).sort((a,b)=>+a[0]-+b[0]);

    for(const [rnd,matches] of rounds) {
      const isCur=parseInt(rnd)===t.currentRound&&_detailPhaseIdx===t.currentPhase;
      const rndLabel=rounds.length===1?'Final':rounds.length===2&&rnd==='1'?'Semi-Finals':rounds.length===3&&rnd==='1'?'Quarter-Finals':`Round ${rnd}`;
      html+=`<div class="bracket-round">
        <div class="bracket-round-title">${rndLabel} ${isCur?'<span class="badge badge-green" style="font-size:9px">Live</span>':''}</div>`;
      for(const m of matches) {
        const p1w=m.winner===m.p1, p2w=m.winner===m.p2;
        html+=`<div class="bracket-match">
          <div class="bracket-player ${p1w?'winner':p2w?'loser':''}">
            <span>${m.p2===null?'BYE':esc(uname(m.p1))}</span>
            <span class="bracket-score">${p1w?m.scoreWinner??'':p2w?m.scoreLoser??'':''}</span>
          </div>
          <div class="bracket-player ${p2w?'winner':p1w?'loser':''}">
            <span>${m.p2?esc(uname(m.p2)):'—'}</span>
            <span class="bracket-score">${p2w?m.scoreWinner??'':p1w?m.scoreLoser??'':''}</span>
          </div>
          ${(!m.result&&m.p2&&(isJudge||(_me&&(m.p1===_me.id||m.p2===_me.id)))&&t.status==='ongoing')?
            `<div style="padding:6px 8px;border-top:1px solid var(--border)"><button class="btn btn-outline btn-sm" style="width:100%" onclick="openResult('${m.id}','${m.p1}','${m.p2}','${esc(uname(m.p1))}','${esc(uname(m.p2))}')">Report</button></div>`:''}
          ${(isJudge&&m.result)?`<div style="padding:4px 8px;border-top:1px solid var(--border)"><button class="btn btn-ghost btn-sm" style="width:100%" onclick="openResult('${m.id}','${m.p1}','${m.p2}','${esc(uname(m.p1))}','${esc(uname(m.p2))}',true)">Edit</button></div>`:''}
        </div>`;
      }
      html+=`</div>`;
    }
    html+=`</div></div>`;
  } else {
    // ── SWISS LIST VIEW ───────────────────────────────────────
    const roundGroups={};
    for(const p of phasePairings) (roundGroups[p.round]=roundGroups[p.round]||[]).push(...p.matches);
    for(const [rnd,matches] of Object.entries(roundGroups).sort((a,b)=>b[0]-a[0])) {
      const isCur=parseInt(rnd)===t.currentRound&&_detailPhaseIdx===t.currentPhase;
      html+=`<div style="margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:10px;display:flex;align-items:center;gap:8px">
          Round ${rnd} ${isCur?'<span class="badge badge-green">Current</span>':''}
        </div>`;
      for(const m of matches) html+=renderMatchRow(m,t,uname,isJudge);
      html+=`</div>`;
    }
  }

  // Dispute button
  const allMatches=data.pairings.flatMap(p=>p.matches);
  const myMatch=allMatches.find(m=>_me&&(m.p1===_me.id||m.p2===_me.id)&&!m.result&&t.status==='ongoing');
  if(myMatch&&_me&&!isJudge) html+=`<div style="text-align:center;margin-top:8px"><button class="btn btn-outline btn-sm" onclick="openDisputeModal('${myMatch.id}')">⚠ Submit Dispute for my match</button></div>`;
  el.innerHTML=html||empty('No matches');
}

function renderMatchRow(m,t,uname,isJudge) {
  if(!m.p2) return `<div class="match-row match-row-bo3"><span class="match-player">${esc(uname(m.p1))}</span><span class="match-bye">BYE</span><span></span><span></span></div>`;
  const w=m.winner, p1w=w===m.p1, p2w=w===m.p2;
  const canReport=_me&&!m.result&&t.status==='ongoing'&&(isJudge||_me.id===m.p1||_me.id===m.p2);
  const canEdit=isJudge&&m.result;
  let score='';
  if(m.result==='tie') score=`<span class="badge badge-gray">Tie</span>`;
  else if(m.result==='win') score=`<span class="match-score">${m.scoreWinner??''}-${m.scoreLoser??''}</span>`;
  else score=`<span class="match-pending">—</span>`;
  let acts='';
  if(canReport) acts+=`<button class="btn btn-outline btn-sm" onclick="openResult('${m.id}','${m.p1}','${m.p2}','${esc(uname(m.p1))}','${esc(uname(m.p2))}')">Report</button>`;
  if(canEdit)   acts+=`<button class="btn btn-ghost btn-sm" onclick="openResult('${m.id}','${m.p1}','${m.p2}','${esc(uname(m.p1))}','${esc(uname(m.p2))}',true)">Edit</button>`;
  if(isJudge&&!m.result&&t.status==='ongoing') acts+=`<button class="btn btn-ghost btn-sm" onclick="openPenaltyModal('${m.p1}','${esc(uname(m.p1))}','${m.p2}','${esc(uname(m.p2))}')" title="Issue Penalty">⚖</button>`;
  return `<div class="match-row match-row-bo3">
    <span class="match-player ${p1w?'winner':p2w?'loser':''}">${p1w?'✓ ':''}${esc(uname(m.p1))}</span>
    <span class="match-vs">vs</span>
    <span class="match-player ${p2w?'winner':p1w?'loser':''}">${p2w?'✓ ':''}${esc(uname(m.p2))}</span>
    <span class="match-actions">${score} ${acts}</span>
  </div>`;
}

function renderStandingsTab(data,t,isJudge,el) {
  if(!data?.length){el.innerHTML=empty('No standings yet');return;}
  const rows=data.map((p,i)=>`<tr class="rank-${i+1}">
    <td class="rank-num">${i+1}</td>
    <td style="font-weight:500;cursor:pointer;color:var(--teal)" onclick="showProfile('${esc(p.username)}')">${esc(p.username)}${p.dropped?` <span class="badge badge-red" style="font-size:10px">dropped</span>`:''}</td>
    <td class="record-w">${p.wins}</td><td class="record-l">${p.losses}</td><td class="record-t">${p.ties}</td>
    <td class="text-dim">${(p.owp*100).toFixed(1)}%</td>
    <td class="font-mono text-sm">${p.wins}-${p.losses}${p.ties?'-'+p.ties:''}</td>
  </tr>`).join('');
  el.innerHTML=`<table class="tbl"><thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>T</th><th>OWP</th><th>Record</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderResultsTab(standings, registrations, t, el) {
  if(!standings?.length){el.innerHTML=empty('No results yet');return;}
  const regMap={};
  (registrations||[]).forEach(r=>regMap[r.userId]=r);
  const top3=standings.slice(0,Math.min(3,standings.length));
  const rest=standings.slice(3);

  // Podium
  const medals=['🥇','🥈','🥉'];
  const podiumColors=['var(--gold)','#b0b8cc','#cd7f32'];
  let html=`<div style="text-align:center;margin-bottom:32px">
    <div style="font-family:var(--display);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:20px">Final Results — ${esc(t.name)}</div>
    <div style="display:flex;justify-content:center;align-items:flex-end;gap:16px;margin-bottom:24px">
      ${[1,0,2].filter(i=>top3[i]).map(i=>{
        const p=top3[i];
        const reg=regMap[p.userId];
        const h=i===0?120:i===1?100:80;
        return `<div style="text-align:center">
          <div style="font-size:${i===0?'28':'22'}px;margin-bottom:6px">${medals[i]}</div>
          <div style="font-weight:700;font-size:${i===0?'15':'13'}px;margin-bottom:4px;cursor:pointer;color:var(--text)" onclick="showProfile('${esc(p.username)}')">${esc(p.username)}</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:8px">${p.wins}W-${p.losses}L</div>
          <div style="background:${podiumColors[i]};border-radius:6px 6px 0 0;width:80px;height:${h}px;margin:0 auto;opacity:.3"></div>
          <div style="font-size:12px;font-weight:700;color:${podiumColors[i]};background:${podiumColors[i]}22;border:1px solid ${podiumColors[i]}44;border-radius:4px;padding:2px 8px">#${i+1}</div>
          ${reg?.decks?.length?`<div style="font-size:10px;color:var(--text3);margin-top:4px">${reg.decks.map(d=>`<span class="badge badge-blue" style="cursor:pointer;font-size:9px" onclick="window.open('/deck.html?t=${esc(t.id)}&u=${esc(p.userId)}&d=${reg.decks.indexOf(d)}','_blank')">${esc(d.name)}</span>`).join(' ')}</div>`:''}
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // Full standings
  if(rest.length) {
    html+=`<table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Record</th><th>Decks</th></tr></thead><tbody>
    ${rest.map((p,i)=>{
      const reg=regMap[p.userId];
      return `<tr>
        <td class="rank-num">${i+4}</td>
        <td style="font-weight:500;cursor:pointer;color:var(--teal)" onclick="showProfile('${esc(p.username)}')">${esc(p.username)}</td>
        <td class="font-mono text-sm">${p.wins}-${p.losses}</td>
        <td>${reg?.decks?.map((d,di)=>`<span class="badge badge-blue" style="cursor:pointer;font-size:10px" onclick="window.open('/deck.html?t=${esc(t.id)}&u=${esc(p.userId)}&d=${di}','_blank')">${esc(d.name)}</span>`).join(' ')||'—'}</td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
  }

  el.innerHTML=html;
}

function renderPlayersTab(data,t,isJudge,el) {
  if(!data?.length){el.innerHTML=empty('No players registered');return;}
  const active=data.filter(p=>!p.waitlist&&!p.dropped);
  const waitlist=data.filter(p=>p.waitlist);
  const dropped=data.filter(p=>p.dropped);
  const sec=(title,list)=>{
    if(!list.length) return '';
    const rows=list.map((r,i)=>`<tr>
      <td class="rank-num">${i+1}</td>
      <td style="font-weight:500">${esc(r.username)}</td>
      <td>${(r.decks||[]).map((d,di)=>`<span class="badge badge-blue" style="cursor:pointer;margin-right:4px"
        onclick="window.open('/deck.html?t=${esc(_currentDetailId)}&u=${esc(r.userId)}&d=${di}','_blank')"
        >${esc(d.name)}</span>`).join('')}</td>
      <td>${r.checkedIn?'<span class="badge badge-green">✓</span>':'<span class="badge badge-gray">—</span>'}</td>
      ${isJudge?`<td><button class="btn btn-ghost btn-sm" onclick="orgDrop('${r.userId}')">Drop</button></td>`:'<td></td>'}
    </tr>`).join('');
    return `<div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:8px">${title} (${list.length})</div>
      <table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Decks</th><th>Check-in</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  };
  el.innerHTML=sec('Players',active)+sec('Waitlist',waitlist)+sec('Dropped',dropped);
}

let _playersCache = null;

async function viewDeckVisualById(userId, username, deckIdx) {
  // Get full registration data (with lists)
  if(!_playersCache) {
    _playersCache = await api('GET', `/api/tournaments/${_currentDetailId}/registrations`);
  }
  const reg = _playersCache?.find(r => r.userId === userId);
  const deck = reg?.decks?.[deckIdx];
  if(!deck) return toast('Deck not found','error');
  viewDeckVisual(username, deck.name, deck.list || '');
}

async function viewDeckVisual(playerName, deckName, listText) {
  _id('decks-content').innerHTML = `<div class="loader-wrap"><div class="pokeball"></div><span>Loading cards…</span></div>`;
  openModal('modal-decks');

  // Parse decklist text into card names + quantities
  const lines = (listText||'').trim().split('\n').filter(Boolean);
  const cards = [];
  for(const line of lines) {
    const m = line.trim().match(/^(\d+)\s+(.+?)(?:\s+[A-Z0-9]+\s+\d+)?$/);
    if(m) cards.push({ qty: parseInt(m[1]), name: m[2].trim() });
  }

  if(!cards.length) {
    _id('decks-content').innerHTML = `
      <div style="font-weight:600;color:var(--teal);margin-bottom:4px">${esc(playerName)} — ${esc(deckName)}</div>
      <div class="text-dim">(no decklist provided)</div>`;
    return;
  }

  // Fetch card images from API
  const cardData = {};
  await Promise.all(cards.map(async c => {
    const r = await api('GET', `/api/cards/search?q=${encodeURIComponent(c.name)}`);
    if(r && r.length) cardData[c.name] = r[0];
  }));

  // Separate Pokémon from Trainers
  const pokemon = cards.filter(c => {
    const d = cardData[c.name];
    return d ? !['Item','Supporter','Stadium'].includes(d.type) : c.name.includes('ex')||(!c.name.includes(' ')||c.name.match(/^[A-Z]/));
  });
  const trainers = cards.filter(c => !pokemon.includes(c));

  const renderSection = (title, list) => {
    if(!list.length) return '';
    return `<div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">${title} (${list.reduce((a,c)=>a+c.qty,0)})</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${list.map(c => {
          const d = cardData[c.name];
          return `<div style="position:relative;text-align:center">
            ${d?.image
              ? `<div style="position:relative;display:inline-block">
                  <img src="${esc(d.image)}" alt="${esc(c.name)}"
                    style="height:100px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.4);transition:transform .15s;cursor:pointer"
                    onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform=''"
                    onerror="this.parentElement.innerHTML='<div style=\'width:70px;height:100px;background:var(--surface2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text3);text-align:center;padding:4px\'>${esc(c.name)}</div>'">
                  ${c.qty>1?`<div style="position:absolute;top:4px;right:4px;background:var(--accent);color:#fff;border-radius:10px;font-size:11px;font-weight:700;padding:1px 6px">×${c.qty}</div>`:''}
                </div>`
              : `<div style="width:70px;height:100px;background:var(--surface2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text3);text-align:center;padding:4px">${esc(c.name)}</div>`
            }
            <div style="font-size:10px;color:var(--text3);margin-top:4px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  };

  _id('decks-content').innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-weight:700;font-size:16px">${esc(playerName)}</div>
      <div style="color:var(--teal);font-size:14px">${esc(deckName)} · ${cards.reduce((a,c)=>a+c.qty,0)} cards</div>
    </div>
    ${renderSection('Pokémon', pokemon)}
    ${renderSection('Trainers', trainers)}
    <hr class="divider">
    <div style="font-size:11px;color:var(--text3)">
      ${cards.map(c=>`${c.qty}× ${esc(c.name)}`).join(' · ')}
    </div>`;
}

// ── Judge Panel ───────────────────────────────────────────────────────────────
async function renderJudgePanel(t,el) {
  el.innerHTML=loader();
  const [penalties,disputes]=await Promise.all([
    api('GET',`/api/tournaments/${_currentDetailId}/penalties`),
    api('GET',`/api/tournaments/${_currentDetailId}/disputes`),
  ]);
  const isOrg=_me&&t.organizerId===_me.id;
  const reg=t.registrations||[];
  const active=reg.filter(r=>!r.waitlist&&!r.dropped);
  const openDisputes=(disputes||[]).filter(d=>d.status==='open');
  const pens=penalties||[];
  let html=`<div class="judge-grid">
    <div class="judge-stat"><div class="num">${active.length}</div><div class="lbl">Active Players</div></div>
    <div class="judge-stat"><div class="num text-gold">${openDisputes.length}</div><div class="lbl">Open Disputes</div></div>
    <div class="judge-stat"><div class="num text-accent">${pens.filter(p=>p.type==='dq').length}</div><div class="lbl">Disqualifications</div></div>
    <div class="judge-stat"><div class="num">${pens.length}</div><div class="lbl">Total Penalties</div></div>
  </div>`;

  // Organizer: Add Judge
  if(isOrg) {
    const judgeNames=Object.values(t.judgeNames||{}).join(', ')||'None';
    html+=`<div class="judge-section">
      <div class="judge-section-title">Judges <span>${judgeNames}</span></div>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="add-judge-input" placeholder="Username to add as judge" style="flex:1">
        <button class="btn btn-outline" onclick="addJudge()">Add Judge</button>
      </div>
    </div>`;
  }

  // Issue Penalty
  if(t.status==='ongoing') {
    html+=`<div class="judge-section">
      <div class="judge-section-title">Issue Penalty</div>
      <div class="form-row">
        <div class="form-group">
          <label>Player</label>
          <select class="form-input" id="pen-player">
            <option value="">Select player…</option>
            ${active.map(r=>`<option value="${r.userId}">${esc(r.username)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Penalty Type</label>
          <select class="form-input" id="pen-type">
            ${PENALTY_TYPES.map(p=>`<option value="${p.value}">${p.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Reason</label>
        <input class="form-input" id="pen-reason" placeholder="Describe the infraction…">
      </div>
      <button class="btn btn-danger" onclick="issuePenalty()">Issue Penalty</button>
    </div>`;
  }

  // Open Disputes
  if(openDisputes.length) {
    html+=`<div class="judge-section">
      <div class="judge-section-title">Open Disputes (${openDisputes.length})</div>
      ${openDisputes.map(d=>`<div class="card card-sm dispute-open" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-weight:600;font-size:13px">${esc(d.submittedByName)}</div>
            <div style="color:var(--text2);font-size:13px;margin-top:4px">${esc(d.description)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:4px">${fmtDate(d.submittedAt)}</div>
          </div>
          <button class="btn btn-success btn-sm" onclick="resolveDispute('${d.id}')">Resolve</button>
        </div>
      </div>`).join('')}
    </div>`;
  }

  // Penalty log
  html+=`<div class="judge-section">
    <div class="judge-section-title">Penalty Log (${pens.length})</div>
    ${!pens.length?'<div class="text-dim text-sm">No penalties issued.</div>':
    `<table class="tbl"><thead><tr><th>Player</th><th>Type</th><th>Reason</th><th>Round</th><th>Issued By</th></tr></thead>
    <tbody>${pens.sort((a,b)=>b.issuedAt-a.issuedAt).map(p=>`<tr>
      <td style="font-weight:500">${esc(p.playerName||'?')}</td>
      <td><span class="penalty-badge penalty-${p.type}">${p.type.replace('_',' ')}</span></td>
      <td class="text-muted">${esc(p.reason)}</td>
      <td class="text-dim">R${p.round}</td>
      <td class="text-dim">${esc(p.issuedByName)}</td>
    </tr>`).join('')}</tbody></table>`}
  </div>`;

  // Resolved disputes
  const resolved=(disputes||[]).filter(d=>d.status!=='open');
  if(resolved.length) html+=`<div class="judge-section">
    <div class="judge-section-title">Resolved Disputes (${resolved.length})</div>
    ${resolved.map(d=>`<div class="card card-sm dispute-resolved" style="margin-bottom:6px">
      <div style="font-weight:500;font-size:13px">${esc(d.submittedByName)}: ${esc(d.description)}</div>
      <div style="font-size:12px;color:var(--green);margin-top:4px">✓ ${esc(d.resolution)} — ${esc(d.resolvedBy)}</div>
    </div>`).join('')}
  </div>`;

  el.innerHTML=html;
}

async function addJudge() {
  const username=_id('add-judge-input')?.value?.trim();
  if(!username) return toast('Enter a username','error');
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/judges`,{username});
  if(r.error) return toast(r.error,'error');
  toast(`${r.username} added as judge`,'success');
  _id('add-judge-input').value='';
  _currentTournament=await api('GET',`/api/tournaments/${_currentDetailId}`);
  renderDetailContent();
}

async function issuePenalty() {
  const playerId=_id('pen-player')?.value;
  const type=_id('pen-type')?.value;
  const reason=_id('pen-reason')?.value?.trim();
  if(!playerId) return toast('Select a player','error');
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/penalties`,{playerId,type,reason});
  if(r.error) return toast(r.error,'error');
  toast(`Penalty issued: ${type.replace('_',' ')}`,'success');
  _id('pen-reason').value='';
  _currentTournament=await api('GET',`/api/tournaments/${_currentDetailId}`);
  renderDetailContent();
}

async function resolveDispute(disputeId) {
  const resolution=prompt('Resolution / ruling:');
  if(!resolution) return;
  const r=await api('PATCH',`/api/tournaments/${_currentDetailId}/disputes/${disputeId}`,{resolution,status:'resolved'});
  if(r.error) return toast(r.error,'error');
  toast('Dispute resolved','success');
  renderDetailContent();
}

function openPenaltyModal(p1id,p1name,p2id,p2name) {
  _id('penalty-content').innerHTML=`
    <div class="form-group"><label>Player</label>
      <select class="form-input" id="pm-player">
        <option value="${p1id}">${p1name}</option>
        <option value="${p2id}">${p2name}</option>
      </select>
    </div>
    <div class="form-group"><label>Penalty Type</label>
      <select class="form-input" id="pm-type">
        ${PENALTY_TYPES.map(p=>`<option value="${p.value}">${p.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Reason</label><input class="form-input" id="pm-reason" placeholder="Describe the infraction…"></div>
    <button class="btn btn-danger btn-block" onclick="submitPenaltyModal()">Issue Penalty</button>`;
  openModal('modal-penalty');
}

async function submitPenaltyModal() {
  const playerId=_id('pm-player')?.value;
  const type=_id('pm-type')?.value;
  const reason=_id('pm-reason')?.value?.trim();
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/penalties`,{playerId,type,reason});
  if(r.error) return toast(r.error,'error');
  closeModal('modal-penalty');
  toast(`Penalty: ${type.replace('_',' ')}`,'success');
  _currentTournament=await api('GET',`/api/tournaments/${_currentDetailId}`);
  renderDetailContent();
}

function openDisputeModal(matchId) {
  _id('dispute-content').innerHTML=`
    <p class="text-muted text-sm mb-16">Describe the issue with your current match. A judge will review it.</p>
    <div class="form-group"><label>Description</label><textarea class="form-input" id="disp-desc" placeholder="What happened?"></textarea></div>
    <button class="btn btn-primary btn-block" onclick="submitDispute('${matchId}')">Submit Dispute</button>`;
  openModal('modal-dispute');
}

async function submitDispute(matchId) {
  const desc=_id('disp-desc')?.value?.trim();
  if(!desc) return toast('Please describe the issue','error');
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/disputes`,{matchId,description:desc});
  if(r.error) return toast(r.error,'error');
  closeModal('modal-dispute');
  toast('Dispute submitted — a judge will review it','info');
}

// ── Organizer Actions ─────────────────────────────────────────────────────────
async function doStart() {
  if(!confirm('Start the tournament? Registration will close.')) return;
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/start`);
  if(r.error) return toast(r.error,'error');
  toast('Tournament started! Round 1 pairings generated.','success');
  _currentTournament=r; renderDetailContent();
}
async function doNextRound() {
  if(!confirm('Advance to the next round?')) return;
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/next-round`);
  if(r.error) return toast(r.error,'error');
  if(r.status==='completed') toast('Tournament completed!','success');
  else if(r.phaseAdvanced) toast(`Phase advanced: ${r.newPhase}!`,'success');
  else toast(`Round ${r.tournament.currentRound} started!`,'success');
  _currentTournament=r.tournament||r; renderDetailContent();
}
async function doCheckin() {
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/checkin`);
  if(r.error) return toast(r.error,'error');
  _myReg.checkedIn=true; toast('Checked in!','success'); renderDetailContent();
}
async function doDrop() {
  if(!confirm('Drop from this tournament?')) return;
  const r=await api('DELETE',`/api/tournaments/${_currentDetailId}/register`);
  if(r.error) return toast(r.error,'error');
  _myReg=null; toast('You have dropped.','info'); renderDetailContent();
}
async function doDeleteTournament() {
  if(!confirm('Delete this tournament permanently? This cannot be undone.')) return;
  const r=await api('DELETE',`/api/tournaments/${_currentDetailId}`);
  if(r.error) return toast(r.error,'error');
  toast('Tournament deleted.','info');
  showPage('home');
}
async function orgDrop(userId) {
  if(!confirm('Drop this player?')) return;
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/drop/${userId}`);
  if(r.error) return toast(r.error,'error');
  toast('Player dropped.','info'); renderDetailContent();
}

// ── Password Reset ────────────────────────────────────────────────────────────
function showForgotPassword(show=true) {
  _id('login-form').style.display = show ? 'none' : '';
  _id('forgot-form').style.display = show ? '' : 'none';
  if(show) setTimeout(() => _id('forgot-email')?.focus(), 50);
}

async function doForgotPassword() {
  const email = _id('forgot-email')?.value?.trim();
  if(!email) return toast('Enter your email','error');
  const btn = event.target;
  btn.textContent = 'Sending…'; btn.disabled = true;
  const r = await api('POST','/api/forgot-password',{ email });
  btn.textContent = 'Send Reset Link'; btn.disabled = false;
  if(r.error) return toast(r.error,'error');
  _id('forgot-form').innerHTML = `<div style="text-align:center;padding:20px 0">
    <div style="font-size:32px;margin-bottom:12px">📧</div>
    <div style="font-weight:600;font-size:15px;margin-bottom:8px">Check your inbox</div>
    <div style="color:var(--text2);font-size:13px">We sent a reset link to <strong>${esc(email)}</strong>.<br>It expires in 1 hour.</div>
  </div>`;
}

async function doResetPassword() {
  const pass = _id('reset-pass')?.value;
  const pass2 = _id('reset-pass2')?.value;
  if(!pass || pass.length < 6) return toast('Password must be at least 6 characters','error');
  if(pass !== pass2) return toast('Passwords do not match','error');
  const token = new URLSearchParams(window.location.search).get('token');
  const r = await api('POST','/api/reset-password',{ token, password: pass });
  if(r.error) return toast(r.error,'error');
  closeModal('modal-reset');
  toast('Password updated! You can now log in.','success');
  window.history.replaceState({}, '', '/');
  openModal('modal-login');
}

function checkResetToken() {
  const token = new URLSearchParams(window.location.search).get('token');
  if(token) { _id('modal-reset').style.display = 'flex'; }
}

// ── Deck Builder (Limitless style) ────────────────────────────────────────────
// Pokémon TCG Pocket card database (top meta cards for autocomplete)
const POCKET_CARDS = [
  // Genetic Apex
  'Charizard ex','Pikachu ex','Mewtwo ex','Mew ex','Eevee ex','Venusaur ex','Blastoise ex',
  'Gengar ex','Gyarados ex','Dragonite ex','Raichu ex','Nidoking ex','Clefable ex','Articuno ex',
  'Zapdos ex','Moltres ex','Snorlax ex','Marowak ex','Alakazam ex','Machamp ex',
  'Charmander','Charmeleon','Squirtle','Wartortle','Bulbasaur','Ivysaur',
  'Pikachu','Raichu','Mewtwo','Jigglypuff','Wigglytuff','Clefairy',
  'Poké Ball','Professor\'s Research','Misty','Brock','Giovanni','Sabrina','Lt. Surge',
  'Red Card','PokéStop','Potion','X Speed','Rocky Helmet','Cape of Toughness',
  // Mythical Island
  'Celebi ex','Marshadow ex','Gardevoir ex','Sylveon ex','Leafeon ex','Glaceon ex',
  // Space-Time Smackdown
  'Dialga ex','Palkia ex','Giratina ex','Darkrai ex','Cresselia ex',
  // Triumphant Light
  'Arceus ex','Shaymin ex','Regigigas ex',
  // Shining Revelations
  'Reshiram ex','Zekrom ex','Kyurem ex',
  // Paradox Drive
  'Roaring Moon ex','Iron Valiant ex','Flutter Mane ex','Great Tusk ex',
  // Trainers
  'Professor Oak','Cyrus','Iono','Arven','Penny','Giacomo','Tulip',
  'Nest Ball','Ultra Ball','Super Incubator','Rare Candy',
];

let _deckBuilderMode = 'text'; // 'text' | 'visual'

function renderTregModal() {
  const t = _tregTournament;
  const minD = t.minDecks||1, maxD = t.maxDecks||1;
  const mm = MATCH_MODES[t.phases?.[0]?.matchMode];

  let html = '';
  if(mm) html += `<div class="mode-info mb-16"><strong>${mm.icon} ${mm.label}</strong> — ${mm.desc}</div>`;
  html += `<p style="color:var(--text2);font-size:13px;margin-bottom:16px">Submit ${minD===maxD?minD:minD+'–'+maxD} deck(s).${t.deckRules?` <strong style="color:var(--text)">Rules:</strong> ${esc(t.deckRules)}`:''}`;
  if(t.entryType==='code') html += `<div class="form-group"><label>Entry Code</label><input class="form-input" id="treg-code" placeholder="Enter code"></div>`;

  _tregDecks.forEach((d,i) => {
    const cardCount = countCards(d.list);
    html += `<div class="deck-slot">
      <div class="deck-slot-hdr">
        <span class="deck-slot-title">Deck ${i+1}${i<minD?' <span style="color:var(--accent);font-size:10px">required</span>':''}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:${cardCount===20?'var(--teal)':cardCount>20?'var(--red)':'var(--text3)'}">${cardCount}/20 cards</span>
          ${i>=minD?`<button class="deck-remove-btn" onclick="tregRemoveDeck(${i})">×</button>`:''}
        </div>
      </div>
      <div class="form-group" style="margin-bottom:8px">
        <label>Deck Name</label>
        <input class="form-input" placeholder="e.g. Charizard ex" value="${esc(d.name)}" id="treg-name-${i}">
      </div>
      <div class="deck-builder-tabs" style="display:flex;gap:0;margin-bottom:8px;border-bottom:1px solid var(--border)">
        <div class="deck-tab ${d.mode!=='visual'?'active':''}" onclick="setDeckMode(${i},'text')" style="padding:6px 14px;font-size:12px;font-weight:500;cursor:pointer;border-bottom:2px solid ${d.mode!=='visual'?'var(--accent)':'transparent'};color:${d.mode!=='visual'?'var(--text)':'var(--text3)'}">Text Import</div>
        <div class="deck-tab ${d.mode==='visual'?'active':''}" onclick="setDeckMode(${i},'visual')" style="padding:6px 14px;font-size:12px;font-weight:500;cursor:pointer;border-bottom:2px solid ${d.mode==='visual'?'var(--accent)':'transparent'};color:${d.mode==='visual'?'var(--text)':'var(--text3)'}">Card Search</div>
      </div>
      ${d.mode==='visual' ? renderCardSearch(d, i) : renderTextInput(d, i)}
    </div>`;
  });

  if(_tregDecks.length < maxD) html += `<button class="add-deck-btn" onclick="tregAddDeck()">+ Add Deck ${_tregDecks.length+1}</button>`;
  html += `<button class="btn btn-primary btn-block" onclick="submitRegistration()">Register (${_tregDecks.length} deck${_tregDecks.length>1?'s':''})</button>`;
  _id('treg-content').innerHTML = html;
}

function renderTextInput(d, i) {
  return `<div class="form-group" style="margin-bottom:0">
    <label style="display:flex;justify-content:space-between;align-items:center">
      Decklist
      <span style="font-size:11px;color:var(--text3);font-weight:400;text-transform:none;letter-spacing:0">Paste export from TCG Pocket or type manually</span>
    </label>
    <textarea class="form-input" style="min-height:120px;font-size:12px;font-family:monospace;line-height:1.6"
      placeholder="2 Charizard ex A1 036&#10;2 Charmander A1 034&#10;2 Charmeleon A1 035&#10;2 Moltres ex A1 030&#10;..." 
      id="treg-list-${i}" oninput="onDeckTextChange(${i},this.value)">${esc(d.list)}</textarea>
    <div style="font-size:11px;color:var(--text3);margin-top:4px">Format: <code style="background:var(--bg);padding:1px 4px;border-radius:3px">2 Charizard ex A1 036</code> — qty, name, set, number</div>
  </div>`;
}

function renderCardSearch(d, i) {
  const cards = d.cards || {};
  const total = Object.values(cards).reduce((a,b)=>a+b,0);
  return `<div>
    <div style="position:relative;margin-bottom:10px">
      <input class="form-input" id="card-search-${i}" placeholder="Search cards… (e.g. Charizard, Professor)" 
        oninput="onCardSearch(${i},this.value)" autocomplete="off"
        style="padding-right:36px">
      <div id="card-suggestions-${i}" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--surface2);border:1px solid var(--border);border-radius:0 0 var(--r) var(--r);z-index:100;max-height:200px;overflow-y:auto"></div>
    </div>
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);min-height:80px;padding:10px">
      ${total===0 ? '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px 0">Search and add cards above</div>' :
        Object.entries(cards).map(([name,qty]) => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px">${esc(name)}</span>
            <div style="display:flex;align-items:center;gap:6px">
              <button onclick="changeCardQty(${i},'${esc(name)}',-1)" style="width:22px;height:22px;border-radius:4px;background:var(--surface3);border:none;color:var(--text);cursor:pointer;font-size:14px">−</button>
              <span style="font-size:13px;font-weight:600;min-width:16px;text-align:center">${qty}</span>
              <button onclick="changeCardQty(${i},'${esc(name)}',1)" style="width:22px;height:22px;border-radius:4px;background:var(--surface3);border:none;color:var(--text);cursor:pointer;font-size:14px">+</button>
            </div>
          </div>`).join('')
      }
    </div>
    <div style="text-align:right;font-size:12px;margin-top:6px;color:${total===20?'var(--teal)':total>20?'var(--red)':'var(--text3)'}">
      ${total}/20 cards ${total===20?'✓ Ready':total>20?'⚠ Too many cards':''}
    </div>
  </div>`;
}

function countCards(list) {
  if(!list) return 0;
  return list.trim().split('\n').reduce((sum, line) => {
    const m = line.trim().match(/^(\d+)\s+/);
    return sum + (m ? parseInt(m[1]) : 0);
  }, 0);
}

function setDeckMode(i, mode) {
  tregSave();
  _tregDecks[i].mode = mode;
  if(mode === 'visual' && !_tregDecks[i].cards) {
    // Parse existing text list into cards object
    _tregDecks[i].cards = parseTextToCards(_tregDecks[i].list);
  }
  renderTregModal();
}

function parseTextToCards(text) {
  if(!text) return {};
  const cards = {};
  for(const line of text.trim().split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+?)(?:\s+[A-Z0-9]+\s+\d+)?$/);
    if(m) cards[m[2].trim()] = parseInt(m[1]);
  }
  return cards;
}

function cardsToText(cards) {
  return Object.entries(cards).map(([name,qty]) => `${qty} ${name}`).join('\n');
}

function onDeckTextChange(i, value) {
  _tregDecks[i].list = value;
  // Update counter live
  const cardCount = countCards(value);
  const counter = document.querySelector(`#treg-content .deck-slot:nth-child(${i+1}) span[style*="12px"]`);
  // Just re-render the counter
}

function onCardSearch(i, query) {
  const sugEl = _id(`card-suggestions-${i}`);
  if(!query || query.length < 2) { sugEl.style.display='none'; return; }
  // Debounce
  clearTimeout(window._cardSearchTimer);
  window._cardSearchTimer = setTimeout(async () => {
    const r = await api('GET', `/api/cards/search?q=${encodeURIComponent(query)}`);
    if(!r || r.error || !r.length) { sugEl.style.display='none'; return; }
    sugEl.innerHTML = r.map(c => `
      <div onclick="addCard(${i},'${esc(c.name)}','${esc(c.id)}')"
        style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)"
        onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background=''">
        ${c.image ? `<img src="${esc(c.image)}" style="width:32px;height:44px;object-fit:contain;border-radius:3px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
        <div>
          <div style="font-size:13px;font-weight:500">${esc(c.name)}${c.ex?' <span style="color:var(--teal);font-size:10px">EX</span>':''}</div>
          <div style="font-size:11px;color:var(--text3)">${esc(c.set||'')} ${esc(c.number||'')} ${c.rarity?'· '+c.rarity:''}</div>
        </div>
      </div>`).join('');
    sugEl.style.display = 'block';
  }, 250);
}

function addCard(i, name, cardId) {
  tregSave();
  if(!_tregDecks[i].cards) _tregDecks[i].cards = {};
  const current = _tregDecks[i].cards[name] || 0;
  const total = Object.values(_tregDecks[i].cards).reduce((a,b)=>a+b,0);
  if(total >= 20) return toast('Deck is already at 20 cards','error');
  if(current >= 2) return toast('Maximum 2 copies per card','error');
  _tregDecks[i].cards[name] = current + 1;
  if(cardId) {
    if(!_tregDecks[i].cardIds) _tregDecks[i].cardIds = {};
    _tregDecks[i].cardIds[name] = cardId;
  }
  _tregDecks[i].list = cardsToText(_tregDecks[i].cards);
  const searchEl = _id(`card-search-${i}`);
  if(searchEl) searchEl.value = '';
  const sugEl = _id(`card-suggestions-${i}`);
  if(sugEl) sugEl.style.display = 'none';
  renderTregModal();
}

function changeCardQty(i, name, delta) {
  tregSave();
  if(!_tregDecks[i].cards) return;
  const current = _tregDecks[i].cards[name] || 0;
  const newQty = current + delta;
  if(newQty <= 0) delete _tregDecks[i].cards[name];
  else if(delta > 0 && Object.values(_tregDecks[i].cards).reduce((a,b)=>a+b,0) >= 20) return toast('Deck is already at 20 cards','error');
  else if(newQty > 2) return toast('Maximum 2 copies per card','error');
  else _tregDecks[i].cards[name] = newQty;
  _tregDecks[i].list = cardsToText(_tregDecks[i].cards);
  renderTregModal();
}

// ── Registration ──────────────────────────────────────────────────────────────
function openRegistration() {
  if(!_token) return openModal('modal-login');
  _tregTournament=_currentTournament;
  _tregDecks=Array.from({length:_tregTournament.minDecks},()=>({name:'',list:'',mode:'text'}));
  renderTregModal(); openModal('modal-treg');
}

function tregSave() {
  _tregDecks.forEach((d,i) => {
    d.name = _id(`treg-name-${i}`)?.value || d.name;
    d.list = _id(`treg-list-${i}`)?.value || d.list;
  });
}
function tregAddDeck() { tregSave(); _tregDecks.push({name:'',list:'',mode:'text'}); renderTregModal(); }
function tregRemoveDeck(i) { tregSave(); _tregDecks.splice(i,1); renderTregModal(); }

async function submitRegistration() {
  tregSave();
  const t=_tregTournament;
  if(_tregDecks.length<(t.minDecks||1)) return toast(`Need at least ${t.minDecks} deck(s)`,'error');
  for(const[i,d]of _tregDecks.entries()) if(!d.name.trim()) return toast(`Deck ${i+1} needs a name`,'error');
  const body={decks:_tregDecks};
  if(t.entryType==='code') body.entryCode=_id('treg-code')?.value;
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/register`,body);
  if(r.error) return toast(r.error,'error');
  closeModal('modal-treg');
  toast(r.waitlist?'Added to waitlist!':'Registered successfully!',r.waitlist?'warn':'success');
  _myReg=await api('GET',`/api/tournaments/${_currentDetailId}/my-registration`);
  renderDetailContent();
}

// ── Result Reporting ──────────────────────────────────────────────────────────
function openResult(matchId,p1id,p2id,p1name,p2name,editing=false) {
  _resultMatch={id:matchId,p1:p1id,p2:p2id,p1name,p2name};
  const mode=_currentTournament?.phases?.[_currentTournament.currentPhase]?.matchMode||'Bo3';
  const mm=MATCH_MODES[mode];
  let html=`<div class="mode-info mb-16"><strong>${mm?.icon} ${mm?.label}</strong>${mm?.desc}</div>
    <div class="form-group"><label>Winner</label>
      <select class="form-input" id="res-winner">
        <option value="${p1id}">${p1name}</option>
        <option value="${p2id}">${p2name}</option>
      </select>
    </div>`;
  if(mode!=='Bo1') html+=`<div class="form-row">
    <div class="form-group"><label>Winner's games</label><input class="form-input" type="number" id="res-sw" min="0" max="5" value="${mode==='Bo5'?3:2}"></div>
    <div class="form-group"><label>Loser's games</label><input class="form-input" type="number" id="res-sl" min="0" max="4" value="0"></div>
  </div>
  <button class="btn btn-outline btn-sm mb-16" onclick="submitTie()">Declare Tie</button>`;
  html+=`<button class="btn btn-primary btn-block" onclick="submitResult()">Confirm Result</button>`;
  _id('result-content').innerHTML=html;
  openModal('modal-result');
}
async function submitResult() {
  const m=_resultMatch;
  const winner=_id('res-winner')?.value||m.p1;
  const sw=parseInt(_id('res-sw')?.value??2);
  const sl=parseInt(_id('res-sl')?.value??0);
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/result`,{matchId:m.id,winner,scoreWinner:sw,scoreLoser:sl});
  if(r.error) return toast(r.error,'error');
  closeModal('modal-result'); toast('Result submitted!','success'); renderDetailContent();
}
async function submitTie() {
  const r=await api('POST',`/api/tournaments/${_currentDetailId}/result`,{matchId:_resultMatch.id,isTie:true});
  if(r.error) return toast(r.error,'error');
  closeModal('modal-result'); toast('Tie recorded.','info'); renderDetailContent();
}

// ── View Decks ────────────────────────────────────────────────────────────────
function openMyDecks() {
  if(!_myReg) return;
  _id('decks-content').innerHTML=(_myReg.decks||[]).map((d,i)=>`
    <div style="margin-bottom:16px">
      <div style="font-weight:600;color:var(--teal);margin-bottom:6px">Deck ${i+1}: ${esc(d.name)}</div>
      <div class="deck-list-preview">${esc(d.list)||'(no list provided)'}</div>
    </div>`).join('')||'<div class="text-dim">No decks.</div>';
  openModal('modal-decks');
}
function viewDeck(name,list) {
  _id('decks-content').innerHTML=`<div style="font-weight:600;color:var(--teal);margin-bottom:8px">${esc(name)}</div><div class="deck-list-preview">${esc(list)||'(no list)'}</div>`;
  openModal('modal-decks');
}

// ── Create Wizard ─────────────────────────────────────────────────────────────
function initWizard() {
  _wizardStep=1;
  if(!_phases.length) {
    _phases=[
      {name:'Swiss',type:'swiss',matchMode:'Bo3',rounds:5,cutValue:8},
      {name:'Top 8',type:'single_elim',matchMode:'Bo3',rounds:3,cutValue:8},
    ];
  }
  updateWizardUI();
}
function wizardNext(step) {
  if(step===2&&!_v('c-name')) return toast('Tournament name is required','error');
  _wizardStep=step;
  updateWizardUI();
  if(step===2) renderPhases();
}
function updateWizardUI() {
  [1,2,3].forEach(i=>{
    _id(`create-step-${i}`).style.display=i===_wizardStep?'':'none';
    const ws=_id(`ws${i}`);
    ws.classList.toggle('active',i===_wizardStep);
    ws.classList.toggle('done',i<_wizardStep);
  });
}
function renderPhases() {
  _id('phases-container').innerHTML=_phases.map((p,i)=>renderPhaseCard(p,i)).join('');
}
function renderPhaseCard(p,i) {
  const phaseOpts=Object.entries(PHASE_TYPES).map(([k,v])=>`<option value="${k}" ${p.type===k?'selected':''}>${v.icon} ${v.label}</option>`).join('');
  const modeOpts=Object.entries(MATCH_MODES).map(([k,v])=>`<option value="${k}" ${p.matchMode===k?'selected':''}>${v.icon} ${v.label}</option>`).join('');
  const showRounds=p.type==='swiss'||p.type==='round_robin';
  const showCut=i>0;
  return `<div class="phase-card" id="phase-card-${i}">
    ${_phases.length>1?`<button class="phase-remove" onclick="removePhase(${i})">×</button>`:''}
    <div class="phase-header">
      <div class="phase-num">${i+1}</div>
      <input class="phase-title-input" placeholder="Phase name (optional)" value="${esc(p.name||'')}" oninput="_phases[${i}].name=this.value">
    </div>
    <div class="form-row">
      <div class="form-group"><label>Type</label>
        <select class="form-input" onchange="_phases[${i}].type=this.value;renderPhases()">${phaseOpts}</select></div>
      <div class="form-group"><label>Match Mode</label>
        <select class="form-input" onchange="_phases[${i}].matchMode=this.value;renderPhases()">${modeOpts}</select></div>
    </div>
    ${showRounds?`<div class="form-row">
      <div class="form-group"><label>Rounds</label><input class="form-input" type="number" min="1" max="20" value="${p.rounds||5}" oninput="_phases[${i}].rounds=+this.value"></div>
      ${showCut?`<div class="form-group"><label>Top N advance from previous</label><input class="form-input" type="number" min="2" max="256" value="${p.cutValue||8}" oninput="_phases[${i}].cutValue=+this.value"></div>`:'<div></div>'}
    </div>`:(showCut?`<div class="form-group"><label>Top N advance from previous phase</label><input class="form-input" type="number" min="2" max="256" value="${p.cutValue||8}" oninput="_phases[${i}].cutValue=+this.value"></div>`:'')}
    <div class="mode-info">${MATCH_MODES[p.matchMode]?.icon||''} <strong>${MATCH_MODES[p.matchMode]?.label||''}</strong> — ${MATCH_MODES[p.matchMode]?.desc||''}</div>
  </div>`;
}
function addPhase(){_phases.push({name:'',type:'single_elim',matchMode:'Bo3',rounds:3,cutValue:8});renderPhases();}
function removePhase(i){if(_phases.length<=1)return;_phases.splice(i,1);renderPhases();}

async function submitCreate() {
  if(!_token) return openModal('modal-login');
  const name=_v('c-name');
  if(!name) return toast('Tournament name required','error');
  const minD=parseInt(_v('c-mindecks'))||1, maxD=parseInt(_v('c-maxdecks'))||1;
  if(minD>maxD) return toast('Min decks cannot exceed max decks','error');
  const body={
    name, description:_v('c-desc'), prizePool:_v('c-prize'), discord:_v('c-discord'),
    maxPlayers:parseInt(_v('c-maxplayers'))||0, checkinRequired:_id('c-checkin').checked,
    minDecks:minD, maxDecks:maxD, deckVisibility:_v('c-deckvis'), deckRules:_v('c-deckrules'),
    entryType:_v('c-entrytype'),
    entryCodes:_v('c-codes')?.split('\n').map(s=>s.trim()).filter(Boolean)||[],
    inviteList:_v('c-invites')?.split('\n').map(s=>s.trim()).filter(Boolean)||[],
    phases:_phases,
  };
  const r=await api('POST','/api/tournaments',body);
  if(r.error) return toast(r.error,'error');
  toast('Tournament created!','success');
  _phases=[];
  openTournament(r.id);
}

// ── My Page ───────────────────────────────────────────────────────────────────
async function loadMyPage() {
  const el=_id('my-content');
  if(!_token){el.innerHTML=`<div class="empty"><div class="empty-icon">🔒</div>Log in to see your tournaments</div>`;return;}
  el.innerHTML=loader();
  const url=_myTab==='organized'?'/api/my/tournaments':_myTab==='registered'?'/api/my/registrations':'/api/my/judging';
  const data=await api('GET',url);
  if(!data?.length){
    el.innerHTML=_myTab==='organized'
      ?`<div class="empty"><div class="empty-icon">🏆</div>No tournaments organized yet.<br><br><button class="btn btn-primary" onclick="showPage('create')">Create one</button></div>`
      :_myTab==='judging'?`<div class="empty"><div class="empty-icon">⚖</div>You are not assigned as a judge in any tournament.</div>`
      :`<div class="empty"><div class="empty-icon">🎴</div>Not registered in any tournament.</div>`;
    return;
  }
  const rows=data.map(t=>`<tr>
    <td><span class="t-link" onclick="openTournament('${t.id}')">${esc(t.name)}</span></td>
    <td>${statusBadge(t.status)}</td>
    <td class="text-muted">${t.playerCount}</td>
  </tr>`).join('');
  el.innerHTML=`<table class="tbl"><thead><tr><th>Tournament</th><th>Status</th><th>Players</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id){_id(id).style.display='flex';}
function closeModal(id){_id(id).style.display='none';}
function closeModalOut(e,id){if(e.target.id===id)closeModal(id);}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg,type='info'){
  const el=document.createElement('div');
  el.className=`toast ${type}`; el.textContent=msg;
  _id('toasts').appendChild(el);
  setTimeout(()=>el.remove(),3800);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const _id=id=>document.getElementById(id);
const _v=id=>_id(id)?.value?.trim()||'';
const esc=s=>!s?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const loader=()=>`<div class="loader-wrap"><div class="pokeball"></div><span>Loading…</span></div>`;
const empty=msg=>`<div class="empty"><div class="empty-icon">📋</div>${msg}</div>`;
const fmtDate=ts=>!ts?'':new Date(ts).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
function statusBadge(s){
  return s==='ongoing'?'<span class="badge badge-green">● Live</span>'
        :s==='registration'?'<span class="badge badge-yellow">Open</span>'
        :'<span class="badge badge-gray">Completed</span>';
}
function onEntryTypeChange(val){
  _id('codes-group').style.display=val==='code'?'':'none';
  _id('invites-group').style.display=val==='invite'?'':'none';
}

// ── Timer ─────────────────────────────────────────────────────────────────────
let _timerInterval = null;
function formatTimer(timerEnd) {
  const diff = Math.max(0, timerEnd - Date.now());
  const m = Math.floor(diff/60000);
  const s = Math.floor((diff%60000)/1000);
  return `${m}:${s.toString().padStart(2,'0')}`;
}
function startTimerTick(timerEnd) {
  if(_timerInterval) clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    const el = _id('timer-display');
    if(!el) { clearInterval(_timerInterval); return; }
    const diff = timerEnd - Date.now();
    if(diff <= 0) {
      el.textContent = '0:00';
      el.style.color = 'var(--red)';
      clearInterval(_timerInterval);
      return;
    }
    el.textContent = formatTimer(timerEnd);
    el.style.color = diff < 60000 ? 'var(--red)' : diff < 180000 ? 'var(--gold)' : 'var(--teal)';
  }, 1000);
}
async function setTimer() {
  const mins = parseInt(_id('timer-mins')?.value);
  if(!mins || mins < 1) return toast('Enter minutes','error');
  const r = await api('PATCH',`/api/tournaments/${_currentDetailId}/timer`,{minutes:mins});
  if(r.error) return toast(r.error,'error');
  toast(`Timer set: ${mins} minutes`,'success');
  _currentTournament = await api('GET',`/api/tournaments/${_currentDetailId}`);
  renderDetailContent();
}
async function clearTimer() {
  const r = await api('PATCH',`/api/tournaments/${_currentDetailId}/timer`,{minutes:0});
  if(r.error) return toast(r.error,'error');
  if(_timerInterval) clearInterval(_timerInterval);
  _currentTournament = await api('GET',`/api/tournaments/${_currentDetailId}`);
  renderDetailContent();
}
function copyJoinLink() {
  const url = _id('join-url-input')?.value;
  navigator.clipboard?.writeText(url).then(()=>toast('Link copied!','success')).catch(()=>{
    _id('join-url-input').select(); document.execCommand('copy'); toast('Link copied!','success');
  });
}

// ── Edit Decks ────────────────────────────────────────────────────────────────
function openEditDecks() {
  if(!_myReg) return;
  _tregTournament = _currentTournament;
  _tregDecks = (_myReg.decks||[]).map(d => ({ name:d.name, list:d.list||'', mode:'text' }));
  renderEditModal();
  openModal('modal-treg');
}
function renderEditModal() {
  // Reuse treg modal but with edit title and patch endpoint
  _id('modal-treg').querySelector('.modal-title').textContent = 'Edit my Decklists';
  renderTregModal();
  // Replace Register button with Save button
  setTimeout(() => {
    const btn = _id('treg-content')?.querySelector('button.btn-primary');
    if(btn) { btn.textContent = 'Save Changes'; btn.onclick = submitEditDecks; }
  }, 50);
}
async function submitEditDecks() {
  tregSave();
  const t = _tregTournament;
  for(const[i,d]of _tregDecks.entries()) if(!d.name.trim()) return toast(`Deck ${i+1} needs a name`,'error');
  const r = await api('PATCH',`/api/tournaments/${_currentDetailId}/register`,{decks:_tregDecks});
  if(r.error) return toast(r.error,'error');
  closeModal('modal-treg');
  toast('Decklists updated!','success');
  _myReg = await api('GET',`/api/tournaments/${_currentDetailId}/my-registration`);
  renderDetailContent();
}

// ── Join Link & URL Routing ───────────────────────────────────────────────────
async function checkJoinParam() {
  const path = location.pathname;
  const params = new URLSearchParams(location.search);

  // Clean tournament URL: /tournament/ID
  const tourMatch = path.match(/^\/tournament\/([a-f0-9-]+)$/i);
  if(tourMatch) {
    _detailTab='details';
    showPage('tournament', tourMatch[1]);
    return;
  }
  // Organize page
  if(path==='/organize') { showPage('create'); return; }
  // My events
  if(path==='/my-events') { showPage('my'); return; }
  // Join param or t param
  const joinId = params.get('join') || params.get('t');
  if(joinId) {
    window.history.replaceState({page:'tournament',id:joinId}, '', `/tournament/${joinId}`);
    _detailTab='details';
    openTournament(joinId);
    return;
  }
  // Reset token
  const token = params.get('token');
  if(token) { _id('modal-reset').style.display='flex'; }
}

// ── Profile Page ──────────────────────────────────────────────────────────────
async function showProfile(username) {
  const r = await api('GET',`/api/profile/${encodeURIComponent(username)}`);
  if(r.error) return toast('Profile not found','error');
  const total = r.tournaments.length;
  const wins = r.totalWins, losses = r.totalLosses;
  const winrate = wins+losses > 0 ? Math.round(wins/(wins+losses)*100) : 0;
  _id('decks-content').innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-family:var(--display);font-size:22px;font-weight:700">${esc(r.username)}</div>
      <div style="color:var(--text3);font-size:13px;margin-top:4px">${total} tournament${total!==1?'s':''} played</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;text-align:center">
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px">
        <div style="font-size:22px;font-weight:700;color:var(--green)">${wins}</div>
        <div style="font-size:11px;color:var(--text3)">Wins</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px">
        <div style="font-size:22px;font-weight:700;color:var(--red)">${losses}</div>
        <div style="font-size:11px;color:var(--text3)">Losses</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px">
        <div style="font-size:22px;font-weight:700;color:var(--teal)">${winrate}%</div>
        <div style="font-size:11px;color:var(--text3)">Win Rate</div>
      </div>
    </div>
    ${r.tournaments.length ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:10px">Tournaments</div>
    ${r.tournaments.map(t=>`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="closeModal('modal-decks');openTournament('${t.id}')">
      <div>
        <div style="font-weight:500;font-size:13px">${esc(t.name)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${t.decks?.map(d=>d.name).join(', ')||'—'}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;color:var(--green)">${t.wins}W <span style="color:var(--red)">${t.losses}L</span></div>
        ${statusBadge(t.status)}
      </div>
    </div>`).join('')}` : '<div class="text-dim text-sm">No tournaments yet.</div>'}`;
  _id('modal-decks').querySelector('.modal-title').textContent = `${r.username}'s Profile`;
  openModal('modal-decks');
}

// ── Init ──────────────────────────────────────────────────────────────────────
refreshAuthUI();
loadTournamentList();
checkResetToken();
checkJoinParam();
