// Optional AI help for messages the rules could not classify. Import-time only — never used for search/match.
// Only the message text is sent (phone numbers already masked); no names, contact lists or group data.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { TYPES } from '../../../listinghub/js/core/constants.js';

const TYPE_IDS = TYPES.map((t) => t.id);

const Result = z.object({
  results: z.array(z.object({
    id: z.string(),
    class: z.enum(['listing', 'request', 'ignore']),
    kind: z.enum(['sale', 'rent', 'unknown']),
    category: z.enum(['Residential', 'Commercial', 'Industrial', 'Land', 'Other']),
    type: z.enum([...TYPE_IDS, 'Other']),
  })),
});

const SYSTEM = `You classify WhatsApp messages from property agent groups in Johor Bahru, Malaysia.
Messages mix English, Malay and Chinese.
- "listing": an agent offering a property for sale or for rent.
- "request": an agent looking for a property for a client (WTB = want to buy, WTR = want to rent, buyer/tenant looking, 求购, 求租).
- "ignore": greetings, chit-chat, "sold"/"rented" notices, ads that are not a property, anything else.
kind: "sale" for buy/sell, "rent" for rent/let, "unknown" if not stated.
category/type: pick from the allowed values. "landed" means a house, not land. A shoplot is Commercial even if it has 2 storeys.
A factory with land in acres is a factory (Industrial), not land. Use "Other" when unsure. Return one result per input id.`;

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

/** items: [{ id, text }] (≤ 40). Returns [{ id, class, kind, category, type }]. */
export async function classifyWithAI(items) {
  if (!aiEnabled() || !items.length) return [];
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(Result) },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(items.map(({ id, text }) => ({ id, text: String(text).slice(0, 1500) }))) }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return [];
  const ids = new Set(items.map((i) => i.id));
  return response.parsed_output.results
    .filter((r) => ids.has(r.id))
    .map((r) => ({ ...r, kind: r.kind === 'unknown' ? null : r.kind, type: r.type === 'Other' ? null : r.type, category: r.category === 'Other' ? null : r.category }));
}
