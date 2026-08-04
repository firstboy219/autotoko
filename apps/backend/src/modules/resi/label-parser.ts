/**
 * Pulls the shipping label's contents out of raw OCR text.
 *
 * Every field here is best-effort and every one of them can come back null.
 * That is deliberate: a shipping label has no standard layout — TikTok,
 * Shopee, Tokopedia and each courier all print a different arrangement, and
 * OCR then mangles it further. Guessing confidently would put wrong recipient
 * names and wrong order numbers into the operator's records, where they look
 * exactly as authoritative as correct ones.
 *
 * So: extract only what a clear anchor supports, return null otherwise, and
 * let the caller keep the raw text. A field left empty is a visible gap the
 * operator can fill; a field filled in wrongly is a silent error nobody looks
 * for. The waybill number itself never comes from here — it comes from the
 * barcode, which is exact.
 */

export interface ParsedLabelItem {
  name: string;
  qty: number;
}

export interface ParsedLabel {
  orderNo: string | null;
  recipient: string | null;
  marketplace: string | null;
  courier: string | null;
  items: ParsedLabelItem[];
}

const MARKETPLACES: ReadonlyArray<readonly [RegExp, string]> = [
  [/tiktok/i, "tiktok"],
  [/shopee/i, "shopee"],
  [/tokopedia/i, "tokopedia"],
  [/lazada/i, "lazada"],
  [/bukalapak/i, "bukalapak"],
  [/blibli/i, "blibli"],
];

const COURIERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bj&t\b|\bjnt\b|j\s?&\s?t\s?express/i, "J&T"],
  [/\bjne\b/i, "JNE"],
  [/spx|shopee\s?express/i, "SPX"],
  [/sicepat/i, "SiCepat"],
  [/anteraja/i, "Anteraja"],
  [/ninja/i, "Ninja"],
  [/lion\s?parcel/i, "Lion Parcel"],
  [/id\s?express/i, "ID Express"],
  [/\bpos\s?indonesia\b/i, "POS"],
];

/** "No. Pesanan", "Order ID", "No Invoice" and the like. */
const ORDER_LABEL_RE =
  /(?:no\.?\s*pesanan|nomor\s*pesanan|order\s*id|no\.?\s*order|invoice|no\.?\s*invoice)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{5,31})/i;

// The capture is (.*) not (.+) on purpose: Shopee prints "Penerima" alone on
// its line with the name underneath, and requiring content after the label
// meant that line never matched at all, so the next-line fallback below could
// never run.
const RECIPIENT_LABEL_RE =
  /(?:penerima|nama\s*penerima|kepada|recipient|received\s*by)\s*[:]?\s*(.*)/i;

/** "x2", "x 2", "2x", "2 pcs", "2 buah" trailing or leading a product line. */
const QTY_TRAILING_RE = /\s*[x×]\s*(\d{1,3})\s*$|\s+(\d{1,3})\s*(?:pcs|pc|buah|item|unit)\s*$/i;
const QTY_LEADING_RE = /^\s*(\d{1,3})\s*[x×]\s+/;

const ITEM_SECTION_RE = /^\s*(produk|barang|item|detail\s*pesanan|daftar\s*produk|isi\s*paket)\b/i;

/** Lines that are plainly not a product name. */
const NOT_ITEM_RE =
  /^(?:total|subtotal|ongkir|berat|weight|qty|jumlah|harga|price|catatan|note|alamat|address|telp|hp|no\.?\s*hp|kode\s*pos|penerima|pengirim|from|to)\b/i;

const MAX_ITEMS = 30;

function cleanLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parseMarketplace(text: string): string | null {
  for (const [re, name] of MARKETPLACES) if (re.test(text)) return name;
  return null;
}

function parseCourier(text: string): string | null {
  for (const [re, name] of COURIERS) if (re.test(text)) return name;
  return null;
}

