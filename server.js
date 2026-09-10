import express from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const db = new Database(path.join(dataDir, 'lar-em-ordem.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, color TEXT DEFAULT '#39694a', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, title TEXT NOT NULL, document_number TEXT, category TEXT, due_date TEXT, original_name TEXT, stored_name TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, source_url TEXT, ingredients TEXT, instructions TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, event_date TEXT NOT NULL, event_time TEXT, detail TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS medications (id INTEGER PRIMARY KEY, name TEXT NOT NULL, person TEXT, medication_time TEXT, detail TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS birthdays (id INTEGER PRIMARY KEY, name TEXT NOT NULL, birthday_date TEXT NOT NULL, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, due_date TEXT, done INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS shopping_items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, quantity TEXT, category TEXT, purchased INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS albums (id INTEGER PRIMARY KEY, title TEXT NOT NULL, album_date TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.get('/', (req,res) => res.sendFile(path.join(here, 'index.html')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, files: 1 });
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x => x.trim().split('=')));
function session(req, res, next) { const token = cookie(req).leo; if (!token) return res.status(401).json({ error: 'Faça login para continuar.' }); const row = db.prepare('SELECT u.id,u.name,u.email,u.color FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > CURRENT_TIMESTAMP').get(tokenHash(token)); if (!row) return res.status(401).json({ error: 'Sessão expirada.' }); req.user = row; next(); }
function setSession(res, userId) { const raw = crypto.randomBytes(32).toString('base64url'); db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime(\'now\',\'+30 days\'))').run(tokenHash(raw), userId); res.setHeader('Set-Cookie', `leo=${raw}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`); }
const list = table => (req,res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
const clean = v => typeof v === 'string' ? v.trim() : '';

app.get('/api/setup-status', (req,res) => res.json({ ready: !!db.prepare('SELECT id FROM users LIMIT 1').get() }));
app.post('/api/setup', async (req,res) => { if (db.prepare('SELECT id FROM users LIMIT 1').get()) return res.status(409).json({ error: 'A primeira conta já foi criada.' }); const { name,email,password } = req.body; if (!clean(name) || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 8) return res.status(400).json({ error: 'Informe nome, e-mail válido e senha de pelo menos 8 caracteres.' }); const out = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(clean(name),clean(email).toLowerCase(),await bcrypt.hash(password,12)); setSession(res,out.lastInsertRowid); res.json({ id:out.lastInsertRowid,name:clean(name),email:clean(email) }); });
app.post('/api/login', async (req,res) => { const user=db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email).toLowerCase()); if (!user || !await bcrypt.compare(String(req.body.password||''),user.password_hash)) return res.status(401).json({ error:'E-mail ou senha incorretos.' }); setSession(res,user.id); res.json({ id:user.id,name:user.name,email:user.email,color:user.color }); });
app.post('/api/logout', session, (req,res) => { const raw=cookie(req).leo; db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(raw)); res.setHeader('Set-Cookie','leo=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.status(204).end(); });
app.get('/api/me', session, (req,res)=>res.json(req.user));
app.get('/api/profiles', session, (req,res)=>res.json(db.prepare('SELECT id,name,email,color FROM users ORDER BY name').all()));
app.post('/api/profiles', session, async (req,res)=>{const {name,email,password,color}=req.body;if(!clean(name)||!/^\S+@\S+\.\S+$/.test(email||'')||String(password||'').length<8)return res.status(400).json({error:'Preencha nome, e-mail e uma senha de 8 caracteres.'});try{const out=db.prepare('INSERT INTO users(name,email,password_hash,color) VALUES(?,?,?,?)').run(clean(name),clean(email).toLowerCase(),await bcrypt.hash(password,12),clean(color)||'#39694a');res.json({id:out.lastInsertRowid})}catch{return res.status(409).json({error:'Esse e-mail já está em uso.'})}});

app.get('/api/documents',session,list('documents'));
app.post('/api/documents',session,upload.single('file'),(req,res)=>{const b=req.body;if(!clean(b.title))return res.status(400).json({error:'Informe o nome do documento.'});const f=req.file;let stored='';if(f){const ext=path.extname(f.originalname).slice(0,12).replace(/[^.\w]/g,'');stored=`${crypto.randomUUID()}${ext}`;fs.writeFileSync(path.join(uploadsDir,stored),f.buffer)}const out=db.prepare('INSERT INTO documents(title,document_number,category,due_date,original_name,stored_name,created_by) VALUES(?,?,?,?,?,?,?)').run(clean(b.title),clean(b.document_number),clean(b.category),clean(b.due_date),f?.originalname||'',stored,req.user.id);res.json({id:out.lastInsertRowid})});
app.get('/api/documents/:id/file',session,(req,res)=>{const d=db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);if(!d?.stored_name)return res.status(404).end();const file=path.join(uploadsDir,d.stored_name);if(!fs.existsSync(file))return res.status(404).end();res.download(file,d.original_name)});

function generic(table, fields) { app.get(`/api/${table}`,session,list(table)); app.post(`/api/${table}`,session,(req,res)=>{const values=fields.map(f=>clean(req.body[f]));if(!values[0])return res.status(400).json({error:'Preencha o campo obrigatório.'});const columns=[...fields,'created_by'];const out=db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...values,req.user.id);res.json({id:out.lastInsertRowid})}); app.put(`/api/${table}/:id`,session,(req,res)=>{const values=fields.map(f=>clean(req.body[f]));if(!values[0])return res.status(400).json({error:'Preencha o campo obrigatório.'});db.prepare(`UPDATE ${table} SET ${fields.map(f=>`${f}=?`).join(',')} WHERE id=?`).run(...values,req.params.id);res.status(204).end()}); app.delete(`/api/${table}/:id`,session,(req,res)=>{db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);res.status(204).end()}); }
generic('events',['title','event_date','event_time','detail']); generic('medications',['name','person','medication_time','detail']); generic('birthdays',['name','birthday_date','notes']); generic('recipes',['title','description','source_url','ingredients','instructions']); generic('tasks',['title','due_date']); generic('shopping_items',['title','quantity','category']); generic('albums',['title','album_date']);
app.patch('/api/tasks/:id',session,(req,res)=>{db.prepare('UPDATE tasks SET done=? WHERE id=?').run(req.body.done?1:0,req.params.id);res.status(204).end()});
app.patch('/api/shopping_items/:id',session,(req,res)=>{db.prepare('UPDATE shopping_items SET purchased=? WHERE id=?').run(req.body.purchased?1:0,req.params.id);res.status(204).end()});
app.delete('/api/documents/:id',session,(req,res)=>{const d=db.prepare('SELECT stored_name FROM documents WHERE id=?').get(req.params.id);if(d?.stored_name)fs.rmSync(path.join(uploadsDir,d.stored_name),{force:true});db.prepare('DELETE FROM documents WHERE id=?').run(req.params.id);res.status(204).end()});

