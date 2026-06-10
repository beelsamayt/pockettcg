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
  `);
  console.log('DB ready');
}

// Users
async function getUser(id)           { const r = await pool.query('SELECT * FROM users WHERE id=$1',[id]); return r.rows[0]||null; }
async function getUserByUsername(u)  { const r = await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)',[u]); return r.rows[0]||null; }
async function createUser(user)      { await pool.query('INSERT INTO users(id,username,email,password,created_at) VALUES($1,$2,$3,$4,$5)',[user.id,user.username,user.email,user.password,user.createdAt]); }
async function updateUser(id,fields) { const sets=[]; const vals=[]; let i=1; for(const[k,v] of Object.entries(fields)){sets.push(`${k}=$${i++}`);vals.push(v);} vals.push(id); await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`,vals); }

// Tournaments — stored as JSONB
async function getAllTournaments()   { const r = await pool.query('SELECT data FROM tournaments ORDER BY created_at DESC'); return r.rows.map(x=>x.data); }
async function getTournament(id)    { const r = await pool.query('SELECT data FROM tournaments WHERE id=$1',[id]); return r.rows[0]?.data||null; }
async function saveTournament(t)    { await pool.query('INSERT INTO tournaments(id,data,created_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=$2',[t.id,t,t.createdAt]); }
async function deleteTournament(id) { await pool.query('DELETE FROM tournaments WHERE id=$1',[id]); }

module.exports = { init, getUser, getUserByUsername, createUser, updateUser, getAllTournaments, getTournament, saveTournament, deleteTournament };
