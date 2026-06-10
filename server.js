'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { swissPairings, buildSingleElimBracket, calcStandings, MATCH_MODES } = require('./engine');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pockettcg-secret-change-in-prod';
const DATA = path.join(__dirname, 'data');

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ──────────────────────────────────────────────────────────────
const db = {
  read:  (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return []; } },
  write: (f, d) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(d, null, 2)),
};

// ── Auth middleware ───────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};
const authOpt = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  try { if (t) req.user = jwt.verify(t, JWT_SECRET); } catch {}
  next();
};

// ══════════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Username and password required' });
  const users = db.read('users.json');
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already taken' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username: username.trim(), email: email || '', password: hash, createdAt: Date.now() };
  users.push(user);
  db.write('users.json', users);
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, id: user.id, username: user.username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = db.read('users.json');
  const user = users.find(u => u.username.toLowerCase() === username?.toLowerCase());
  if (!user || !await bcrypt.compare(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, id: user.id, username: user.username });
});

// ══════════════════════════════════════════════════════════════════════════════
// TOURNAMENTS
// ══════════════════════════════════════════════════════════════════════════════
function toSummary(t) {
  return {
    id: t.id, name: t.name, status: t.status,
    phases: t.phases?.map(p => ({ name: p.name, type: p.type, matchMode: p.matchMode })),
    playerCount: (t.registrations||[]).filter(r=>!r.waitlist).length,
    maxPlayers: t.maxPlayers, organizer: t.organizerName, organizerId: t.organizerId,
    createdAt: t.createdAt, isPublic: t.isPublic, prizePool: t.prizePool,
    minDecks: t.minDecks, maxDecks: t.maxDecks, currentPhase: t.currentPhase,
    currentRound: t.currentRound, description: t.description, discord: t.discord,
  };
}

app.get('/api/tournaments', authOpt, (req, res) => {
  const ts = db.read('tournaments.json');
  const { status, search } = req.query;
  let list = ts.filter(t => t.isPublic !== false || (req.user && t.organizerId === req.user.id));
  if (status) list = list.filter(t => t.status === status);
  if (search) list = list.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  res.json(list.map(toSummary).sort((a,b) => b.createdAt - a.createdAt));
});

