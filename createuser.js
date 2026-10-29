#!/usr/bin/env node
'use strict';
/**
 * Create or update a panel user from the CLI.
 *
 *   node scripts/createuser.js --user admin --pass secret123 --role owner
 *   node scripts/createuser.js --user bob --pass hunter222        # regular user
 *   node scripts/createuser.js --user admin --role owner          # update only, keep the password
 *   node scripts/createuser.js --user bob --pass newpass --reset-password
 *   node scripts/createuser.js --exists admin                     # exit 0 when the account exists
 *   node scripts/createuser.js --list
 *
 * The password is only written when --pass is given **and** --reset-password is
 * used, or when the account is new. That keeps `install.sh --repair` from
 * silently resetting a password the owner already changed.
 */
const db = require('../src/db');
const auth = require('../src/auth');
const { uid } = require('../src/utils');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return process.argv.includes(`--${name}`) ? true : fallback;
}

(async function main() {
  db.load();
  const users = db.get('users');

  const exists = arg('exists');
  if (exists) {
    const found = users.find((u) => u.username.toLowerCase() === String(exists).toLowerCase()
      || (u.email && u.email.toLowerCase() === String(exists).toLowerCase()));
    process.exit(found ? 0 : 1);
  }

  if (arg('list')) {
    if (!users.length) return console.log('No users yet - create one with --user <name> --pass <password>');
    console.log('ID                     USERNAME        ROLE    CREATED');
    for (const u of users) console.log(`${u.id.padEnd(22)} ${u.username.padEnd(15)} ${u.role.padEnd(7)} ${(u.createdAt || '').slice(0, 10)}`);
    return;
  }

  const username = arg('user') || arg('username');
  const password = arg('pass') || arg('password');
  const role = arg('role') || 'user';
  const email = arg('email') || '';
  const reset = Boolean(arg('reset-password'));
  const existing = username
    ? users.find((u) => u.username.toLowerCase() === String(username).toLowerCase())
    : null;
  if (!username) {
    console.error('Usage: node scripts/createuser.js --user <name> [--pass <password>] [--role owner|admin|user] [--email a@b.c] [--reset-password] [--exists <user>] [--list]');
    process.exit(1);
  }
  if (!password && !existing) {
    console.error(`No account named "${username}" yet - pass --pass <password> to create it`);
    process.exit(1);
  }
  if (password && !reset && existing) {
    console.error(`"${username}" already exists - add --reset-password to overwrite its password`);
    console.error('(updating the role/e-mail only? leave --pass out)');
    process.exit(2);
  }
  if (!auth.ROLES[role]) return console.error(`Invalid role "${role}" (owner|admin|user)`);

  if (existing) {
    const patch = { role, suspended: false };
    // the e-mail must be patched too on this path: login accepts username OR
    // e-mail, so an insert-only e-mail breaks sign-in by address later
    if (email) patch.email = email;
    if (reset) {
      patch.password = await auth.hashPassword(password);
      patch.passwordVersion = (existing.passwordVersion || 0) + 1;
    }
    db.update('users', existing.id, patch);
    console.log(`Updated user "${username}" (role: ${role}${email ? `, e-mail: ${email}` : ''}${reset ? ', password reset' : ', existing password kept'})`);
  } else {
    db.insert('users', {
      id: uid('usr'), username, email, password: await auth.hashPassword(password), role, passwordVersion: 0,
      createdAt: new Date().toISOString(), suspended: false, createdBy: 'cli',
    });
    console.log(`Created user "${username}" with role "${role}"${email ? ` and e-mail ${email}` : ''}`);
  }
  await db.flush();
})();
