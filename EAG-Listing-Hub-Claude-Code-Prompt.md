# Build: EAG Listing Hub (property listing search + WTB/WTR matching)

You are building a private web app for a property agency team in Johor Bahru, Malaysia (about 80 agents). The app turns WhatsApp group chat exports into a searchable listing database and matches property listings against buyer/tenant requests (WTB = want to buy, WTR = want to rent).

The owner is non-technical. Explain any setup step she must do herself in simple Chinese (简体中文). UI text is bilingual: English + 华语.

---

## 1. Hard rules (security and data safety)

1. **Authenticated access only.** Every user must sign in (Google login). Only emails on an allowlist get in. A secret URL alone is NOT enough. The site must not be indexed by Google (`noindex`, robots.txt disallow, no sitemap).
2. **Roles:**
   - **Admin** — exactly one person (the owner). Full control, including delete, backup and restore.
   - **Editor** — can import WhatsApp chats. Cannot delete, cannot clear data, cannot manage users.
   - **Viewer (agent)** — can search and match only. Cannot upload, edit or delete anything.
   Enforce roles on the server or in database security rules, not only by hiding buttons.
3. **No secrets in frontend code.** No database admin credentials and no AI API keys in anything shipped to the browser.
4. **Privacy.** Do not send unnecessary personal information to AI services. Send only the message text needed for parsing, never the whole contact list.
5. **Agents' searching must not use AI.** Search and matching run locally in the browser with plain code, at zero AI cost.
6. **Never delete existing data** until a backup and migration have been verified. Build an "export everything as JSON" backup first.
7. **Test with one Viewer** before inviting other agents.
8. **Don't deploy to production** until the owner approves the test results. Use a separate test URL or branch.

---

## 2. Data flow

```
WhatsApp group → Export chat (Without Media) → .zip or .txt
   ├─ Owner: saves it to a shared Google Drive folder → scheduled import at 12:00 and 21:00 (Asia/Kuala_Lumpur)
   └─ Editor (iPhone/iCloud): uploads the file directly in the app's Import page
→ parser → listings / requests → database → search + match in the browser
```

- **Supported files:**
  - `.zip`: find `_chat.txt` or the first `.txt` inside. Detect the zip from its content, not from its file extension.
  - `.txt`: support both WhatsApp line formats:
    - Android: `dd/mm/yyyy, hh:mm - Name: msg`
    - iPhone: `[dd/mm/yyyy, hh:mm:ss] Name: msg`
  - Messages can span several lines.
  - Handle files of 20MB+ in the browser without freezing (work in chunks).
- **Group name and source:** take the group name from the file name, e.g. `WhatsApp Chat with JB TRR Rent 1 Listing Group.zip`.
  - Groups containing "EAG 卓越" → source **EAG Listing**.
  - Every other group → source **TRR Group**.
- **De-duplication:** hash each message (sender + time + text). Importing the same chat twice, or the same group by two people, must not create duplicates. Keep a `seen` set of hashes.
- **Retention:** keep listings and requests for **90 days** from the date they were posted. Hide older ones. The owner deletes them only after she confirms.
- **Name override:** the WhatsApp sender name "宝贝老公 hubby M" must be shown as **Roy Goh** everywhere.

---

## 3. Parsing messages

Classify each message as **listing** (for sale / for rent), **request** (WTB / WTR / "buyer looking" / "tenant looking" / 求购 / 求租), or **ignore** (chit-chat, "sold", stickers and similar).

Use rule-based parsing first. Use AI only for messages the rules cannot classify, and only during import, never for searching. Allow an import mode with no AI at all.

### Listing fields
| Field | Notes |
|---|---|
| `kind` | `sale` or `rent` |
| `title` | property or development name, e.g. "Taman Molek", "Eco Palladium" |
| `area` | address line |
| `region` | one of the REGIONS below, otherwise "Other" |
| `category`, `type` | from the type list below; "Other" if unknown |
| `price` | in RM: sale price, or monthly rent for rentals |
| `bankValue` | if stated (sale) |
| `bed`, `bath`, `sqft` (built-up), `land` (land area in sqft), `dims` (e.g. 24x80), `storeys`, `tenure`, `furnishing` | |
| `features[]` | e.g. corner lot, facing main road |
| `renName`, `renPhone` | the agent who posted it |
| `group`, `source`, `postedAt` | |
| `raw` | the original message text, kept for the "original post" view and WhatsApp messages |