app.get('/api/tournaments/:id', authOpt, (req, res) => {
  const ts = db.read('tournaments.json');
  const t = ts.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

app.post('/api/tournaments', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const { name, description, prizePool, isPublic, discord, maxPlayers,
          checkinRequired, allowLateReg, minDecks, maxDecks, deckVisibility,
          deckRules, entryType, entryCodes, inviteList, phases } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (!phases?.length) return res.status(400).json({ error: 'At least one phase required' });
  const t = {
    id: uuidv4(), name: name.trim(), description: description||'', prizePool: prizePool||'',
    isPublic: isPublic !== false, discord: discord||'',
    maxPlayers: maxPlayers||0, checkinRequired: !!checkinRequired, allowLateReg: !!allowLateReg,
    minDecks: minDecks||1, maxDecks: maxDecks||2, deckVisibility: deckVisibility||'open',
    deckRules: deckRules||'', entryType: entryType||'open',
    entryCodes: entryCodes||[], inviteList: inviteList||[],
    phases: phases.map(p => ({
      id: uuidv4(), name: p.name||'', type: p.type||'swiss',
      matchMode: p.matchMode||'Bo3', rounds: p.rounds||5, cutValue: p.cutValue||8,
    })),
    organizerId: req.user.id, organizerName: req.user.username,
    registrations: [], results: [], pairings: [],
    currentPhase: 0, currentRound: 0, status: 'registration', createdAt: Date.now(),
    judges: [], penalties: [], disputes: [],
  };
  ts.push(t);
  db.write('tournaments.json', ts);
  res.json(t);
});

app.patch('/api/tournaments/:id', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  if (ts[idx].organizerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const allowed = ['name','description','prizePool','isPublic','discord','maxPlayers',
                   'checkinRequired','deckVisibility','phases','allowLateReg','deckRules'];
  for (const k of allowed) if (req.body[k] !== undefined) ts[idx][k] = req.body[k];
  db.write('tournaments.json', ts);
  res.json(ts[idx]);
});

app.delete('/api/tournaments/:id', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  if (ts[idx].organizerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  ts.splice(idx,1);
  db.write('tournaments.json', ts);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/tournaments/:id/register', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const t = ts[idx];
  if (!['registration','ongoing'].includes(t.status)) return res.status(400).json({ error: 'Registration is closed' });
  if (t.registrations.find(r => r.userId === req.user.id)) return res.status(409).json({ error: 'Already registered' });
  const { decks, entryCode } = req.body;
  if (t.entryType === 'code' && !t.entryCodes.includes(entryCode))
    return res.status(403).json({ error: 'Invalid entry code' });
  if (t.entryType === 'invite' && !t.inviteList.map(x=>x.toLowerCase()).includes(req.user.username.toLowerCase()))
    return res.status(403).json({ error: 'Not on invite list' });
  if (!decks || decks.length < t.minDecks || decks.length > t.maxDecks)
    return res.status(400).json({ error: `Submit between ${t.minDecks} and ${t.maxDecks} deck(s)` });
  const waitlist = t.maxPlayers > 0 && t.registrations.filter(r=>!r.waitlist).length >= t.maxPlayers;
  t.registrations.push({
    userId: req.user.id, username: req.user.username, decks,
    waitlist, registeredAt: Date.now(), checkedIn: !t.checkinRequired, dropped: false,
    lateJoined: t.status==='ongoing',
    missedRounds: t.status==='ongoing' ? Array.from({length:t.currentRound},(_,i)=>i+1) : []
  });
  db.write('tournaments.json', ts);
  res.json({ ok: true, waitlist });
});

app.delete('/api/tournaments/:id/register', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const rIdx = ts[idx].registrations.findIndex(r => r.userId === req.user.id);
  if (rIdx===-1) return res.status(404).json({ error: 'Not registered' });
  if (ts[idx].status==='ongoing') ts[idx].registrations[rIdx].dropped = true;
  else ts[idx].registrations.splice(rIdx,1);
  db.write('tournaments.json', ts);
  res.json({ ok: true });
});

app.get('/api/tournaments/:id/my-registration', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const t = ts.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t.registrations.find(r => r.userId === req.user.id) || null);
});

app.get('/api/tournaments/:id/registrations', authOpt, (req, res) => {
  const ts = db.read('tournaments.json');
  const t = ts.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const isJudge = req.user && (t.organizerId === req.user.id || (t.judges||[]).includes(req.user.id));
  res.json(t.registrations.map(r => ({
    userId: r.userId, username: r.username,
    decks: r.decks.map(d => ({ name: d.name, list: (isJudge || t.deckVisibility==='open') ? d.list : undefined })),
    waitlist: r.waitlist, dropped: r.dropped, checkedIn: r.checkedIn, registeredAt: r.registeredAt,
  })));
});

app.post('/api/tournaments/:id/checkin', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const rIdx = ts[idx].registrations.findIndex(r => r.userId === req.user.id);
  if (rIdx===-1) return res.status(404).json({ error: 'Not registered' });
  ts[idx].registrations[rIdx].checkedIn = true;
  db.write('tournaments.json', ts);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// TOURNAMENT FLOW
// ══════════════════════════════════════════════════════════════════════════════
function isJudgeOrOrg(t, userId) {
  return t.organizerId === userId || (t.judges||[]).includes(userId);
}

app.post('/api/tournaments/:id/start', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const t = ts[idx];
  if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  if (t.status !== 'registration') return res.status(400).json({ error: 'Already started' });
  if (t.checkinRequired) t.registrations = t.registrations.filter(r => r.checkedIn || r.waitlist);
  // promote waitlist
  if (t.maxPlayers > 0) {
    let slots = t.maxPlayers - t.registrations.filter(r=>!r.waitlist).length;
    for (const r of t.registrations) if (r.waitlist && slots > 0) { r.waitlist=false; slots--; }
  }
  const active = t.registrations.filter(r=>!r.waitlist&&!r.dropped);
  if (active.length < 2) return res.status(400).json({ error: 'Need at least 2 players' });
  t.status = 'ongoing'; t.currentPhase = 0; t.currentRound = 1; t.startedAt = Date.now();
  const matches = swissPairings(active, [], 1);
  t.pairings.push({ phaseIdx:0, round:1, matches, startedAt:Date.now() });
  db.write('tournaments.json', ts);
  res.json(t);
});

