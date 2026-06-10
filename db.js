'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT DEFAULT '',
      password TEXT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    );
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    );
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used BOOLEAN DEFAULT FALSE
    );
  `);
  console.log('DB ready');
}

// Users
async function getUser(id)           { const r = await pool.query('SELECT * FROM users WHERE id=$1',[id]); return r.rows[0]||null; }
async function getUserByUsername(u)  { const r = await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)',[u]); return r.rows[0]||null; }
async function getUserByEmail(e)     { const r = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1)',[e]); return r.rows[0]||null; }
async function createUser(user)      { await pool.query('INSERT INTO users(id,username,email,password,created_at) VALUES($1,$2,$3,$4,$5)',[user.id,user.username,user.email,user.password,user.createdAt]); }
async function updateUserPassword(id,hash) { await pool.query('UPDATE users SET password=$1 WHERE id=$2',[hash,id]); }

// Tournaments
async function getAllTournaments()   { const r = await pool.query('SELECT data FROM tournaments ORDER BY created_at DESC'); return r.rows.map(x=>x.data); }
async function getTournament(id)    { const r = await pool.query('SELECT data FROM tournaments WHERE id=$1',[id]); return r.rows[0]?.data||null; }
async function saveTournament(t)    { await pool.query('INSERT INTO tournaments(id,data,created_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=$2',[t.id,t,t.createdAt]); }
async function deleteTournament(id) { await pool.query('DELETE FROM tournaments WHERE id=$1',[id]); }

// Reset tokens
async function saveResetToken(userId, token, expiresAt) {
  await pool.query('INSERT INTO reset_tokens(token,user_id,expires_at) VALUES($1,$2,$3) ON CONFLICT(token) DO UPDATE SET expires_at=$3,used=FALSE',[token,userId,expiresAt]);
}
async function getResetToken(token) {
  const r = await pool.query('SELECT * FROM reset_tokens WHERE token=$1 AND used=FALSE AND expires_at>$2',[token,Date.now()]);
  return r.rows[0]||null;
}
async function markResetTokenUsed(token) {
  await pool.query('UPDATE reset_tokens SET used=TRUE WHERE token=$1',[token]);
}

module.exports = { init, getUser, getUserByUsername, getUserByEmail, createUser, updateUserPassword, getAllTournaments, getTournament, saveTournament, deleteTournament, saveResetToken, getResetToken, markResetTokenUsed };