### Request fields
`kind`, `category`, `types[]`, `typeText`, `areas[]`, `budgetMin`, `budgetMax`, `budgetText`, `bedMin`, `bathMin`, `furnishing`, `mustHave[]`, `clientName`, `renName`, `renPhone`, `raw`, `status` (open or closed).

### Categories and types (fixed list)
- **Residential:** Condo / Serviced Residence, Apartment / Flat, Terrace (1–1.5 Storey), Terrace (2–2.5 Storey), Terrace (3+ Storey), Townhouse, Cluster House, Semi-D, Bungalow
- **Commercial:** Shop Office, Retail / Shop Lot, Office
- **Industrial:** Factory / Warehouse
- **Land:** Residential Land, Commercial Land, Industrial Land, Agricultural Land

Show the Chinese name with each type: 公寓, 组屋/平价屋, 单层排屋, 双层排屋, 三层排屋, 联排屋, 田字屋, 半独立, 独立洋房, 店屋, 商铺, 办公室, 厂房/仓库, 住宅地, 商业地, 工业地, 农业地.

### Regions (in order, first match wins, case-insensitive)
| Region | Matches |
|---|---|
| Mount Austin | austin |
| Molek / Daya | molek, taman daya |
| Tebrau | tebrau, setia indah, bukit mutiara |
| Permas Jaya | permas |
| Johor Jaya | johor jaya |
| Masai | masai, seri alam |
| Pasir Gudang | pasir gudang, scientex, bistari |
| Ulu Tiram | tiram, desa cemerlang, chellam, puteri wangsa |
| Kulai | kulai, indahpura, saleng |
| Senai | senai |
| Bukit Indah | bukit indah |
| Iskandar Puteri | iskandar, nusajaya, medini, puteri harbour, horizon hill, eco botanic, gelang patah, leisure farm |
| Setia Tropika | setia tropika |
| Kangkar Pulai | kangkar pulai, pulai indah, pulai utama, pulai jaya |
| Skudai | skudai, tun aminah, universiti, mutiara rini, sri pulai, selesa jaya, uda |
| Perling | perling |
| Tampoi | tampoi |
| Kempas | kempas |
| Larkin | larkin |
| Plentong | plentong |
| JB Town | jb town, stulang, danga, century garden, pelangi, wong ah fook, ciq, bukit chagar, tasek, abad, sentosa, melodies |

**Ignore "nearby" lines** when finding the region, e.g. lines with "nearby", "周边", "附近" or "easy access".

### Parsing rules learned from real data (must follow)
- **Words in the text override saved fields.** Re-read the request text before matching.
  - A head containing `WTB`, `want to buy` or `求购` → buy.
  - A head containing `WTR`, `want to rent` or `求租` → rent.
- **Land requests:**
  - Text with `land`, `tanah`, `土地`, `地皮`, `acre(s)`, `ekar` or `英亩` → category Land.
  - Exception: "landed" means a house, not land.
  - If the text says factory/warehouse/kilang/厂房 and only mentions acres as the land size (e.g. "detach factory, land 6 acres"), it is a factory request, not land.
  - "factory land" or "industrial land" → Industrial Land only.
- **Commercial requests:** `shoplot`, `shop office`, `店面` or `门店` → Commercial, even when the text also says "2 storey". "2 storey shoplot" is a shop, not a terrace.
- **Industrial requests:** `factory`, `warehouse`, `kilang`, `厂房`, `工厂`, `找厂` or `仓库` → Industrial. But "car workshop 修车厂底楼店面" is a shop.
- **Budget parsing:**
  - `1m-2m` → 1,000,000 to 2,000,000.
  - `below 600k` / `以下` → up to that number.
  - `2000++` / `above` / `以上` → from that number upward.
  - `RM4.5k/month` → 4,500.
  - "budget follow market" / "open" → no budget.