app.post('/api/tournaments/:id/next-round', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const t = ts[idx];
  if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  if (t.status !== 'ongoing') return res.status(400).json({ error: 'Not ongoing' });
  const curPairing = t.pairings.find(p => p.phaseIdx===t.currentPhase && p.round===t.currentRound);
  const pending = curPairing?.matches.filter(m => m.p2 && !m.result) || [];
  if (pending.length > 0) return res.status(400).json({ error: `${pending.length} match(es) still pending` });
  const phase = t.phases[t.currentPhase];
  const phaseResults = t.results.filter(r => r.phaseIdx===t.currentPhase);
  // Check if phase ends
  const isLastRound = t.currentRound >= phase.rounds;
  const isElim = phase.type==='single_elim'||phase.type==='double_elim';
  if (isLastRound || isElim) {
    const nextIdx = t.currentPhase + 1;
    if (nextIdx >= t.phases.length) {
      t.status = 'completed'; t.completedAt = Date.now();
      db.write('tournaments.json', ts);
      return res.json({ status:'completed', tournament:t });
    }
    // Advance to next phase
    const standings = calcStandings(t.registrations.filter(r=>!r.waitlist), phaseResults);
    const nextPhase = t.phases[nextIdx];
    const advancers = standings.slice(0, nextPhase.cutValue||8);
    t.currentPhase = nextIdx; t.currentRound = 1;
    const advReg = advancers.map(a => t.registrations.find(r=>r.userId===a.userId)).filter(Boolean);
    const newMatches = nextPhase.type==='single_elim'||nextPhase.type==='double_elim'
      ? buildSingleElimBracket(advReg, 1)
      : swissPairings(advReg, [], 1);
    t.pairings.push({ phaseIdx:nextIdx, round:1, matches:newMatches, startedAt:Date.now() });
    db.write('tournaments.json', ts);
    return res.json({ phaseAdvanced:true, newPhase:nextPhase.name||`Phase ${nextIdx+1}`, tournament:t });
  }
  t.currentRound++;
  const active = t.registrations.filter(r=>!r.waitlist&&!r.dropped);
  const newMatches = swissPairings(active, phaseResults, t.currentRound);
  t.pairings.push({ phaseIdx:t.currentPhase, round:t.currentRound, matches:newMatches, startedAt:Date.now() });
  db.write('tournaments.json', ts);
  res.json({ tournament:t });
});

// ══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/tournaments/:id/result', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const t = ts[idx];
  const { matchId, winner, scoreWinner, scoreLoser, isTie } = req.body;
  const pairing = t.pairings.find(p => p.phaseIdx===t.currentPhase && p.round===t.currentRound);
  const match = pairing?.matches.find(m => m.id===matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  const isAuth = isJudgeOrOrg(t,req.user.id) || match.p1===req.user.id || match.p2===req.user.id;
  if (!isAuth) return res.status(403).json({ error: 'Forbidden' });
  if (match.result) return res.status(400).json({ error: 'Result already submitted' });
  if (isTie) {
    match.result = 'tie';
  } else {
    match.result = 'win'; match.winner = winner;
    match.loser = match.p1===winner ? match.p2 : match.p1;
    match.scoreWinner = scoreWinner||0; match.scoreLoser = scoreLoser||0;
  }
  match.reportedBy = req.user.id; match.reportedAt = Date.now();
  t.results.push({ id:uuidv4(), matchId, phaseIdx:t.currentPhase, round:t.currentRound,
    p1:match.p1, p2:match.p2, winner:match.winner, loser:match.loser,
    result:match.result, scoreWinner:match.scoreWinner, scoreLoser:match.scoreLoser });
  db.write('tournaments.json', ts);
  res.json({ ok: true });
});

