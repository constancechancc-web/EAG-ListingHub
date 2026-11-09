// Writes a sample WhatsApp export (today's date) to sample-data/ for trying the Import page.
import fs from 'node:fs';
import { L, R, androidExport } from '../tests/fixtures.js';
const d = new Date(Date.now() + 8 * 3600e3);
const day = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const items = [...Object.values(L).map((t, i) => [`Agent ${i}`, t]), ...Object.values(R).map((t) => ['Kelly Lim', t]), ['宝贝老公 hubby M', L.molekTerrace.replace('780k', '790k')], ['Bob', 'Good morning all 🙏']];
fs.writeFileSync('sample-data/WhatsApp Chat with JB TRR Rent 1 Listing Group.txt', androidExport(items, day));
console.log('sample-data written for', day);
