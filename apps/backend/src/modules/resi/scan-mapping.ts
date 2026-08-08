/**
 * Turning what a label says about its origin into something to point at.
 *
 * All of this is a suggestion and nothing here decides anything. The operator
 * confirms every field, because the failure that costs most on this screen is a
 * confident wrong match: a shop is the key the dashboard groups by, so one
 * parcel filed against the wrong account moves money in a report nobody will
 * think to question.
 */

/** The canonical courier names, matching label-parser's COURIERS. */
export const COURIER_NAMES = [
  "J&T",
  "JNE",
  "SPX",
  "SiCepat",
  "Anteraja",
  "Ninja",
  "Lion Parcel",
  "ID Express",
  "POS",
] as const;

/** Values the shops table's marketplace enum accepts, plus what labels call them. */
export const MARKETPLACES = ["shopee", "tokopedia", "tiktok", "lazada", "bukalapak"] as const;

const MARKETPLACE_ALIASES: Record<string, string> = {
  shopee: "shopee",
  spx: "shopee",
  "shopee express": "shopee",
  tokopedia: "tokopedia",
  tokped: "tokopedia",
  tiktok: "tiktok",
  "tiktok shop": "tiktok",
  tokoshop: "tiktok",
  lazada: "lazada",
  lzd: "lazada",
  bukalapak: "bukalapak",
  bl: "bukalapak",
};

/**
 * The marketplace a label's wording refers to, or null.
 *
 * Null rather than a best effort: the enum is closed, and writing a value the
 * shops table cannot hold would fail at the point of confirmation instead of
 * here, where there is still something to say about it.
 */
export function normaliseMarketplace(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (MARKETPLACE_ALIASES[key]) return MARKETPLACE_ALIASES[key]!;
  // A label prints "Shopee" inside a longer line more often than alone.
  for (const [alias, canonical] of Object.entries(MARKETPLACE_ALIASES)) {
    if (alias.length >= 4 && key.includes(alias)) return canonical;
  }
  return null;
}

/** Lowercased, punctuation stripped — how two shop names are compared. */
function normaliseName(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Which of the seller's shops a label's sender line most likely names.
 *
 * Word overlap rather than edit distance. OCR on these labels drops and swaps
 * characters freely — the earlier product matcher failed for exactly this
 * reason, keying on words that differed by one letter — but it rarely invents
 * or loses whole words, so the words two names share is the stable signal.
 *
 * Returns null unless the best candidate is clearly ahead. A wrong shop is
 * worse than an empty field: an empty field asks the operator a question, and a
 * wrong one answers it for them.
 */
export function matchShop(
  senderName: string | null | undefined,
  marketplace: string | null,
  shops: { id: string; name: string; marketplace: string | null }[],
): string | null {
  if (!senderName || !shops.length) return null;

  // A shop belongs to one marketplace, so knowing it removes most of the field
  // before any name is compared.
  const pool = marketplace ? shops.filter((s) => s.marketplace === marketplace) : shops;
  if (!pool.length) return null;
  if (pool.length === 1 && marketplace) return pool[0]!.id;

  const words = new Set(normaliseName(senderName).split(" ").filter((w) => w.length >= 3));
  if (!words.size) return null;

  let best: { id: string; score: number } | null = null;
  let runnerUp = 0;

  for (const shop of pool) {
    const shopWords = normaliseName(shop.name).split(" ").filter((w) => w.length >= 3);
    if (!shopWords.length) continue;
    let hits = 0;
    for (const w of shopWords) if (words.has(w)) hits++;
    const score = hits / shopWords.length;
    if (!best || score > best.score) {
      if (best) runnerUp = best.score;
      best = { id: shop.id, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!best || best.score < 0.5) return null;
  // Two shops matching equally well is not a guess, it is a coin toss. "Toko
  // Herbal Jaya" and "Toko Herbal Makmur" share two of three words.
  if (best.score - runnerUp < 0.25) return null;
  return best.id;
}