// Edit result (judge/org only)
app.patch('/api/tournaments/:id/result/:matchId', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const t = ts[idx];
  if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const pairing = t.pairings.find(p => p.phaseIdx===t.currentPhase && p.round===t.currentRound);
  const match = pairing?.matches.find(m => m.id===req.params.matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  const { winner, scoreWinner, scoreLoser, isTie } = req.body;
  if (isTie) { match.result='tie'; match.winner=null; match.loser=null; }
  else {
    match.result='win'; match.winner=winner; match.loser=match.p1===winner?match.p2:match.p1;
    match.scoreWinner=scoreWinner; match.scoreLoser=scoreLoser;
  }
  match.editedBy=req.user.id; match.editedAt=Date.now();
  const rIdx = t.results.findIndex(r=>r.matchId===req.params.matchId);
  if (rIdx!==-1) t.results.splice(rIdx,1);
  t.results.push({ id:uuidv4(), matchId:req.params.matchId, phaseIdx:t.currentPhase,
    round:t.currentRound, p1:match.p1, p2:match.p2, winner:match.winner, loser:match.loser,
    result:match.result, scoreWinner:match.scoreWinner, scoreLoser:match.scoreLoser });
  db.write('tournaments.json', ts);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// JUDGING
// ══════════════════════════════════════════════════════════════════════════════

// Add/remove judge
app.post('/api/tournaments/:id/judges', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  if (ts[idx].organizerId !== req.user.id) return res.status(403).json({ error: 'Only organizer can add judges' });
  const { username } = req.body;
  const users = db.read('users.json');
  const target = users.find(u => u.username.toLowerCase()===username?.toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!ts[idx].judges) ts[idx].judges = [];
  if (!ts[idx].judges.includes(target.id)) ts[idx].judges.push(target.id);
  if (!ts[idx].judgeNames) ts[idx].judgeNames = {};
  ts[idx].judgeNames[target.id] = target.username;
  db.write('tournaments.json', ts);
  res.json({ ok: true, judgeId: target.id, username: target.username });
});

app.delete('/api/tournaments/:id/judges/:judgeId', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  if (ts[idx].organizerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  ts[idx].judges = (ts[idx].judges||[]).filter(j => j !== req.params.judgeId);
  db.write('tournaments.json', ts);
  res.json({ ok: true });
});

// Issue penalty
app.post('/api/tournaments/:id/penalties', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const t = ts[idx];
  if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const { playerId, type, reason, round } = req.body;
  // types: warning | game_loss | match_loss | dq
  const penalty = {
    id: uuidv4(), playerId, type, reason: reason||'',
    round: round||t.currentRound, phaseIdx: t.currentPhase,
    issuedBy: req.user.id, issuedByName: req.user.username,
    issuedAt: Date.now()
  };
  if (!t.penalties) t.penalties = [];
  t.penalties.push(penalty);
  // Apply DQ: drop player
  if (type === 'dq') {
    const rIdx = t.registrations.findIndex(r => r.userId===playerId);
    if (rIdx!==-1) { t.registrations[rIdx].dropped=true; t.registrations[rIdx].dq=true; }
    // Auto-loss for current round match
    const pairing = t.pairings.find(p=>p.phaseIdx===t.currentPhase&&p.round===t.currentRound);
    if (pairing) {
      const match = pairing.matches.find(m=>m.p1===playerId||m.p2===playerId);
      if (match && !match.result && match.p2) {
        const winner = match.p1===playerId ? match.p2 : match.p1;
        match.result='win'; match.winner=winner; match.loser=playerId;
        match.scoreWinner=2; match.scoreLoser=0; match.dqApplied=true;
        t.results.push({ id:uuidv4(), matchId:match.id, phaseIdx:t.currentPhase,
          round:t.currentRound, p1:match.p1, p2:match.p2, winner, loser:playerId,
          result:'win', scoreWinner:2, scoreLoser:0, dqApplied:true });
      }
    }
  }
  // Match loss: auto-loss for current match
  if (type === 'match_loss') {
    const pairing = t.pairings.find(p=>p.phaseIdx===t.currentPhase&&p.round===t.currentRound);
    if (pairing) {
      const match = pairing.matches.find(m=>(m.p1===playerId||m.p2===playerId)&&!m.result&&m.p2);
      if (match) {
        const winner = match.p1===playerId ? match.p2 : match.p1;
        match.result='win'; match.winner=winner; match.loser=playerId;
        match.scoreWinner=2; match.scoreLoser=0; match.penaltyApplied=type;
        t.results.push({ id:uuidv4(), matchId:match.id, phaseIdx:t.currentPhase,
          round:t.currentRound, p1:match.p1, p2:match.p2, winner, loser:playerId,
          result:'win', scoreWinner:2, scoreLoser:0 });
      }
    }
  }
  db.write('tournaments.json', ts);
  res.json({ ok: true, penalty });
});

