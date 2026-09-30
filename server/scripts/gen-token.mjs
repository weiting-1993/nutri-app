#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token, 'utf8').digest('hex');

console.log(`
New device token (256-bit). Treat it like a password.

  TOKEN (enter in the phone app, then delete from wherever you copied it):
    ${token}

  HASH (goes into the Worker secret DEVICE_TOKEN_HASHES):
    ${hash}

Next steps:
  1. Collect the HASH of every phone that should have access.
  2. Run:  npx wrangler secret put DEVICE_TOKEN_HASHES
     and paste all hashes comma-separated, e.g.  <hash-phone-1>,<hash-phone-2>
  3. To revoke a phone later, run the same command again without its hash.

The Worker only ever stores the hash; the token itself is not recoverable.
`);