function privateIp(ip){if(net.isIP(ip)===4)return /^(10\.|127\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);return ip==='::1'||ip.startsWith('fc')||ip.startsWith('fd')||ip.startsWith('fe80:')}
async function safeUrl(value){const u=new URL(value);if(u.protocol!=='https:')throw Error('Use um link HTTPS.');const records=await dns.lookup(u.hostname,{all:true});if(!records.length||records.some(x=>privateIp(x.address)))throw Error('Esse endereço não pode ser importado.');return u}
async function fetchSafe(value){let url=await safeUrl(value);for(let n=0;n<4;n++){const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'LarEmOrdem/1.0 recipe importer'}});if([301,302,303,307,308].includes(r.status)){url=await safeUrl(new URL(r.headers.get('location'),url).toString());continue}if(!r.ok)throw Error('Não foi possível acessar essa receita.');return await r.text()}throw Error('Muitos redirecionamentos.')}
function recipeFromHtml(html,url){const found=[];for(const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const data=JSON.parse(match[1].trim());found.push(data,...(data['@graph']||[]))}catch{}}const r=found.find(x=>String(x['@type']).toLowerCase().includes('recipe'));if(!r)throw Error('Este site não disponibiliza dados de receita compatíveis.');const arr=x=>Array.isArray(x)?x.join('\n'):clean(x);return {title:clean(r.name),description:clean(r.description),source_url:url,ingredients:arr(r.recipeIngredient),instructions:Array.isArray(r.recipeInstructions)?r.recipeInstructions.map(x=>typeof x==='string'?x:(x.text||x.name||'')).filter(Boolean).join('\n'):clean(r.recipeInstructions)} }
app.post('/api/recipes/import',session,async(req,res)=>{try{const source=clean(req.body.url);const recipe=recipeFromHtml(await fetchSafe(source),source);if(!recipe.title)throw Error('Não encontramos o nome da receita.');res.json(recipe)}catch(e){res.status(400).json({error:e.message||'Não foi possível importar esta receita.'})}});

app.use((err,req,res,next)=>{if(err instanceof multer.MulterError)return res.status(400).json({error:'O arquivo é grande demais (limite de 25 MB).'});console.error(err);res.status(500).json({error:'Ocorreu um erro no servidor.'})});
app.listen(process.env.PORT||3000,()=>console.log(`Lar em Ordem em execução na porta ${process.env.PORT||3000}`));
