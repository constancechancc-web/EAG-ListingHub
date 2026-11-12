import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('scripts/auto-import.config.json', 'utf8'));
const RX = /created the username|changed their username|changed (?:the )?(?:group|this group)|\badded ~|~\s*[^\n]{0,40}\badded\b|\bwas added\b|\bjoined (?:using|via|from)|\bremoved ~|changed the subject|security code|end-to-end encrypted|\bleft$|invite link/i;
for (const table of ['listings', 'requests']) {
  const hits = [];
  let total = 0;
  for (let after = ''; ;) {
    const r = await (await fetch(cfg.endpoint + `?action=rows&table=${table}${after ? '&after=' + after : ''}`, { headers: { Authorization: 'Bearer ' + cfg.token } })).json();
    for (const { id, data: d } of r.rows) { total++; if (d.raw && d.raw.length < 200 && RX.test(d.raw)) hits.push({ id, raw: d.raw.replace(/\n/g, ' / ') }); }
    if (!r.next) break; after = r.next;
  }
  console.log(table, total, 'rows;', hits.length, 'system-looking');
  for (const h of hits.slice(60)) console.log(' ', h.id, h.raw.slice(0, 110));
  fs.writeFileSync(`_sys_${table}.json`, JSON.stringify(hits.map((h) => h.id)));
}