- **Request areas:**
  - Generic words are NOT areas: Johor, JB, Johor Bahru, Malaysia, "area", "any", "other", "nearby".
  - Strip invisible characters (e.g. U+2060).
  - If the parser finds no area, recover it from the raw text using an area vocabulary built from all listings' titles and areas. Strip prefixes (Taman/Tmn/Bandar/Jalan/Jln/Kampung/Desa) and lot numbers, and drop generic property words.
  - Ignore signature lines (REN numbers, phone numbers, wasap.my or wa.me links, agency names) when recovering areas.

---

## 4. Search (Listing 搜索)

- **Filters:**
  - For sale / for rent;
  - category and type;
  - region (dropdowns three per row on mobile);
  - price range;
  - bedrooms;
  - source (EAG / TRR);
  - for Industrial only, built-up and land size ranges.
- **Keyword search is EXACT PHRASE:**
  - Searching `Johor Jaya` must match only listings containing "Johor Jaya" as consecutive whole words. Listings containing only "Jaya" must not show.
  - `molek` matches "Taman Molek", but `mole` does not.
  - Case-insensitive.
  - Check each field separately (title, area, region, agent name, agent phone, group, type, each feature), so words from two different fields never join up.
  - Chinese text is matched as a plain substring.
  - If the query has 4 or more digits, also match agent phone numbers using digits only.
- **Listing card:**
  - title, price (Rental 租金 RM x/mo or price), chips (kind, type, region, source), dimensions, land and built-up size, lot type, features, agent name and phone, group, posted date (with "today 今天");
  - expandable "Original WhatsApp message 原始讯息";
  - buttons: WhatsApp REN 联系经纪, Copy 复制资料, "N matching clients →".
- Keep the result list fast with 5,000+ listings. Precompute lowercase search text, render in pages, and never block the main thread.

---

## 5. Match (智能配对) — strict rules

A pair (listing, request) is shown ONLY if ALL of these are true:

1. **Kind:**
   - WTB matches for-sale listings.
   - WTR matches for-rent listings.
2. **Property type is exact.**
   - The listing's category must equal the request's category, and the listing's type must be in the request's types (if the request lists any).
   - If either side's type is unknown or "Other" → no match.
   - A shoplot never matches a factory; land never matches a condo.
3. **Area:**
   - The request must have at least one real area, after recovery (section 3).
   - No area → no match.
   - The area must appear in the listing's title, area or region as whole words (phrase match, same as search).
4. **Price** (only when the request has a budget):
   - **Rent:** budget ± RM2,000.
     - Budget 4,000 → listings RM2,000–6,000.
     - Budget 3,000–5,000 → RM1,000–7,000.
     - "Below 4,000" → up to RM6,000.
   - **Sale:** budget ± RM50,000.
     - Budget 500k → 450k–550k.
     - Budget 1m–2m → 950k–2.05m.
     - "Below 500k" → up to 550k.
   - If the request has a budget and the listing has no price → no match.
   - "Budget open" (no budget) → price is not checked.
5. **Bedrooms, bathrooms, bank value** (when stated): the listing must meet the minimum.

**Score (0–100), only for sorting:**
- area 30, type 15, price 30, plus bed, bath, furnishing and must-haves;
- inside the budget = full price points, inside the extra ± margin = half;
- show "✓ Within budget 符合预算" or "RM x over/below budget 超出/低于预算".
- Minimum score to show: 50.

**Performance:**
- Index listings by kind and sort them by price; use binary search on the price window.
- Run matching in ~12ms time slices with a generation token, so the UI never freezes.
- It must handle 1,000+ requests × 5,000+ listings.
- Load requests in batches; don't cap them at 1,000.

**Match tab UI:**
- **Two agent search boxes:**
  1. Listing agent name → that agent's listings and their matches.
  2. WTB/WTR agent name → that agent's requests and their matches.
- A general keyword box (exact phrase) as well.
- **Each pair card shows:**
  - score;
  - BUYER/TENANT and "Client of <agent>", budget;
  - the listing summary;
  - match reasons;
  - expandable "Listing original post 房源原文" and "WTB/WTR original post 需求原文";
  - buttons: Copy listing post, Copy WTB post, WhatsApp Client Agent, WhatsApp Listing Agent.

---

## 6. WhatsApp messages (wa.me links, plain text, strip emoji)

