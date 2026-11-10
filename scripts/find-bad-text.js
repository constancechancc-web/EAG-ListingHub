// Looks for text the database would refuse: emoji cut in half (lone surrogates) in parsed listings/requests.
//   node scripts/find-bad-text.js "C:\path\to\export.zip"
import fs from 'node:fs';
import { unzipSync } from 'fflate';
import { fileBytesToText, parseChatText } from '../listinghub/js/core/whatsapp.js';
import { processMessages } from '../listinghub/js/core/importer.js';

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const file = process.argv[2];
const res = processMessages(parseChatText(fileBytesToText(new Uint8Array(fs.readFileSync(file)), unzipSync)), { fileName: file });
const bad = [];
for (const it of [...res.listings, ...res.requests]) {
  for (const [k, v] of Object.entries(it)) {
    const vals = Array.isArray(v) ? v : [v];
    for (const x of vals) if (typeof x === 'string' && LONE.test(x)) bad.push({ field: k, sample: JSON.stringify(x.slice(-30)) });
  }
}
console.log(`${res.listings.length} listings + ${res.requests.length} requests, ${bad.length} with a broken character`);
console.log(bad.slice(0, 8));
