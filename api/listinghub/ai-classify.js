// POST /api/listinghub/ai-classify   (Admin / Editor only, Supabase access token required)
// Body: { items: [{ id, text }] }  → { results: [{ id, class, kind, category, type }] }
import { callerRole } from './_lib/supabase.js';
import { classifyWithAI, aiEnabled } from './_lib/ai.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let who;
  try { who = await callerRole(req); } catch { who = null; }
  if (!who || !['admin', 'editor'].includes(who.role)) return res.status(403).json({ error: 'forbidden' });
  if (!aiEnabled()) return res.status(503).json({ error: 'AI not configured' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const items = Array.isArray(body.items) ? body.items.slice(0, 40).filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string') : [];
  try {
    const results = await classifyWithAI(items.map((i) => ({ id: i.id.slice(0, 40), text: i.text.slice(0, 1500) })));
    return res.status(200).json({ results });
  } catch (e) {
    console.error('ai-classify failed', e);
    return res.status(502).json({ error: 'AI request failed' });
  }
}
