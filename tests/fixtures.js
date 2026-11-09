// Anonymised sample messages modelled on real JB agent group posts.
export const L = {
  molekTerrace: `🏡 FOR SALE 🏡
Taman Molek, Jalan Molek 1/5
Double storey terrace
Corner lot, facing main road
Land 24x80 | Built up 2,200 sqft
4 bed 3 bath
Freehold, renovated
Price: RM 780k
Bank value RM 820k
Alan Tan REN 12345 012-345 6789`,

  johorJayaRent: `For Rent
Johor Jaya, Jalan Dedap
Double storey terrace 3r2b
Partially furnished
Rental RM 1,600/month
Call 0167778888`,

  jayaOnly: `For Rent 出租
Taman Bukit Jaya
Single storey terrace 3 rooms 2 baths
Rental: RM 1,200
Call 0161112222`,

  suteraShop: `FOR RENT - Sutera Utama
Ground floor shop lot, facing main road
Built up 1,540 sqft
Rental RM 4,500/month
Contact 0123456780`,

  suteraCondo: `For Rent
Sutera Utama, The Sutera condo
3 bed 2 bath fully furnished
Rental RM 2,000
wa.me/60198887777`,

  gelangFactory: `For Rent 出租
Gelang Patah detached factory
Land 2 acres, built up 30,000 sqft
Rental RM 45,000/month
0124445555`,

  gelangShop: `For rent
Gelang Patah shoplot ground floor
Rental RM 3,500
0124445556`,

  silcFactory: `FOR RENT
SILC Nusajaya semi-d factory
Built up 12,000 sqft
Rental RM 28,000
0124445557`,

  pelangiDouble: `For Sale
Taman Pelangi double storey terrace
Built-up 1,800 sqft
Price RM 950k
0172223333`,

  pelangiCondo: `For Sale
Pelangi Condo, Taman Pelangi
3r2b 1,200 sqft
Price RM 550k
0172223334`,

  austinRent4k: `For Rent
Mount Austin, Austin Heights double storey terrace
4 bed 3 bath fully furnished
Rental RM 4,000
0133334444`,

  austinRent6500: `For Rent
Austin Heights double storey terrace
Rental RM 6,500
0133334445`,

  austinSale500: `For Sale
Mount Austin double storey terrace
Price RM 520k
0133334446`,

  austinSale600: `For Sale
Mount Austin double storey terrace
Price RM 600k
0133334447`,

  johorLand: `For Sale 出售
Kota Tinggi agricultural land 30 acres
Price RM 3.5mil
0145556666`,
};

export const R = {
  suteraShop: `WTR Sutera Utama ground floor shoplot
Budget RM 5k
Kelly 0129990000`,
  factory: `WTR Factory – Gelang Patah / SILC / Nusa Cemerlang / Other
Built up 10k-40k sqft
Kelly 0129990001`,
  johorLand: `WTB Johor area 20–50 acres
Budget follow market`,
  pelangi: `Buyer looking Pelangi or nearby, double storey
Budget 1m`,
  austinRent4k: `WTR Mount Austin double storey terrace
Budget RM 4,000`,
  austinSale500: `WTB Mount Austin double storey
Budget 500k`,
};

/** Build a WhatsApp Android-format export from a list of [sender, text]. */
export function androidExport(items, day = '09/11/2026') {
  const out = [`${day}, 08:00 - Messages and calls are end-to-end encrypted. No one outside of this chat can read or listen to them.`];
  items.forEach(([sender, text], i) => {
    const mm = String(i % 60).padStart(2, '0');
    out.push(`${day}, 09:${mm} - ${sender}: ${text}`);
  });
  return out.join('\n');
}

export function iphoneExport(items, day = '09/11/2026') {
  const out = [`[${day}, 08:00:00] Group: ‎Messages and calls are end-to-end encrypted.`];
  items.forEach(([sender, text], i) => {
    const mm = String(i % 60).padStart(2, '0');
    out.push(`[${day}, 09:${mm}:15] ${sender}: ${text}`);
  });
  return out.join('\n');
}
