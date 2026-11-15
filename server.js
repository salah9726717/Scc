'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Pool, types } = require('pg');
types.setTypeParser(20, (v) => Number(v)); // bigint -> number

const { BOT_TOKEN, DATABASE_URL, PUBLIC_URL, WEBHOOK_SECRET = 'sophia-hook', ADMIN_ID } = process.env;
if (!BOT_TOKEN || !DATABASE_URL) { console.error('Missing BOT_TOKEN or DATABASE_URL'); process.exit(1); }

const CFG = { TASK_CENTS: 150, DAILY_CENTS: 100, REFERRAL_CENTS: 200, MIN_WITHDRAW_CENTS: 20000, FEE_CENTS: 700, REQUIRED_REFERRALS: 10, VERIFY_SECONDS: 10 };
const TASK_LINKS = [
  'https://t.me/oppalsa', 'https://t.me/whosmake', 'https://t.me/greeeensmile', 'https://t.me/QwillOfficial',
  'https://t.me/RED_POLITIC_Chanel', 'https://t.me/ROLPA_OFFICIAL', 'https://t.me/y2yebi', 'https://t.me/m20movia',
  'https://t.me/walwalbitgiio', 'https://t.me/kckscb', 'https://t.me/ZAAFIFILMS', 'https://t.me/Zmovies12',
  'https://t.me/alibaba4677', 'https://t.me/rajuubateel12', 'https://t.me/viner252', 'https://t.me/CRAZYHOSTINGER',
  'https://t.me/safari52628', 'https://t.me/vance3686', 'https://t.me/Mabda_abooks', 'https://t.me/altamino577',
  'https://t.me/yorin7u8', 'https://t.me/discord588', 'https://t.me/coding6788', 'https://t.me/m454888',
  'https://t.me/hacker373838', 'https://t.me/OctolCommunity', 'https://t.me/ourecocommunity', 'https://t.me/OctolHub',
  'https://t.me/yowpros', 'https://t.me/hipurplr'
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const INITDATA_MAX_AGE = Number(process.env.INITDATA_MAX_AGE || 86400);

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 10 });
const fail = (status, message) => Object.assign(new Error(message), { status });
const h = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Server is busy. Please try again.' });
});
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}
async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json();
}

// ---------- Telegram initData verification ----------
function verifyInitData(initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const data = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(data).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const age = Math.floor(Date.now() / 1000) - Number(p.get('auth_date') || 0);
  if (!(age >= -60 && age <= INITDATA_MAX_AGE)) return null;
  try { const u = JSON.parse(p.get('user')); return u && u.id ? u : null; } catch { return null; }
}
const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();
async function auth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const u = verifyInitData(header.startsWith('tma ') ? header.slice(4) : '');
    if (!u) return res.status(401).json({ error: 'Session expired. Please close and reopen the app from Telegram.' });
    const n = (hits.get(u.id) || 0) + 1; hits.set(u.id, n);
    if (n > 120) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    await pool.query(
      `insert into users(telegram_id, first_name, last_name, username, photo_url) values($1,$2,$3,$4,$5)
       on conflict (telegram_id) do update set first_name=excluded.first_name, last_name=excluded.last_name,
       username=excluded.username, photo_url=coalesce(excluded.photo_url, users.photo_url)`,
      [u.id, u.first_name || null, u.last_name || null, u.username || null, u.photo_url || null]);
    req.tg = u; next();
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server is busy. Please try again.' }); }
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.get('/health', (_, res) => res.json({ ok: true }));

async function buildState(c, u) {
  const id = u.id;
  const me = (await c.query('select * from users where telegram_id=$1', [id])).rows[0];
  const prog = (await c.query('select task_id, verified_at, claimed_at from task_progress where telegram_id=$1', [id])).rows;
  const taskStates = {};
  prog.forEach((r) => { if (r.claimed_at) taskStates[r.task_id] = 'claimed'; else if (r.verified_at) taskStates[r.task_id] = 'ready'; });
  const dailyRows = (await c.query(
    `select extract(dow from claim_date)::int as dow from daily_claims where telegram_id=$1
     and claim_date >= ((now() at time zone 'utc')::date - extract(dow from (now() at time zone 'utc'))::int)`, [id])).rows;
  const days = dailyRows.map((r) => DAY_NAMES[r.dow]);
  const ref = (await c.query(
    `select count(*)::int as invited, count(*) filter (where referral_completed)::int as successful from users where referred_by=$1`, [id])).rows[0];
  return {
    user: { id, first_name: me.first_name, last_name: me.last_name, username: me.username, photo_url: me.photo_url },
    balance: me.balance_cents / 100,
    config: { taskReward: CFG.TASK_CENTS / 100, dailyReward: CFG.DAILY_CENTS / 100, referralReward: CFG.REFERRAL_CENTS / 100,
      minWithdraw: CFG.MIN_WITHDRAW_CENTS / 100, withdrawFee: CFG.FEE_CENTS / 100, requiredReferrals: CFG.REQUIRED_REFERRALS, verifySeconds: CFG.VERIFY_SECONDS },
    tasks: TASK_LINKS.map((url, i) => ({ id: i, url })),
    taskStates,
    daily: { days, collectedToday: days.includes(DAY_NAMES[new Date().getUTCDay()]) },
    referrals: { invited: ref.invited, successful: ref.successful }
  };
}
app.get('/api/me', auth, h(async (req, res) => res.json(await buildState(pool, req.tg))));