app.get('/api/tournaments/:id/penalties', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const t = ts.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const reg = t.registrations||[];
  const penalties = (t.penalties||[]).map(p => ({
    ...p,
    playerName: reg.find(r=>r.userId===p.playerId)?.username || '?'
  }));
  res.json(penalties);
});

// Disputes
app.post('/api/tournaments/:id/disputes', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const t = ts[idx];
  const reg = t.registrations.find(r=>r.userId===req.user.id);
  if (!reg) return res.status(403).json({ error: 'Not a participant' });
  const { matchId, description } = req.body;
  const dispute = {
    id: uuidv4(), matchId, description, submittedBy: req.user.id,
    submittedByName: req.user.username, submittedAt: Date.now(),
    status: 'open', resolution: null, resolvedBy: null, resolvedAt: null
  };
  if (!t.disputes) t.disputes = [];
  t.disputes.push(dispute);
  db.write('tournaments.json', ts);
  res.json({ ok: true, dispute });
});

app.get('/api/tournaments/:id/disputes', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const t = ts.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  res.json(t.disputes||[]);
});

app.patch('/api/tournaments/:id/disputes/:disputeId', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  const t = ts[idx];
  if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const dIdx = (t.disputes||[]).findIndex(d=>d.id===req.params.disputeId);
  if (dIdx===-1) return res.status(404).json({ error: 'Dispute not found' });
  const { resolution, status } = req.body;
  t.disputes[dIdx].resolution = resolution||'';
  t.disputes[dIdx].status = status||'resolved';
  t.disputes[dIdx].resolvedBy = req.user.username;
  t.disputes[dIdx].resolvedAt = Date.now();
  db.write('tournaments.json', ts);
  res.json({ ok: true });
});

// Drop player (judge/org)
app.post('/api/tournaments/:id/drop/:userId', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  const idx = ts.findIndex(x => x.id === req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Not found' });
  if (!isJudgeOrOrg(ts[idx], req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const rIdx = ts[idx].registrations.findIndex(r=>r.userId===req.params.userId);
  if (rIdx===-1) return res.status(404).json({ error: 'Player not found' });
  ts[idx].registrations[rIdx].dropped = true;
  db.write('tournaments.json', ts);
  res.json({ ok: true });
});

// Standings & Pairings
app.get('/api/tournaments/:id/standings', (req, res) => {
  const ts = db.read('tournaments.json');
  const t = ts.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const phaseIdx = parseInt(req.query.phase ?? t.currentPhase ?? 0);
  const phaseResults = t.results.filter(r=>r.phaseIdx===phaseIdx);
  res.json(calcStandings(t.registrations.filter(r=>!r.waitlist), phaseResults));
});

app.get('/api/tournaments/:id/pairings', authOpt, (req, res) => {
  const ts = db.read('tournaments.json');
  const t = ts.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json({ currentPhase:t.currentPhase, currentRound:t.currentRound, phases:t.phases, pairings:t.pairings });
});

// My tournaments
app.get('/api/my/tournaments', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  res.json(ts.filter(t=>t.organizerId===req.user.id).map(toSummary));
});
app.get('/api/my/registrations', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  res.json(ts.filter(t=>t.registrations?.find(r=>r.userId===req.user.id)).map(toSummary));
});
app.get('/api/my/judging', auth, (req, res) => {
  const ts = db.read('tournaments.json');
  res.json(ts.filter(t=>(t.judges||[]).includes(req.user.id)).map(toSummary));
});

app.get('/api/match-modes', (req, res) => res.json(MATCH_MODES));

app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`PocketTCG → http://localhost:${PORT}`));
module.exports = app;
