import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dns from 'dns/promises';
import fs from 'fs';
import multer from 'multer';
import net from 'net';
import path from 'path';
import { db } from './db.js';
import { here, uploadsDir } from './config.js';
import { session, sessionToken, setSession, tokenHash } from './auth.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, files: 1 });
const clean = value => typeof value === 'string' ? value.trim() : '';
const list = table => (req, res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());

export function registerRoutes(app) {
  app.get('/', (req, res) => res.sendFile(path.join(here, '..', 'index.html')));

  app.get('/api/setup-status', (req, res) => res.json({ ready: !!db.prepare('SELECT id FROM users LIMIT 1').get() }));
  app.post('/api/setup', async (req, res) => {
    if (db.prepare('SELECT id FROM users LIMIT 1').get()) return res.status(409).json({ error: 'A primeira conta já foi criada.' });
    const { name, email, password } = req.body;
    if (!clean(name) || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 8) return res.status(400).json({ error: 'Informe nome, e-mail válido e senha de pelo menos 8 caracteres.' });
    const out = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(clean(name), clean(email).toLowerCase(), await bcrypt.hash(password, 12));
    setSession(res, out.lastInsertRowid);
    res.json({ id: out.lastInsertRowid, name: clean(name), email: clean(email) });
  });

  app.post('/api/login', async (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email).toLowerCase());
    if (!user || !await bcrypt.compare(String(req.body.password || ''), user.password_hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    setSession(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email, color: user.color });
  });
  app.post('/api/logout', session, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(sessionToken(req)));
    res.setHeader('Set-Cookie', 'leo=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.status(204).end();
  });
  app.get('/api/me', session, (req, res) => res.json(req.user));
  app.get('/api/profiles', session, (req, res) => res.json(db.prepare('SELECT id,name,email,color FROM users ORDER BY name').all()));
  app.post('/api/profiles', session, async (req, res) => {
    const { name, email, password, color } = req.body;
    if (!clean(name) || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 8) return res.status(400).json({ error: 'Preencha nome, e-mail e uma senha de 8 caracteres.' });
    try {
      const out = db.prepare('INSERT INTO users(name,email,password_hash,color) VALUES(?,?,?,?)').run(clean(name), clean(email).toLowerCase(), await bcrypt.hash(password, 12), clean(color) || '#39694a');
      res.json({ id: out.lastInsertRowid });
    } catch {
      res.status(409).json({ error: 'Esse e-mail já está em uso.' });
    }
  });

  app.get('/api/documents', session, list('documents'));
  app.post('/api/documents', session, upload.single('file'), (req, res) => {
    const body = req.body;
    if (!clean(body.title)) return res.status(400).json({ error: 'Informe o nome do documento.' });
    const file = req.file;
    let stored = '';
    if (file) {
      const extension = path.extname(file.originalname).slice(0, 12).replace(/[^.\w]/g, '');
      stored = `${crypto.randomUUID()}${extension}`;
      fs.writeFileSync(path.join(uploadsDir, stored), file.buffer);
    }
    const out = db.prepare('INSERT INTO documents(title,document_number,category,due_date,original_name,stored_name,created_by) VALUES(?,?,?,?,?,?,?)').run(clean(body.title), clean(body.document_number), clean(body.category), clean(body.due_date), file?.originalname || '', stored, req.user.id);
    res.json({ id: out.lastInsertRowid });
  });
  app.get('/api/documents/:id/file', session, (req, res) => {
    const document = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
    if (!document?.stored_name) return res.status(404).end();
    const file = path.join(uploadsDir, document.stored_name);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.download(file, document.original_name);
  });

  registerGenericRoutes(app);
  registerRecipeImport(app);

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'O arquivo é grande demais (limite de 25 MB).' });
    console.error(err);
    res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
  });
}