function taskId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 0 || id >= TASK_LINKS.length) throw fail(400, 'Unknown task.');
  return id;
}
async function isMember(url, userId) {
  const chat = '@' + url.split('t.me/')[1].split(/[/?]/)[0];
  const j = await tg('getChatMember', { chat_id: chat, user_id: userId });
  if (!j.ok) { console.error('getChatMember failed', chat, j.description); throw fail(503, 'Verification is temporarily unavailable. Please try again later.'); }
  const s = j.result.status;
  return s === 'creator' || s === 'administrator' || s === 'member' || (s === 'restricted' && j.result.is_member);
}
app.post('/api/tasks/:id/start', auth, h(async (req, res) => {
  const id = taskId(req);
  await pool.query(
    `insert into task_progress(telegram_id, task_id, started_at) values($1,$2,now())
     on conflict (telegram_id, task_id) do update set started_at=now() where task_progress.verified_at is null`, [req.tg.id, id]);
  res.json({ ok: true });
}));
app.post('/api/tasks/:id/verify', auth, h(async (req, res) => {
  const id = taskId(req);
  const r = (await pool.query('select started_at, verified_at, claimed_at from task_progress where telegram_id=$1 and task_id=$2', [req.tg.id, id])).rows[0];
  if (!r) throw fail(400, 'Press Go first.');
  if (r.verified_at || r.claimed_at) return res.json({ ok: true });
  if (Date.now() - new Date(r.started_at).getTime() < CFG.VERIFY_SECONDS * 1000 - 300) throw fail(425, `Please wait ${CFG.VERIFY_SECONDS} seconds for verification.`);
  if (!(await isMember(TASK_LINKS[id], req.tg.id))) throw fail(403, 'Join the channel first, then try again.');
  await pool.query('update task_progress set verified_at=now() where telegram_id=$1 and task_id=$2 and verified_at is null', [req.tg.id, id]);
  res.json({ ok: true });
}));
app.post('/api/tasks/:id/claim', auth, h(async (req, res) => {
  const id = taskId(req), uid = req.tg.id;
  const balance = await tx(async (c) => {
    const r = (await c.query('select verified_at, claimed_at from task_progress where telegram_id=$1 and task_id=$2 for update', [uid, id])).rows[0];
    if (!r || !r.verified_at) throw fail(400, 'Verify the task first.');
    if (r.claimed_at) throw fail(409, 'Already claimed.');
    await c.query('update task_progress set claimed_at=now() where telegram_id=$1 and task_id=$2', [uid, id]);
    const b = (await c.query('update users set balance_cents=balance_cents+$2 where telegram_id=$1 returning balance_cents', [uid, CFG.TASK_CENTS])).rows[0];
    const n = (await c.query('select count(*)::int as n from task_progress where telegram_id=$1 and claimed_at is not null', [uid])).rows[0].n;
    if (n >= TASK_LINKS.length) { // all tasks done -> referral becomes successful
      const me = (await c.query('select referred_by, referral_completed from users where telegram_id=$1', [uid])).rows[0];
      if (me.referred_by && !me.referral_completed) {
        await c.query('update users set referral_completed=true where telegram_id=$1', [uid]);
        await c.query('update users set balance_cents=balance_cents+$2 where telegram_id=$1', [me.referred_by, CFG.REFERRAL_CENTS]);
      }
    }
    return b.balance_cents;
  });
  res.json({ ok: true, balance: balance / 100 });
}));
app.post('/api/daily/collect', auth, h(async (req, res) => {
  const uid = req.tg.id;
  const balance = await tx(async (c) => {
    const ins = await c.query(`insert into daily_claims(telegram_id, claim_date) values($1,(now() at time zone 'utc')::date) on conflict do nothing`, [uid]);
    if (!ins.rowCount) throw fail(409, "You already collected today's reward.");
    return (await c.query('update users set balance_cents=balance_cents+$2 where telegram_id=$1 returning balance_cents', [uid, CFG.DAILY_CENTS])).rows[0].balance_cents;
  });
  const s = await buildState(pool, req.tg);
  res.json({ ok: true, balance: balance / 100, daily: s.daily });
}));
app.post('/api/withdraw', auth, h(async (req, res) => {
  const uid = req.tg.id;
  const address = String(req.body.address || '').trim();
  const amount = Number(req.body.amount);
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw fail(400, 'Enter a valid BEP20 address.');
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, 'Enter a valid amount.');
  const cents = Math.round(amount * 100);
  if (cents < CFG.MIN_WITHDRAW_CENTS) throw fail(400, `Minimum withdraw is $${CFG.MIN_WITHDRAW_CENTS / 100}.`);
  const out = await tx(async (c) => {
    const u = (await c.query('select balance_cents from users where telegram_id=$1 for update', [uid])).rows[0];
    const done = (await c.query('select count(*)::int as n from task_progress where telegram_id=$1 and claimed_at is not null', [uid])).rows[0].n;
    const refs = (await c.query('select count(*)::int as n from users where referred_by=$1 and referral_completed', [uid])).rows[0].n;
    if (refs < CFG.REQUIRED_REFERRALS || done < TASK_LINKS.length) throw fail(400, 'Complete all withdraw rules first.');
    if (cents > u.balance_cents) throw fail(400, 'Amount is higher than your balance.');
    const nb = (await c.query('update users set balance_cents=balance_cents-$2 where telegram_id=$1 returning balance_cents', [uid, cents])).rows[0].balance_cents;
    const w = (await c.query('insert into withdrawals(telegram_id,address,amount_cents,fee_cents) values($1,$2,$3,$4) returning id', [uid, address, cents, CFG.FEE_CENTS])).rows[0];
    return { balance: nb, id: w.id };
  });
  if (ADMIN_ID) tg('sendMessage', { chat_id: ADMIN_ID, text: `New withdrawal #${out.id}\nUser: ${uid} (@${req.tg.username || '-'})\nAmount: $${cents / 100}\nFee: $${CFG.FEE_CENTS / 100}\nSend: $${(cents - CFG.FEE_CENTS) / 100} USDT BEP20\n${address}` }).catch(() => {});
  res.json({ ok: true, balance: out.balance / 100 });
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- Bot (webhook): /start <referrer_id> ----------
app.post(`/bot/${WEBHOOK_SECRET}`, (req, res) => { res.sendStatus(200); handleUpdate(req.body).catch(console.error); });
async function handleUpdate(update) {
  const m = update && update.message;
  if (!m || !m.text || !m.from || m.from.is_bot || !m.text.startsWith('/start')) return;
  const f = m.from;
  const refRaw = Number((m.text.split(/\s+/)[1] || '').trim());
  const ref = Number.isSafeInteger(refRaw) && refRaw > 0 && refRaw !== f.id ? refRaw : null;
  // referred_by is only set when the user is brand new (genuine first start) and the referrer exists
  await pool.query(
    `insert into users(telegram_id, first_name, last_name, username, referred_by)
     values($1::bigint,$2,$3,$4,(select telegram_id from users where telegram_id=$5::bigint))
     on conflict (telegram_id) do update set first_name=excluded.first_name, last_name=excluded.last_name, username=excluded.username`,
    [f.id, f.first_name || null, f.last_name || null, f.username || null, ref]);
  if (PUBLIC_URL) await tg('sendMessage', {
    chat_id: m.chat.id, text: 'Welcome to Sophia Company! Complete tasks, invite friends and earn rewards.',
    reply_markup: { inline_keyboard: [[{ text: 'Open Sophia Company', web_app: { url: PUBLIC_URL } }]] }
  });
}

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Sophia Company running on', port));
  if (PUBLIC_URL) {
    console.log('setWebhook', JSON.stringify(await tg('setWebhook', { url: `${PUBLIC_URL}/bot/${WEBHOOK_SECRET}`, allowed_updates: ['message'] })));
    await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open', web_app: { url: PUBLIC_URL } } });
  }
})().catch((e) => { console.error('Startup failed', e); process.exit(1); });
