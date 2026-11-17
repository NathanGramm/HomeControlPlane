// File manager for a Minecraft server's folder. Mounted by minecraft.js, so
// req.mcServer is set and every path here is relative to its dataDir.
// Reads always work; changes need canWrite(server) to say yes (server stopped).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const express = require('express');

const MAX_EDIT_BYTES = 2 * 1024 * 1024; // the in-browser editor is for config, not worlds

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isInside(root, abs) {
  return abs === root || abs.startsWith(root + path.sep);
}

// Resolves a client path inside the server folder, or throws 400. Checks the
// real path of the nearest existing ancestor too, so a symlink can't lead out.
async function resolvePath(root, rel = '') {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new HttpError(400, 'Bad path');
  const realRoot = await fsp.realpath(root);
  const abs = path.resolve(realRoot, `.${path.sep}${rel}`);
  if (!isInside(realRoot, abs)) throw new HttpError(400, 'Path is outside the server folder');
  let probe = abs;
  for (;;) {
    try {
      if (!isInside(realRoot, await fsp.realpath(probe))) throw new HttpError(400, 'Path is outside the server folder');
      break;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err.code !== 'ENOENT' || probe === realRoot) throw err;
      probe = path.dirname(probe);
    }
  }
  return { abs, root: realRoot, rel: path.relative(realRoot, abs).split(path.sep).join('/') };
}

// The dashboard runs as root. New files get the server folder's owner, so the
// Minecraft server (uid 1000) can still change them.
async function matchOwner(root, abs, recursive = false) {
  if (process.getuid?.() !== 0) return;
  const { uid, gid } = await fsp.stat(root);
  if (recursive) await promisify(execFile)('chown', ['-R', `${uid}:${gid}`, abs]);
  else await fsp.chown(abs, uid, gid);
}

function checkName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\0]/.test(name) || name.length > 255) {
    throw new HttpError(400, 'Bad file name');
  }
  return name;
}

module.exports = function mountFiles(router, { canWrite }) {
  const files = express.Router({ mergeParams: true });

  // Every non-GET request changes something, so check the server state once.
  files.use(async (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    try {
      const why = await canWrite(req.mcServer);
      if (why) return res.status(409).json({ error: why });
      next();
    } catch (err) {
      next(err);
    }
  });

  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

  // GET ?path=dir -> { path, entries: [{ name, dir, size, mtime }] }, folders first
  files.get('/', wrap(async (req, res) => {
    const p = await resolvePath(req.mcServer.dataDir, req.query.path);
    const dirents = await fsp.readdir(p.abs, { withFileTypes: true });
    const entries = await Promise.all(dirents.map(async (d) => {
      try {
        const st = await fsp.stat(path.join(p.abs, d.name));
        return { name: d.name, dir: st.isDirectory(), size: st.size, mtime: st.mtime.toISOString() };
      } catch {
        return null; // broken symlink or vanished mid-listing
      }
    }));
    res.json({
      path: p.rel,
      entries: entries.filter(Boolean)
        .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true })),
    });
  }));

  // GET /read?path=file -> the text, for the editor
  files.get('/read', wrap(async (req, res) => {
    const p = await resolvePath(req.mcServer.dataDir, req.query.path);
    const st = await fsp.stat(p.abs);
    if (st.isDirectory()) throw new HttpError(400, 'That is a folder');
    if (st.size > MAX_EDIT_BYTES) throw new HttpError(413, 'Too big to edit here. Download it instead.');
    const buf = await fsp.readFile(p.abs);
    if (buf.includes(0)) throw new HttpError(415, 'Not a text file. Download it instead.');
    res.type('text/plain; charset=utf-8').send(buf);
  }));

  // GET /download?path=file
  files.get('/download', wrap(async (req, res) => {
    const p = await resolvePath(req.mcServer.dataDir, req.query.path);
    if ((await fsp.stat(p.abs)).isDirectory()) throw new HttpError(400, 'Folders can\'t be downloaded yet');
    res.download(p.abs, path.basename(p.abs), { dotfiles: 'allow' });
  }));

  // PUT /write?path=file, body = new text
  files.put('/write', express.text({ type: () => true, limit: MAX_EDIT_BYTES }), wrap(async (req, res) => {
    const p = await resolvePath(req.mcServer.dataDir, req.query.path);
    if (p.abs === p.root) throw new HttpError(400, 'Bad path');
    const tmp = `${p.abs}.saving-${process.pid}`;
    await fsp.writeFile(tmp, typeof req.body === 'string' ? req.body : '');
    await matchOwner(p.root, tmp);
    await fsp.rename(tmp, p.abs); // never leaves a half-written config
    res.json({ ok: true });
  }));

  // POST /upload?path=dir&name=file, body = raw file bytes (streamed, any size)
  files.post('/upload', wrap(async (req, res) => {
    const dir = await resolvePath(req.mcServer.dataDir, req.query.path);
    if (!(await fsp.stat(dir.abs)).isDirectory()) throw new HttpError(400, 'Upload target is not a folder');
    const target = path.join(dir.abs, checkName(req.query.name));
    const tmp = `${target}.uploading-${process.pid}`;
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        req.on('aborted', () => reject(new Error('Upload aborted')));
        req.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        req.pipe(out);
      });
      await matchOwner(dir.root, tmp);
      await fsp.rename(tmp, target);
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    res.json({ ok: true });
  }));

  // POST /mkdir?path=dir&name=new
  files.post('/mkdir', wrap(async (req, res) => {
    const dir = await resolvePath(req.mcServer.dataDir, req.query.path);
    const target = path.join(dir.abs, checkName(req.query.name));
    await fsp.mkdir(target);
    await matchOwner(dir.root, target);
    res.json({ ok: true });
  }));

  // POST /rename?path=item&name=newName (same folder)
  files.post('/rename', wrap(async (req, res) => {
    const p = await resolvePath(req.mcServer.dataDir, req.query.path);
    if (p.abs === p.root) throw new HttpError(400, 'Can\'t rename the server folder');
    const target = path.join(path.dirname(p.abs), checkName(req.query.name));
    try {
      await fsp.access(target);
      throw new HttpError(409, 'Something with that name already exists');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    await fsp.rename(p.abs, target);
    res.json({ ok: true });
  }));

  // DELETE ?path=item (folders recursively; the page confirms first)
  files.delete('/', wrap(async (req, res) => {
    const p = await resolvePath(req.mcServer.dataDir, req.query.path);
    if (p.abs === p.root) throw new HttpError(400, 'Can\'t delete the server folder');
    await fsp.rm(p.abs, { recursive: true });
    res.json({ ok: true });
  }));

  files.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'EEXIST') return res.status(409).json({ error: 'Something with that name already exists' });
    if (err.code === 'ENOSPC') return res.status(507).json({ error: 'The disk is full' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Too big to save here' });
    console.error('Minecraft file manager:', err.message);
    res.status(500).json({ error: 'File operation failed' });
  });

  router.use('/:server/files', files);
};

module.exports.resolvePath = resolvePath;
module.exports.matchOwner = matchOwner;