function registerGenericRoutes(app) {
  const resources = {
    events: ['title', 'event_date', 'event_time', 'detail'],
    medications: ['name', 'person', 'medication_time', 'detail'],
    birthdays: ['name', 'birthday_date', 'notes'],
    recipes: ['title', 'description', 'source_url', 'ingredients', 'instructions'],
    tasks: ['title', 'due_date'],
    shopping_items: ['title', 'quantity', 'category'],
    albums: ['title', 'album_date']
  };

  for (const [table, fields] of Object.entries(resources)) {
    app.get(`/api/${table}`, session, list(table));
    app.post(`/api/${table}`, session, (req, res) => {
      const values = fields.map(field => clean(req.body[field]));
      if (!values[0]) return res.status(400).json({ error: 'Preencha o campo obrigatório.' });
      const columns = [...fields, 'created_by'];
      const out = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...values, req.user.id);
      res.json({ id: out.lastInsertRowid });
    });
    app.put(`/api/${table}/:id`, session, (req, res) => {
      const values = fields.map(field => clean(req.body[field]));
      if (!values[0]) return res.status(400).json({ error: 'Preencha o campo obrigatório.' });
      db.prepare(`UPDATE ${table} SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`).run(...values, req.params.id);
      res.status(204).end();
    });
    app.delete(`/api/${table}/:id`, session, (req, res) => {
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
      res.status(204).end();
    });
  }

  app.patch('/api/tasks/:id', session, (req, res) => {
    db.prepare('UPDATE tasks SET done=? WHERE id=?').run(req.body.done ? 1 : 0, req.params.id);
    res.status(204).end();
  });
  app.patch('/api/shopping_items/:id', session, (req, res) => {
    db.prepare('UPDATE shopping_items SET purchased=? WHERE id=?').run(req.body.purchased ? 1 : 0, req.params.id);
    res.status(204).end();
  });
  app.delete('/api/documents/:id', session, (req, res) => {
    const document = db.prepare('SELECT stored_name FROM documents WHERE id=?').get(req.params.id);
    if (document?.stored_name) fs.rmSync(path.join(uploadsDir, document.stored_name), { force: true });
    db.prepare('DELETE FROM documents WHERE id=?').run(req.params.id);
    res.status(204).end();
  });
}

function privateIp(ip) {
  if (net.isIP(ip) === 4) return /^(10\.|127\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:');
}

async function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw Error('Use um link HTTPS.');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(record => privateIp(record.address))) throw Error('Esse endereço não pode ser importado.');
  return url;
}

async function fetchSafe(value) {
  let url = await safeUrl(value);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'LarEmOrdem/1.0 recipe importer' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = await safeUrl(new URL(response.headers.get('location'), url).toString());
      continue;
    }
    if (!response.ok) throw Error('Não foi possível acessar essa receita.');
    return response.text();
  }
  throw Error('Muitos redirecionamentos.');
}

function recipeFromHtml(html, url) {
  const found = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1].trim());
      found.push(data, ...(data['@graph'] || []));
    } catch {}
  }
  const recipe = found.find(value => String(value['@type']).toLowerCase().includes('recipe'));
  if (!recipe) throw Error('Este site não disponibiliza dados de receita compatíveis.');
  const arrayValue = value => Array.isArray(value) ? value.join('\n') : clean(value);
  return {
    title: clean(recipe.name),
    description: clean(recipe.description),
    source_url: url,
    ingredients: arrayValue(recipe.recipeIngredient),
    instructions: Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions.map(value => typeof value === 'string' ? value : (value.text || value.name || '')).filter(Boolean).join('\n') : clean(recipe.recipeInstructions)
  };
}

function registerRecipeImport(app) {
  app.post('/api/recipes/import', session, async (req, res) => {
    try {
      const source = clean(req.body.url);
      const recipe = recipeFromHtml(await fetchSafe(source), source);
      if (!recipe.title) throw Error('Não encontramos o nome da receita.');
      res.json(recipe);
    } catch (error) {
      res.status(400).json({ error: error.message || 'Não foi possível importar esta receita.' });
    }
  });
}
