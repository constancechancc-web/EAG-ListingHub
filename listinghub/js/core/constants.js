// Fixed lists shared by the browser app, the server jobs and the tests.

export const CATEGORIES = ['Residential', 'Commercial', 'Industrial', 'Land'];

export const TYPES = [
  { id: 'Condo / Serviced Residence', cat: 'Residential', zh: '公寓' },
  { id: 'Apartment / Flat', cat: 'Residential', zh: '组屋/平价屋' },
  { id: 'Terrace (1–1.5 Storey)', cat: 'Residential', zh: '单层排屋' },
  { id: 'Terrace (2–2.5 Storey)', cat: 'Residential', zh: '双层排屋' },
  { id: 'Terrace (3+ Storey)', cat: 'Residential', zh: '三层排屋' },
  { id: 'Townhouse', cat: 'Residential', zh: '联排屋' },
  { id: 'Cluster House', cat: 'Residential', zh: '田字屋' },
  { id: 'Semi-D', cat: 'Residential', zh: '半独立' },
  { id: 'Bungalow', cat: 'Residential', zh: '独立洋房' },
  { id: 'Shop Office', cat: 'Commercial', zh: '店屋' },
  { id: 'Retail / Shop Lot', cat: 'Commercial', zh: '商铺' },
  { id: 'Office', cat: 'Commercial', zh: '办公室' },
  { id: 'Factory / Warehouse', cat: 'Industrial', zh: '厂房/仓库' },
  { id: 'Residential Land', cat: 'Land', zh: '住宅地' },
  { id: 'Commercial Land', cat: 'Land', zh: '商业地' },
  { id: 'Industrial Land', cat: 'Land', zh: '工业地' },
  { id: 'Agricultural Land', cat: 'Land', zh: '农业地' },
];
export const TYPE_ZH = Object.fromEntries(TYPES.map((t) => [t.id, t.zh]));
export const TYPE_CAT = Object.fromEntries(TYPES.map((t) => [t.id, t.cat]));
export const CATEGORY_ZH = { Residential: '住宅', Commercial: '商业', Industrial: '工业', Land: '土地', Other: '其他' };

export const T = {
  CONDO: 'Condo / Serviced Residence',
  APT: 'Apartment / Flat',
  TER1: 'Terrace (1–1.5 Storey)',
  TER2: 'Terrace (2–2.5 Storey)',
  TER3: 'Terrace (3+ Storey)',
  TOWN: 'Townhouse',
  CLUSTER: 'Cluster House',
  SEMID: 'Semi-D',
  BUNG: 'Bungalow',
  SHOPOFF: 'Shop Office',
  RETAIL: 'Retail / Shop Lot',
  OFFICE: 'Office',
  FACTORY: 'Factory / Warehouse',
  RLAND: 'Residential Land',
  CLAND: 'Commercial Land',
  ILAND: 'Industrial Land',
  ALAND: 'Agricultural Land',
};
export const LANDED_TYPES = [T.TER1, T.TER2, T.TER3, T.TOWN, T.CLUSTER, T.SEMID, T.BUNG];

// Regions in priority order: first match wins.
export const REGIONS = [
  ['Mount Austin', ['austin']],
  ['Molek / Daya', ['molek', 'taman daya']],
  ['Tebrau', ['tebrau', 'setia indah', 'bukit mutiara']],
  ['Permas Jaya', ['permas']],
  ['Johor Jaya', ['johor jaya']],
  ['Masai', ['masai', 'seri alam']],
  ['Pasir Gudang', ['pasir gudang', 'scientex', 'bistari']],
  ['Ulu Tiram', ['tiram', 'desa cemerlang', 'chellam', 'puteri wangsa']],
  ['Kulai', ['kulai', 'indahpura', 'saleng']],
  ['Senai', ['senai']],
  ['Bukit Indah', ['bukit indah']],
  ['Iskandar Puteri', ['iskandar', 'nusajaya', 'medini', 'puteri harbour', 'horizon hill', 'eco botanic', 'gelang patah', 'leisure farm']],
  ['Setia Tropika', ['setia tropika']],
  ['Kangkar Pulai', ['kangkar pulai', 'pulai indah', 'pulai utama', 'pulai jaya']],
  ['Skudai', ['skudai', 'tun aminah', 'universiti', 'mutiara rini', 'sri pulai', 'selesa jaya', 'uda']],
  ['Perling', ['perling']],
  ['Tampoi', ['tampoi']],
  ['Kempas', ['kempas']],
  ['Larkin', ['larkin']],
  ['Plentong', ['plentong']],
  ['JB Town', ['jb town', 'stulang', 'danga', 'century garden', 'pelangi', 'wong ah fook', 'ciq', 'bukit chagar', 'tasek', 'abad', 'sentosa', 'melodies']],
];
export const REGION_NAMES = REGIONS.map((r) => r[0]);

// Words that are never a real "area" in a request.
export const GENERIC_AREA_WORDS = [
  'johor', 'jb', 'johor bahru', 'johor baru', 'malaysia', 'area', 'areas', 'any', 'anywhere', 'other', 'others',
  'nearby', 'near', 'around', 'surrounding', 'all', 'any area', 'whole', 'nearby area', 'sekitar', 'kawasan',
  '附近', '周边', '一带', '任何', '其他', '新山', '柔佛', '地区', '区域',
];

// Prefixes stripped when building the area vocabulary.
export const AREA_PREFIXES = ['taman', 'tmn', 'bandar', 'bdr', 'jalan', 'jln', 'kampung', 'kg', 'desa'];

export const SOURCE_EAG = 'EAG Listing';
export const SOURCE_TRR = 'TRR Group';
export const SOURCE_CO = 'Co Agency';
export const SOURCES = [
  { id: SOURCE_EAG, label: 'EAG Listing', short: 'EAG' },
  { id: SOURCE_TRR, label: 'TRR Groups', short: 'TRR' },
  { id: SOURCE_CO, label: 'Co Agency', short: 'Co Agency' },
];

// Which WhatsApp group belongs to which source (matched as lowercase text inside the group name).
// First rule that matches wins; any group not listed is "Co Agency".
// The Admin can override a single group on the Backup page.
export const GROUP_SOURCE_RULES = [
  [SOURCE_EAG, ['eag 卓越']],
  [SOURCE_TRR, [
    'trr',            // JB TRR Rent 1, JB TRR 吹水站, TRR JB Sharing, TRR GV Land …
    'topsales',       // Topsales listing group (Only For Sales)
    'tms + eag',      // TMS + EAG Listing
    'tpg + eag',      // TPG + EAG listing group
    'tag + eag',      // TAG + EAG Listing Group
    'eat cobroke',    // EAT Cobroke Group
    'victor land',    // Victor Land Group 地皮买卖群
  ]],
];

// WhatsApp sender names that must be shown differently everywhere.
export const NAME_OVERRIDES = { '宝贝老公 hubby m': 'Roy Goh' };

export const RETENTION_DAYS = 90;
export const RENT_MARGIN = 2000;
export const SALE_MARGIN = 50000;
export const MIN_MATCH_SCORE = 50;
export const TZ = 'Asia/Kuala_Lumpur';
