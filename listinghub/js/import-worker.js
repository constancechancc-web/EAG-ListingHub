// Parses WhatsApp exports off the main thread so 20MB+ files never freeze the page.
import { unzipSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import { fileBytesToText, parseChatText, groupFromFileName } from './core/whatsapp.js';
import { processMessages } from './core/importer.js';

let messages = [];
let fileName = '';

self.onmessage = (e) => {
  const { cmd } = e.data;
  try {
    if (cmd === 'parse') {
      fileName = e.data.name;
      const bytes = new Uint8Array(e.data.buffer);
      self.postMessage({ type: 'progress', stage: 'read', pct: 0.05 });
      let text;
      try {
        text = fileBytesToText(bytes, unzipSync);
      } catch (err) {
        throw new Error(err.message === 'NO_TXT_IN_ZIP' ? 'NO_TXT_IN_ZIP' : 'BAD_FILE');
      }
      const all = parseChatText(text, { onProgress: (p) => self.postMessage({ type: 'progress', stage: 'parse', pct: 0.05 + p * 0.5 }) });
      const fromDay = e.data.fromDay;
      messages = all.filter((m) => m.day >= fromDay);
      const days = [...new Set(messages.map((m) => m.day))];
      self.postMessage({ type: 'parsed', total: all.length, kept: messages.length, tooOld: all.length - messages.length, days, group: groupFromFileName(fileName) });
    } else if (cmd === 'process') {
      const seen = new Set(e.data.seen || []);
      const hints = new Map(e.data.hints || []);
      const res = processMessages(messages, {
        fileName,
        seen,
        hints,
        onProgress: (p) => self.postMessage({ type: 'progress', stage: 'classify', pct: 0.6 + p * 0.3 }),
      });
      self.postMessage({ type: 'processed', res });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err.message || err) });
  }
};