- A **"Your name"** box, saved in localStorage. A language toggle EN / 华语 placed **above the results**.
- **Listing page → WhatsApp REN:**
  - EN: `Hi, I'm {name} from TRREAG, may I know the listing below is it still available?` then a blank line and the original post.
  - 华语: `你好，我是 TRREAG 的 {name}，请问下面这个单位还有吗？` then the original post.
- **Match → WhatsApp Client Agent (to the WTB/WTR agent):**
  - EN: `Hi I'm {name} from TRREAG, i have a property might suite to ur client, if u interested pls let me know, tq`;
  - 华语: `你好，我是 TRREAG 的 {name}，我有一个单位可能适合你的客户，有兴趣的话请告诉我，谢谢。`;
  - then the **WTB/WTR original post**;
  - then a divider `━━━━━━━━━━━━━━━`;
  - then the **listing original post**.
- **Match → WhatsApp Listing Agent:** same as the listing page message.

---

## 7. Import page (Admin + Editor)

- Pick a file (`.zip`/`.txt`, no `accept` restriction so the iPhone Files/iCloud picker works).
- Show progress, then a summary: new listings, new requests, skipped duplicates, and messages that need review.
- Show an error if a file isn't a WhatsApp export.
- Show which Drive files were too big or failed in the scheduled import, with the advice: "Re-export **Without Media**, or upload it here manually."
- **Admin only:**
  - Backup (download all data as JSON);
  - Restore;
  - "Clear all import data" (with a typed confirmation).

---

## 8. Design

- **Gold "website" style:**
  - a hero cover image (`hero-bg.jpg`) with the EAG logo (`eag-logo.png`) and the title "EAG Listing Hub", centered;
  - the slogan "一站式房源…" under it;
  - the search panel overlaps the bottom of the hero image.
- **Highlights:** all selected buttons and tabs use shining gold with a moving light running around the border, plus a soft breathing glow.
  - Don't put the animation on the slogan.
  - Don't disable the animation for reduced-motion (the owner wants it visible on her phone).
- **Tabs:**
  - Admin: Listing 搜索 / 导入房源 Import / 买租需求 WTB/WTR / 智能配对 Match / 备份 Backup.
  - Editor: Search / Import / Match.
  - Viewer: Search / Match.
  - Tabs are NOT sticky; they must not cover listings while scrolling.
- **Performance:** no `backdrop-filter` and no fixed background (they lag on Android).
- **Layout:** mobile first (most users are on Android or iPhone), 16px side gutters, no horizontal scroll.
- **Installable PWA:** manifest, icons and a changeable app logo.

---

## 9. Suggested stack (adjust if the owner already has one)

- **Hosting:** the owner's existing site on Vercel, repo `JovelleDing/JovelleWebsite`, path `/listinghub`.
  - `/eag` already shows the pattern: Firebase Google login with an email allowlist, and an encrypted payload.
  - Reuse that auth, and add a silver "Listing Hub 房源配对" button there.
- **Database:** Firebase Firestore, with security rules enforcing admin / editor / viewer by email. Store listings in day-packs to keep reads cheap.
- **Scheduled import:** a server-side job (Vercel cron or a Cloud Function) at 12:00 and 21:00 MYT.
  - It reads new files from the shared Google Drive folder, using a service account that has access to that folder.
  - It parses them and writes to Firestore.
  - Keep any AI key server-side only.
- **Tests:** write node tests for the parser, phrase search and match rules using real (anonymised) sample messages, including every rule in sections 3–5. Run them before each deploy.

---

## 10. Acceptance checks

- Search `Johor Jaya` → no results that only contain "Jaya". Search `molek` → includes Taman Molek.
- "WTR Sutera Utama ground floor shoplot" → matches only Sutera Utama shop listings.
- "WTR Factory – Gelang Patah / SILC / Nusa Cemerlang / Other" → matches only factories in those areas, never a shoplot. "Other" is ignored as an area.
- "WTB Johor area 20–50 acres" → treated as land. "Johor area" is not an area, so no matches.
- "Buyer looking Pelangi or nearby, double storey" → only Pelangi double-storey terraces.
- Rent budget 4,000 → only listings RM2,000–6,000. Sale budget 500k → only 450k–550k.
- A Viewer cannot see Import, Backup or Clear, and cannot write to the database even through the console.
- Importing the same chat twice adds 0 new items.
