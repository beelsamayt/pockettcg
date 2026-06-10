'use strict';
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const db = require('./db');
const { swissPairings, buildSingleElimBracket, calcStandings, MATCH_MODES } = require('./engine');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pockettcg-secret-change-in-prod';

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  try {
    const { username, password, email } = req.body;
    if (!username?.trim() || !password) return res.status(400).json({ error: 'Username and password required' });
    const existing = await db.getUserByUsername(username.trim());
    if (existing) return res.status(409).json({ error: 'Username already taken' });
    const hash = await bcrypt.hash(password, 10);
    const user = { id: uuidv4(), username: username.trim(), email: email||'', password: hash, createdAt: Date.now() };
    await db.createUser(user);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, id: user.id, username: user.username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.getUserByUsername(username||'');
    if (!user || !await bcrypt.compare(password, user.password))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, id: user.id, username: user.username });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

app.get('/api/tournaments', authOpt, async (req, res) => {
  try {
    const all = await db.getAllTournaments();
    const { status, search } = req.query;
    let list = all.filter(t => t.isPublic !== false || (req.user && t.organizerId === req.user.id));
    if (status) list = list.filter(t => t.status === status);
    if (search) list = list.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
    res.json(list.map(toSummary).sort((a,b) => b.createdAt - a.createdAt));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tournaments/:id', authOpt, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tournaments', auth, async (req, res) => {
  try {
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
      phases: phases.map(p => ({ id: uuidv4(), name: p.name||'', type: p.type||'swiss',
        matchMode: p.matchMode||'Bo3', rounds: p.rounds||5, cutValue: p.cutValue||8 })),
      organizerId: req.user.id, organizerName: req.user.username,
      registrations: [], results: [], pairings: [],
      currentPhase: 0, currentRound: 0, status: 'registration', createdAt: Date.now(),
      judges: [], judgeNames: {}, penalties: [], disputes: [],
    };
    await db.saveTournament(t);
    res.json(t);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/tournaments/:id', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.organizerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const allowed = ['name','description','prizePool','isPublic','discord','maxPlayers','checkinRequired','deckVisibility','phases','allowLateReg','deckRules'];
    for (const k of allowed) if (req.body[k] !== undefined) t[k] = req.body[k];
    await db.saveTournament(t);
    res.json(t);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tournaments/:id', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.organizerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await db.deleteTournament(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/tournaments/:id/register', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!['registration','ongoing'].includes(t.status)) return res.status(400).json({ error: 'Registration is closed' });
    if (t.registrations.find(r => r.userId === req.user.id)) return res.status(409).json({ error: 'Already registered' });
    const { decks, entryCode } = req.body;
    if (t.entryType === 'code' && !t.entryCodes.includes(entryCode)) return res.status(403).json({ error: 'Invalid entry code' });
    if (t.entryType === 'invite' && !t.inviteList.map(x=>x.toLowerCase()).includes(req.user.username.toLowerCase())) return res.status(403).json({ error: 'Not on invite list' });
    if (!decks || decks.length < t.minDecks || decks.length > t.maxDecks) return res.status(400).json({ error: `Submit between ${t.minDecks} and ${t.maxDecks} deck(s)` });
    const waitlist = t.maxPlayers > 0 && t.registrations.filter(r=>!r.waitlist).length >= t.maxPlayers;
    t.registrations.push({
      userId: req.user.id, username: req.user.username, decks, waitlist,
      registeredAt: Date.now(), checkedIn: !t.checkinRequired, dropped: false,
      lateJoined: t.status==='ongoing',
      missedRounds: t.status==='ongoing' ? Array.from({length:t.currentRound},(_,i)=>i+1) : []
    });
    await db.saveTournament(t);
    res.json({ ok: true, waitlist });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tournaments/:id/register', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const rIdx = t.registrations.findIndex(r => r.userId === req.user.id);
    if (rIdx===-1) return res.status(404).json({ error: 'Not registered' });
    if (t.status==='ongoing') t.registrations[rIdx].dropped = true;
    else t.registrations.splice(rIdx,1);
    await db.saveTournament(t);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tournaments/:id/my-registration', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t.registrations.find(r => r.userId === req.user.id) || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tournaments/:id/registrations', authOpt, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const isJudge = req.user && (t.organizerId===req.user.id || (t.judges||[]).includes(req.user.id));
    res.json(t.registrations.map(r => ({
      userId: r.userId, username: r.username,
      decks: r.decks.map(d => ({ name: d.name, list: (isJudge || t.deckVisibility==='open') ? d.list : undefined })),
      waitlist: r.waitlist, dropped: r.dropped, checkedIn: r.checkedIn, registeredAt: r.registeredAt,
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tournaments/:id/checkin', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const rIdx = t.registrations.findIndex(r => r.userId === req.user.id);
    if (rIdx===-1) return res.status(404).json({ error: 'Not registered' });
    t.registrations[rIdx].checkedIn = true;
    await db.saveTournament(t);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TOURNAMENT FLOW
// ══════════════════════════════════════════════════════════════════════════════
function isJudgeOrOrg(t, userId) {
  return t.organizerId === userId || (t.judges||[]).includes(userId);
}

app.post('/api/tournaments/:id/start', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    if (t.status !== 'registration') return res.status(400).json({ error: 'Already started' });
    if (t.checkinRequired) t.registrations = t.registrations.filter(r => r.checkedIn || r.waitlist);
    if (t.maxPlayers > 0) {
      let slots = t.maxPlayers - t.registrations.filter(r=>!r.waitlist).length;
      for (const r of t.registrations) if (r.waitlist && slots > 0) { r.waitlist=false; slots--; }
    }
    const active = t.registrations.filter(r=>!r.waitlist&&!r.dropped);
    if (active.length < 2) return res.status(400).json({ error: 'Need at least 2 players' });
    t.status = 'ongoing'; t.currentPhase = 0; t.currentRound = 1; t.startedAt = Date.now();
    const matches = swissPairings(active, [], 1);
    t.pairings.push({ phaseIdx:0, round:1, matches, startedAt:Date.now() });
    await db.saveTournament(t);
    res.json(t);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tournaments/:id/next-round', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    if (t.status !== 'ongoing') return res.status(400).json({ error: 'Not ongoing' });
    const curPairing = t.pairings.find(p => p.phaseIdx===t.currentPhase && p.round===t.currentRound);
    const pending = curPairing?.matches.filter(m => m.p2 && !m.result) || [];
    if (pending.length > 0) return res.status(400).json({ error: `${pending.length} match(es) still pending` });
    const phase = t.phases[t.currentPhase];
    const phaseResults = t.results.filter(r => r.phaseIdx===t.currentPhase);
    const isLastRound = t.currentRound >= phase.rounds;
    const isElim = phase.type==='single_elim'||phase.type==='double_elim';
    if (isLastRound || isElim) {
      const nextIdx = t.currentPhase + 1;
      if (nextIdx >= t.phases.length) {
        t.status = 'completed'; t.completedAt = Date.now();
        await db.saveTournament(t);
        return res.json({ status:'completed', tournament:t });
      }
      const standings = calcStandings(t.registrations.filter(r=>!r.waitlist), phaseResults);
      const nextPhase = t.phases[nextIdx];
      const advancers = standings.slice(0, nextPhase.cutValue||8);
      t.currentPhase = nextIdx; t.currentRound = 1;
      const advReg = advancers.map(a => t.registrations.find(r=>r.userId===a.userId)).filter(Boolean);
      const newMatches = nextPhase.type==='single_elim'||nextPhase.type==='double_elim'
        ? buildSingleElimBracket(advReg, 1)
        : swissPairings(advReg, [], 1);
      t.pairings.push({ phaseIdx:nextIdx, round:1, matches:newMatches, startedAt:Date.now() });
      await db.saveTournament(t);
      return res.json({ phaseAdvanced:true, newPhase:nextPhase.name||`Phase ${nextIdx+1}`, tournament:t });
    }
    t.currentRound++;
    const active = t.registrations.filter(r=>!r.waitlist&&!r.dropped);
    const newMatches = swissPairings(active, phaseResults, t.currentRound);
    t.pairings.push({ phaseIdx:t.currentPhase, round:t.currentRound, matches:newMatches, startedAt:Date.now() });
    await db.saveTournament(t);
    res.json({ tournament:t });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/tournaments/:id/result', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const { matchId, winner, scoreWinner, scoreLoser, isTie } = req.body;
    const pairing = t.pairings.find(p => p.phaseIdx===t.currentPhase && p.round===t.currentRound);
    const match = pairing?.matches.find(m => m.id===matchId);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const isAuth = isJudgeOrOrg(t,req.user.id) || match.p1===req.user.id || match.p2===req.user.id;
    if (!isAuth) return res.status(403).json({ error: 'Forbidden' });
    if (match.result) return res.status(400).json({ error: 'Result already submitted' });
    if (isTie) { match.result='tie'; }
    else {
      match.result='win'; match.winner=winner;
      match.loser=match.p1===winner?match.p2:match.p1;
      match.scoreWinner=scoreWinner||0; match.scoreLoser=scoreLoser||0;
    }
    match.reportedBy=req.user.id; match.reportedAt=Date.now();
    t.results.push({ id:uuidv4(), matchId, phaseIdx:t.currentPhase, round:t.currentRound,
      p1:match.p1, p2:match.p2, winner:match.winner, loser:match.loser,
      result:match.result, scoreWinner:match.scoreWinner, scoreLoser:match.scoreLoser });
    await db.saveTournament(t);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/tournaments/:id/result/:matchId', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const pairing = t.pairings.find(p => p.phaseIdx===t.currentPhase && p.round===t.currentRound);
    const match = pairing?.matches.find(m => m.id===req.params.matchId);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const { winner, scoreWinner, scoreLoser, isTie } = req.body;
    if (isTie) { match.result='tie'; match.winner=null; match.loser=null; }
    else { match.result='win'; match.winner=winner; match.loser=match.p1===winner?match.p2:match.p1; match.scoreWinner=scoreWinner; match.scoreLoser=scoreLoser; }
    match.editedBy=req.user.id; match.editedAt=Date.now();
    const rIdx = t.results.findIndex(r=>r.matchId===req.params.matchId);
    if (rIdx!==-1) t.results.splice(rIdx,1);
    t.results.push({ id:uuidv4(), matchId:req.params.matchId, phaseIdx:t.currentPhase, round:t.currentRound, p1:match.p1, p2:match.p2, winner:match.winner, loser:match.loser, result:match.result, scoreWinner:match.scoreWinner, scoreLoser:match.scoreLoser });
    await db.saveTournament(t);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// JUDGING
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/tournaments/:id/judges', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.organizerId !== req.user.id) return res.status(403).json({ error: 'Only organizer can add judges' });
    const { username } = req.body;
    const target = await db.getUserByUsername(username||'');
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!t.judges) t.judges = [];
    if (!t.judgeNames) t.judgeNames = {};
    if (!t.judges.includes(target.id)) t.judges.push(target.id);
    t.judgeNames[target.id] = target.username;
    await db.saveTournament(t);
    res.json({ ok: true, judgeId: target.id, username: target.username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tournaments/:id/judges/:judgeId', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.organizerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    t.judges = (t.judges||[]).filter(j => j !== req.params.judgeId);
    await db.saveTournament(t);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tournaments/:id/penalties', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const { playerId, type, reason, round } = req.body;
    const penalty = { id:uuidv4(), playerId, type, reason:reason||'', round:round||t.currentRound, phaseIdx:t.currentPhase, issuedBy:req.user.id, issuedByName:req.user.username, issuedAt:Date.now() };
    if (!t.penalties) t.penalties = [];
    t.penalties.push(penalty);
    if (type==='dq') {
      const rIdx = t.registrations.findIndex(r=>r.userId===playerId);
      if (rIdx!==-1) { t.registrations[rIdx].dropped=true; t.registrations[rIdx].dq=true; }
      const pairing = t.pairings.find(p=>p.phaseIdx===t.currentPhase&&p.round===t.currentRound);
      if (pairing) { const match=pairing.matches.find(m=>(m.p1===playerId||m.p2===playerId)&&!m.result&&m.p2); if(match){const winner=match.p1===playerId?match.p2:match.p1;match.result='win';match.winner=winner;match.loser=playerId;match.scoreWinner=2;match.scoreLoser=0;t.results.push({id:uuidv4(),matchId:match.id,phaseIdx:t.currentPhase,round:t.currentRound,p1:match.p1,p2:match.p2,winner,loser:playerId,result:'win',scoreWinner:2,scoreLoser:0});}}
    }
    if (type==='match_loss') {
      const pairing = t.pairings.find(p=>p.phaseIdx===t.currentPhase&&p.round===t.currentRound);
      if (pairing) { const match=pairing.matches.find(m=>(m.p1===playerId||m.p2===playerId)&&!m.result&&m.p2); if(match){const winner=match.p1===playerId?match.p2:match.p1;match.result='win';match.winner=winner;match.loser=playerId;match.scoreWinner=2;match.scoreLoser=0;t.results.push({id:uuidv4(),matchId:match.id,phaseIdx:t.currentPhase,round:t.currentRound,p1:match.p1,p2:match.p2,winner,loser:playerId,result:'win',scoreWinner:2,scoreLoser:0});}}
    }
    await db.saveTournament(t);
    res.json({ ok: true, penalty });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tournaments/:id/penalties', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const reg = t.registrations||[];
    res.json((t.penalties||[]).map(p => ({ ...p, playerName: reg.find(r=>r.userId===p.playerId)?.username||'?' })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tournaments/:id/disputes', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const reg = t.registrations.find(r=>r.userId===req.user.id);
    if (!reg) return res.status(403).json({ error: 'Not a participant' });
    const { matchId, description } = req.body;
    const dispute = { id:uuidv4(), matchId, description, submittedBy:req.user.id, submittedByName:req.user.username, submittedAt:Date.now(), status:'open', resolution:null, resolvedBy:null, resolvedAt:null };
    if (!t.disputes) t.disputes = [];
    t.disputes.push(dispute);
    await db.saveTournament(t);
    res.json({ ok: true, dispute });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tournaments/:id/disputes', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    res.json(t.disputes||[]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/tournaments/:id/disputes/:disputeId', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const dIdx = (t.disputes||[]).findIndex(d=>d.id===req.params.disputeId);
    if (dIdx===-1) return res.status(404).json({ error: 'Dispute not found' });
    t.disputes[dIdx].resolution = req.body.resolution||'';
    t.disputes[dIdx].status = req.body.status||'resolved';
    t.disputes[dIdx].resolvedBy = req.user.username;
    t.disputes[dIdx].resolvedAt = Date.now();
    await db.saveTournament(t);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tournaments/:id/drop/:userId', auth, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!isJudgeOrOrg(t, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const rIdx = t.registrations.findIndex(r=>r.userId===req.params.userId);
    if (rIdx===-1) return res.status(404).json({ error: 'Player not found' });
    t.registrations[rIdx].dropped = true;
    await db.saveTournament(t);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tournaments/:id/standings', async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const phaseIdx = parseInt(req.query.phase ?? t.currentPhase ?? 0);
    const phaseResults = t.results.filter(r=>r.phaseIdx===phaseIdx);
    res.json(calcStandings(t.registrations.filter(r=>!r.waitlist), phaseResults));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tournaments/:id/pairings', authOpt, async (req, res) => {
  try {
    const t = await db.getTournament(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json({ currentPhase:t.currentPhase, currentRound:t.currentRound, phases:t.phases, pairings:t.pairings });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/my/tournaments', auth, async (req, res) => {
  try {
    const all = await db.getAllTournaments();
    res.json(all.filter(t=>t.organizerId===req.user.id).map(toSummary));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/my/registrations', auth, async (req, res) => {
  try {
    const all = await db.getAllTournaments();
    res.json(all.filter(t=>t.registrations?.find(r=>r.userId===req.user.id)).map(toSummary));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/my/judging', auth, async (req, res) => {
  try {
    const all = await db.getAllTournaments();
    res.json(all.filter(t=>(t.judges||[]).includes(req.user.id)).map(toSummary));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/match-modes', (req, res) => res.json(MATCH_MODES));

// ══════════════════════════════════════════════════════════════════════════════
// PASSWORD RESET
// ══════════════════════════════════════════════════════════════════════════════
const { Resend } = require('resend');
const crypto = require('crypto');
const resend = new Resend(process.env.RESEND_API_KEY);

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await db.getUserByEmail(email.trim());
    // Always return ok to avoid email enumeration
    if (!user) return res.json({ ok: true });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    await db.saveResetToken(user.id, token, expiresAt);
    const resetUrl = `${process.env.APP_URL || 'https://pockettcg-production.up.railway.app'}/reset-password?token=${token}`;
    await resend.emails.send({
      from: 'PocketTCG <noreply@resend.dev>',
      to: email.trim(),
      subject: 'Reset your PocketTCG password',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#1a1a2e;color:#e8eaf0;padding:32px;border-radius:12px">
          <h2 style="color:#e94560;margin-bottom:8px">⚡ PocketTCG</h2>
          <h3 style="margin-bottom:16px">Password Reset</h3>
          <p style="color:#9aa5c4;margin-bottom:24px">You requested a password reset for your account <strong style="color:#fff">${user.username}</strong>. Click the button below to set a new password.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#e94560;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
          <p style="color:#6b7a9e;font-size:12px;margin-top:24px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>
      `
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const record = await db.getResetToken(token);
    if (!record) return res.status(400).json({ error: 'Invalid or expired reset link' });
    const hash = await bcrypt.hash(password, 10);
    await db.updateUserPassword(record.user_id, hash);
    await db.markResetTokenUsed(token);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

db.init().then(() => {
  app.listen(PORT, () => console.log(`PocketTCG → http://localhost:${PORT}`));
}).catch(e => { console.error('DB init failed:', e.message); process.exit(1); });

module.exports = app;
