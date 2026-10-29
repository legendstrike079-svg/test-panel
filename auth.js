'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cfg = require('./config');
const db = require('./db');
const { randomToken } = require('./utils');

const ROLES = { owner: 3, admin: 2, user: 1 };

/* ------------------------------ users ------------------------------ */
async function hashPassword(plain) { return bcrypt.hash(plain, 10); }
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try { return await bcrypt.compare(plain, hash); } catch { return false; }
}

/**
 * The bcrypt hash stored on a user record. `password` is the canonical field;
 * `passwordHash` is accepted as an alias so a record seeded by hand (or by an
 * older tool) can never lock the owner out of their own panel.
 */
function hashOf(user) {
  return (user && (user.password || user.passwordHash)) || '';
}

function publicUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, pv: user.passwordVersion || 0 }, cfg.jwtSecret, { expiresIn: cfg.jwtExpires });
}

function verifyToken(token) {
  try { return jwt.verify(token, cfg.jwtSecret); } catch { return null; }
}

/* --------------------------- brute force --------------------------- */
const attempts = new Map();
function registerAttempt(key) {
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, first: now };
  if (now - entry.first > cfg.loginWindowMs) { entry.count = 0; entry.first = now; }
  entry.count += 1;
  attempts.set(key, entry);
  return entry;
}
function attemptsLeft(key) {
  const entry = attempts.get(key);
  if (!entry) return cfg.loginMaxAttempts;
  if (Date.now() - entry.first > cfg.loginWindowMs) { attempts.delete(key); return cfg.loginMaxAttempts; }
  return Math.max(0, cfg.loginMaxAttempts - entry.count);
}
function clearAttempts(key) { attempts.delete(key); }

/* --------------------------- api keys --------------------------- */
function hashApiKey(key) { return require('crypto').createHash('sha256').update(key).digest('hex'); }

/* --------------------------- permissions --------------------------- */
const SERVER_PERMS = ['console', 'files', 'backups', 'plugins', 'network', 'settings', 'schedules', 'subusers'];

function isAdmin(user) { return !!user && (user.role === 'admin' || user.role === 'owner'); }

/** Can `user` touch `server` at all? */
function canAccess(user, server) {
  if (!user || !server) return false;
  if (isAdmin(user)) return true;
  if (server.ownerId === user.id) return true;
  return (server.subusers || []).some((s) => s.userId === user.id);
}

/** Does `user` hold `perm` on `server`? */
function can(user, server, perm) {
  if (!user || !server) return false;
  if (isAdmin(user)) return true;
  if (server.ownerId === user.id) return true;
  const sub = (server.subusers || []).find((s) => s.userId === user.id);
  if (!sub) return false;
  const perms = sub.permissions || [];
  return perms.includes('*') || perms.includes(perm);
}

/* --------------------------- middleware --------------------------- */
function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.query.token) return String(req.query.token);
  if (req.headers['x-api-key']) return null;
  return null;
}

async function resolveUser(req) {
  // Installer secret: `install.sh` provisions the local node before any browser
  // exists, so a rotating secret from .env (OWNER_SECRET) may act as the owner.
  // It is compared in constant time, never logged, and can be blanked out to
  // disable this path entirely.
  const installerSecret = req.headers['x-owner-secret'];
  if (installerSecret) {
    const expected = process.env.OWNER_SECRET || '';
    if (expected.length >= 16) {
      const a = Buffer.from(String(installerSecret));
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        const owner = db.find('users', (u) => u.role === 'owner');
        if (owner) return owner;
      }
    }
    return null;
  }
  const apiKey = req.headers['x-api-key'] || (req.query.apikey ? String(req.query.apikey) : null);
  if (apiKey) {
    const record = db.find('apiKeys', (k) => k.hash === hashApiKey(apiKey) && !k.revoked);
    if (!record) return null;
    db.update('apiKeys', record.id, { lastUsedAt: new Date().toISOString() });
    return db.find('users', (u) => u.id === record.userId) || null;
  }
  const token = extractToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = db.find('users', (u) => u.id === payload.id);
  if (!user) return null;
  // token invalidation on password change
  if ((user.passwordVersion || 0) !== (payload.pv || 0)) return null;
  return user;
}

/** Express middleware: 401 when not authenticated. */
function authenticate(req, res, next) {
  resolveUser(req).then((user) => {
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.user = user;
    next();
  }).catch(next);
}

/** Optional auth: attaches req.user when present. */
function maybeAuth(req, res, next) {
  resolveUser(req).then((user) => { if (user) req.user = user; next(); }).catch(next);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Administrator privileges required' });
  next();
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ error: 'Owner privileges required' });
  next();
}

/** Fetch the server from :id / :serverId and attach req.server + permission check. */
function serverScope(perm = null) {
  return (req, res, next) => {
    const id = req.params.id || req.params.serverId;
    const server = db.find('servers', (s) => s.id === id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    if (!canAccess(req.user, server)) return res.status(403).json({ error: 'You do not have access to this server' });
    if (perm && !can(req.user, server, perm)) return res.status(403).json({ error: `Missing permission: ${perm}` });
    req.server = server;
    next();
  };
}

function generateApiKey() {
  const raw = `zen_${randomToken(24)}`;
  return { raw, hash: hashApiKey(raw) };
}

module.exports = {
  hashOf,
  ROLES, SERVER_PERMS, hashPassword, verifyPassword, publicUser, signToken, verifyToken,
  registerAttempt, attemptsLeft, clearAttempts, hashApiKey, generateApiKey,
  isAdmin, can, canAccess, authenticate, maybeAuth, requireAdmin, requireOwner, serverScope, resolveUser,
};