function parseOrderNo(lines: string[]): string | null {
  for (const line of lines) {
    const m = line.match(ORDER_LABEL_RE);
    if (m?.[1]) {
      const v = m[1].trim().replace(/[.,;]$/, "");
      // A "number" of three characters is OCR noise, not an order id.
      if (v.length >= 6) return v;
    }
  }
  // TikTok prints a bare 18-19 digit order id, often on its own line with no
  // label at all. Long enough to be unambiguous; anything shorter is left
  // alone rather than risking a phone number or a waybill.
  for (const line of lines) {
    const m = cleanLine(line).match(/^(\d{18,19})$/);
    if (m?.[1]) return m[1];
  }
  return null;
}

function parseRecipient(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(RECIPIENT_LABEL_RE);
    if (!m) continue;
    let value = cleanLine(m[1] ?? "");
    // "Penerima:" alone on its line — the name is the next one.
    if (!value && i + 1 < lines.length) value = cleanLine(lines[i + 1] ?? "");
    // Strip a phone number that OCR ran onto the same line.
    value = value.replace(/\s*[-(]?\+?\d[\d\s().-]{7,}$/, "").trim();
    if (value.length >= 2 && value.length <= 120) return value;
  }
  return null;
}

function parseItems(lines: string[]): ParsedLabelItem[] {
  const items: ParsedLabelItem[] = [];
  let inSection = false;

  for (const raw of lines) {
    const line = cleanLine(raw);
    if (!line) continue;

    if (ITEM_SECTION_RE.test(line)) {
      inSection = true;
      // A header like "Produk: Kopi Gayo x2" carries the first item with it.
      const rest = line.replace(ITEM_SECTION_RE, "").replace(/^[\s:.-]+/, "");
      if (!rest) continue;
      const parsed = parseItemLine(rest);
      if (parsed) items.push(parsed);
      continue;
    }

    if (NOT_ITEM_RE.test(line)) {
      // "Total:" and friends end the product block on most layouts.
      if (/^total\b/i.test(line)) inSection = false;
      continue;
    }

    const parsed = parseItemLine(line);
    // Outside a product section, only take lines that carry an explicit
    // quantity — otherwise every address line becomes a "product".
    if (parsed && (inSection || parsed.explicit)) {
      items.push({ name: parsed.name, qty: parsed.qty });
    }
    if (items.length >= MAX_ITEMS) break;
  }

  // Same product read twice (OCR duplicates lines on curled labels).
  const seen = new Map<string, ParsedLabelItem>();
  for (const it of items) {
    const key = it.name.toLowerCase();
    const prev = seen.get(key);
    if (!prev || it.qty > prev.qty) seen.set(key, it);
  }
  return [...seen.values()];
}

function parseItemLine(line: string): { name: string; qty: number; explicit: boolean } | null {
  let working = line;
  let qty = 1;
  let explicit = false;

  const lead = working.match(QTY_LEADING_RE);
  if (lead?.[1]) {
    qty = Number(lead[1]);
    working = working.replace(QTY_LEADING_RE, "");
    explicit = true;
  } else {
    const trail = working.match(QTY_TRAILING_RE);
    if (trail) {
      qty = Number(trail[1] ?? trail[2] ?? 1);
      working = working.replace(QTY_TRAILING_RE, "");
      explicit = true;
    }
  }

  // Drop an ordinal prefix: "1. Kopi Gayo" -> "Kopi Gayo".
  working = working.replace(/^\s*\d{1,2}[.)]\s+/, "");
  const name = cleanLine(working);

  if (name.length < 3 || name.length > 120) return null;
  // A "name" that is only digits/punctuation is a stray number.
  if (!/[A-Za-z]{2}/.test(name)) return null;
  if (!Number.isFinite(qty) || qty < 1 || qty > 999) return null;

  return { name, qty, explicit };
}

export function parseShippingLabel(text: string): ParsedLabel {
  const empty: ParsedLabel = {
    orderNo: null,
    recipient: null,
    marketplace: null,
    courier: null,
    items: [],
  };
  if (!text || !text.trim()) return empty;

  const lines = text.split(/\r?\n/);
  return {
    orderNo: parseOrderNo(lines),
    recipient: parseRecipient(lines),
    marketplace: parseMarketplace(text),
    courier: parseCourier(text),
    items: parseItems(lines),
  };
}
