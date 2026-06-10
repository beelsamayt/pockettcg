/**
 * Tournament Engine
 * Handles: Swiss pairings (OWP tiebreaker), Single/Double Elimination brackets,
 * Round Robin, match modes (Bo1/Bo3/Bo5/Conquest/LastHero/BringBanPick/Specialist)
 */

const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────────────────────────────────────
// SWISS PAIRINGS with OWP tiebreaker
// ─────────────────────────────────────────────────────────────────────────────
function swissPairings(registrations, allResults, currentRound) {
  // Build score map
  const scores = {};
  for (const r of registrations) {
    scores[r.userId] = { id: r.userId, username: r.username, wins: 0, losses: 0, ties: 0, points: 0, dropped: r.dropped || false };
  }

  for (const res of allResults) {
    if (res.result === 'bye') { if (scores[res.p1]) { scores[res.p1].wins++; scores[res.p1].points += 3; } continue; }
    if (res.result === 'win' && res.winner) {
      if (scores[res.winner]) { scores[res.winner].wins++; scores[res.winner].points += 3; }
      const loser = res.p1 === res.winner ? res.p2 : res.p1;
      if (scores[loser]) scores[loser].losses++;
    } else if (res.result === 'tie') {
      if (scores[res.p1]) { scores[res.p1].ties++; scores[res.p1].points += 1; }
      if (scores[res.p2]) { scores[res.p2].ties++; scores[res.p2].points += 1; }
    }
  }

  // OWP tiebreaker
  const owp = (playerId) => {
    const opponents = allResults
      .filter(r => r.p1 === playerId || r.p2 === playerId)
      .map(r => r.p1 === playerId ? r.p2 : r.p1)
      .filter(Boolean);
    if (!opponents.length) return 0;
    const owpVals = opponents.map(opp => {
      const s = scores[opp];
      if (!s) return 0;
      const total = s.wins + s.losses + s.ties;
      return total ? Math.max(s.wins / total, 0.25) : 0.25;
    });
    return owpVals.reduce((a, b) => a + b, 0) / owpVals.length;
  };

  const active = Object.values(scores).filter(p => !p.dropped);
  active.sort((a, b) => b.points - a.points || owp(b.id) - owp(a.id) || a.username.localeCompare(b.username));

  // Previous pairings to avoid rematches
  const prevPaired = new Set(allResults.map(r => [r.p1, r.p2].sort().join('|')));

  const paired = new Set();
  const matches = [];

  for (let i = 0; i < active.length; i++) {
    if (paired.has(active[i].id)) continue;
    let found = false;
    for (let j = i + 1; j < active.length; j++) {
      if (paired.has(active[j].id)) continue;
      const key = [active[i].id, active[j].id].sort().join('|');
      if (!prevPaired.has(key)) {
        matches.push({ id: uuidv4(), round: currentRound, p1: active[i].id, p2: active[j].id, p1name: active[i].username, p2name: active[j].username, result: null, games: [] });
        paired.add(active[i].id);
        paired.add(active[j].id);
        found = true;
        break;
      }
    }
    // fallback: rematch if no other option
    if (!found) {
      for (let j = i + 1; j < active.length; j++) {
        if (paired.has(active[j].id)) continue;
        matches.push({ id: uuidv4(), round: currentRound, p1: active[i].id, p2: active[j].id, p1name: active[i].username, p2name: active[j].username, result: null, games: [], rematch: true });
        paired.add(active[i].id);
        paired.add(active[j].id);
        break;
      }
    }
  }

  // Bye for odd player
  const bye = active.find(p => !paired.has(p.id));
  if (bye) matches.push({ id: uuidv4(), round: currentRound, p1: bye.id, p2: null, p1name: bye.username, p2name: null, result: 'bye', games: [] });

  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE ELIMINATION BRACKET
// ─────────────────────────────────────────────────────────────────────────────
function buildSingleElimBracket(seededPlayers, roundNum) {
  // seededPlayers: array sorted by seed (best first)
  // Fill to power of 2, byes at bottom
  const n = seededPlayers.length;
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
  const players = [...seededPlayers];
  while (players.length < size) players.push(null); // null = bye

  // Standard bracket seeding: 1v(n), 2v(n-1) etc
  const matches = [];
  for (let i = 0; i < size / 2; i++) {
    const p1 = players[i];
    const p2 = players[size - 1 - i];
    const match = {
      id: uuidv4(), round: roundNum, bracketPos: i,
      p1: p1?.userId || null, p2: p2?.userId || null,
      p1name: p1?.username || 'BYE', p2name: p2?.username || 'BYE',
      result: null, games: [],
      auto: !p1 || !p2 // auto-resolve if one side is null
    };
    if (match.auto) {
      match.result = 'win';
      match.winner = p1 ? p1.userId : null;
    }
    matches.push(match);
  }
  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOUBLE ELIMINATION
// ─────────────────────────────────────────────────────────────────────────────
function buildDoubleElimBracket(seededPlayers) {
  // Returns initial winners bracket matches; losers bracket generated dynamically
  const wb = buildSingleElimBracket(seededPlayers, 1);
  return { winnersMatches: wb, losersMatches: [], grandFinal: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDINGS calculation
// ─────────────────────────────────────────────────────────────────────────────
function calcStandings(registrations, allResults) {
  const scores = {};
  for (const r of registrations) {
    scores[r.userId] = { userId: r.userId, username: r.username, wins: 0, losses: 0, ties: 0, points: 0, byes: 0, gameWins: 0, gameLosses: 0, dropped: r.dropped || false };
  }

  for (const res of allResults) {
    if (res.result === 'bye') {
      if (scores[res.p1]) { scores[res.p1].wins++; scores[res.p1].points += 3; scores[res.p1].byes++; }
      continue;
    }
    if (res.result === 'win' && res.winner) {
      const loser = res.p1 === res.winner ? res.p2 : res.p1;
      if (scores[res.winner]) {
        scores[res.winner].wins++;
        scores[res.winner].points += 3;
        scores[res.winner].gameWins += res.scoreWinner || 0;
        scores[res.winner].gameLosses += res.scoreLoser || 0;
      }
      if (scores[loser]) {
        scores[loser].losses++;
        scores[loser].gameWins += res.scoreLoser || 0;
        scores[loser].gameLosses += res.scoreWinner || 0;
      }
    } else if (res.result === 'tie') {
      if (scores[res.p1]) { scores[res.p1].ties++; scores[res.p1].points += 1; }
      if (scores[res.p2]) { scores[res.p2].ties++; scores[res.p2].points += 1; }
    }
  }

  // OWP for each player
  const owp = (playerId) => {
    const opps = allResults
      .filter(r => r.result !== 'bye' && (r.p1 === playerId || r.p2 === playerId))
      .map(r => r.p1 === playerId ? r.p2 : r.p1).filter(Boolean);
    if (!opps.length) return 0;
    return opps.map(opp => {
      const s = scores[opp];
      if (!s) return 0.25;
      const total = s.wins + s.losses + s.ties;
      return total ? Math.max(s.wins / total, 0.25) : 0.25;
    }).reduce((a, b) => a + b, 0) / opps.length;
  };

  return Object.values(scores).map(p => ({ ...p, owp: owp(p.userId) }))
    .sort((a, b) => b.points - a.points || b.owp - a.owp || b.gameWins - a.gameWins || a.username.localeCompare(b.username));
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCH MODE helpers
// ─────────────────────────────────────────────────────────────────────────────
const MATCH_MODES = {
  'Bo1':         { gamesNeeded: 1, description: 'Best of 1 — single game decides the match' },
  'Bo3':         { gamesNeeded: 2, description: 'Best of 3 — first to 2 wins' },
  'Bo5':         { gamesNeeded: 3, description: 'Best of 5 — first to 3 wins' },
  '2-Game':      { gamesNeeded: null, description: 'Two games played regardless; ties possible' },
  'Conquest':    { gamesNeeded: null, description: 'Win with each of your decks to advance. First player to win with all N decks wins the match.' },
  'LastHero':    { gamesNeeded: null, description: 'Last Hero Standing — winner keeps their deck, loser swaps.' },
  'BringBanPick':{ gamesNeeded: null, description: 'Bring 2 decks, ban 1 opponent deck, pick from remaining for each game. Bo3.' },
  'Specialist':  { gamesNeeded: 2,   description: 'Specialist — one deck locked in for all 3 games. Bo3.' },
};

function getWinsNeeded(matchMode) {
  return MATCH_MODES[matchMode]?.gamesNeeded || 2;
}

module.exports = { swissPairings, buildSingleElimBracket, buildDoubleElimBracket, calcStandings, MATCH_MODES, getWinsNeeded };
