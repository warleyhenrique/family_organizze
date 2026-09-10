import crypto from 'crypto';
import { db } from './db.js';

export const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(value => value.trim().split('=')));
}

export function session(req, res, next) {
  const token = cookies(req).leo;
  if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });

  const row = db.prepare('SELECT u.id,u.name,u.email,u.color FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > CURRENT_TIMESTAMP').get(tokenHash(token));
  if (!row) return res.status(401).json({ error: 'Sessão expirada.' });

  req.user = row;
  next();
}

export function setSession(res, userId) {
  const raw = crypto.randomBytes(32).toString('base64url');
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now','+30 days'))").run(tokenHash(raw), userId);
  res.setHeader('Set-Cookie', `leo=${raw}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
}

export function sessionToken(req) {
  return cookies(req).leo;
}
