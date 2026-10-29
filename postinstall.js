#!/usr/bin/env node
'use strict';
/**
 * postinstall: prepares .env, data folders and prints a first-run hint.
 * Safe to run repeatedly; never fails an install.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

try {
  const envPath = path.join(root, '.env');
  const examplePath = path.join(root, '.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    let env = fs.readFileSync(examplePath, 'utf8');
    env = env.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${crypto.randomBytes(32).toString('hex')}"`);
    fs.writeFileSync(envPath, env);
    console.log('\x1b[32m✔\x1b[0m created .env with a fresh JWT secret');
  }
  for (const dir of ['data', 'data/tmp', 'data/bin', 'data/java', 'servers', 'backups']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  const pkg = require(path.join(root, 'package.json'));
  console.log(`\x1b[36m✔\x1b[0m ${pkg.name} v${pkg.version} dependencies installed`);
  console.log('  Start the panel with: \x1b[1mnpm start\x1b[0m');
  console.log('  Create an admin user:  \x1b[1mnpm run createuser -- --user admin --pass "yourpassword" --role owner\x1b[0m');
} catch (err) {
  console.warn('postinstall warning:', err.message);
}
