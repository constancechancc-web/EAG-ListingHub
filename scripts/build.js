// Vercel build: publish ONLY the web app (listinghub/) — never tests, notes, schema or sample chats.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');
const SKIP = new Set(['CoverPhoto.png', 'EAG LOGO.jpg']); // original design files; the app uses the resized copies

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'listinghub'), path.join(out, 'listinghub'), {
  recursive: true,
  filter: (src) => !SKIP.has(path.basename(src)),
});
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('Built public/listinghub');
