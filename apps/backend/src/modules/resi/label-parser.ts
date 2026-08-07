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
 *
 * The field list comes from reading real photographs rather than from the
 * marketplaces' documentation: a J&T/Tokopedia label prints the sending shop
 * and its city, the recipient with area and street address, the service level,
 * weight, COD flag, the courier's sortation code, the order and package ids,
 * the buyer's nickname, a product table and a total quantity. All of it is
 * recorded, whether it arrives from OCR or from the operator's keyboard.
 */

export interface ParsedLabelItem {
  name: string;
  qty: number;
}

export interface ParsedLabel {
  orderNo: string | null;
  recipient: string | null;
  recipientArea: string | null;
  recipientAddress: string | null;
  senderName: string | null;
  senderArea: string | null;
  marketplace: string | null;
  courier: string | null;
  service: string | null;
  weightKg: number | null;
  cod: boolean | null;
  sortCode: string | null;
  packageId: string | null;
  buyerNickname: string | null;
  qtyTotal: number | null;
  shipDate: string | null;
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

/**
 * Service levels, matched only as a standalone word near the top of the label.
 * A closed list on purpose: these are two- and three-letter tokens and OCR
 * produces plenty of those from barcode edges, so anything not on the list is
 * left alone rather than recorded as a service the courier does not offer.
 */
// No "EXPRESS": half the couriers have it in their brand name -- J&T Express,
// ID Express, Ninja Express -- so it identifies the carrier far more often
// than the service, and a real label prints both words side by side.
const SERVICES = [
  "ECO", "EZ", "REG", "OKE", "YES", "JTR", "CTC", "CTCX", "STD", "HEMAT",
  "NEXTDAY", "SAMEDAY", "INSTANT", "CARGO", "BOSSPACK", "SPS", "BEST",
];
const SERVICE_SCAN_LINES = 8;

/** "No. Pesanan", "Order ID", "No Invoice" and the like. */
const ORDER_LABEL_RE =
  /(?:no\.?\s*pesanan|nomor\s*pesanan|order\s*id|no\.?\s*order|invoice|no\.?\s*invoice)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{5,31})/i;

// The capture is (.*) not (.+) on purpose: Shopee prints "Penerima" alone on
// its line with the name underneath, and requiring content after the label
// meant that line never matched at all, so the next-line fallback below could
// never run.
const RECIPIENT_LABEL_RE =
  /(?:penerima|nama\s*penerima|kepada|recipient|received\s*by)\s*[:]?\s*(.*)/i;

// No "dari": it is one of the commonest words in Indonesian and turns up in
// the middle of addresses ("800m dari Simpang Anak Air"), which would make the
// landmark in someone's address the name of the sending shop.
const SENDER_LABEL_RE = /(?:pengirim|nama\s*pengirim|shipper|sender)\s*[:]?\s*(.*)/i;

/**
 * "SUMATERA BARAT,BUKITTINGGI,MANDIANGIN KOTO SELAYAN" — the province/city/
 * district line the courier prints under the name. Recognised by shape rather
 * than by a keyword, because it never carries one: mostly capitals, at least
 * one comma, and no long digit runs.
 */
const AREA_RE = /^[A-Z][A-Z .'\/-]*(?:,[A-Z .'\/-]+){1,4}$/;

/** A street line: "Jl. Anak Air No.60 ...", "Toko aditya ,desa rawi rt03rw01". */
const ADDRESS_HINT_RE =
  /\b(?:jl\.?|jalan|desa|dusun|kel\.?|kelurahan|kec\.?|kecamatan|perum|gang|gg\.?|blok|rt\s*\d|rw\s*\d|no\.?\s*\d)\b/i;

/** J&T's destination sortation code: "260-BKH08-05", "268-BTT03B-01E". */
const SORT_CODE_RE = /\b(\d{3}-[A-Z]{2,5}\d{1,3}[A-Z]?-\d{1,3}[A-Z]?)\b/;

const PACKAGE_ID_RE = /package\s*id\s*[:.#]?\s*(\d{8,25})/i;
const NICKNAME_RE = /nick\s*name\s*[:.#]?\s*(.+)/i;
const QTY_TOTAL_RE = /qty\s*total\s*[:.#]?\s*(\d{1,4})\b/i;
const WEIGHT_RE = /(?:wght|weight|berat)\s*[:.]?\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(kg|gr|g)\b/i;
const SHIP_DATE_RE =
  /(?:\bship\b|tgl\.?\s*kirim|tanggal\s*kirim|in\s*transit\s*by)\s*[:.]?\s*(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/i;

/** "x2", "x 2", "2x", "2 pcs", "2 buah" trailing or leading a product line. */
const QTY_TRAILING_RE = /\s*[x×]\s*(\d{1,3})\s*$|\s+(\d{1,3})\s*(?:pcs|pc|buah|item|unit)\s*$/i;
const QTY_LEADING_RE = /^\s*(\d{1,3})\s*[x×]\s+/;

const ITEM_SECTION_RE =
  /^\s*(produk|barang|item|product\s*name|detail\s*pesanan|daftar\s*produk|isi\s*paket)\b/i;

/** Lines that are plainly not a product name. */
const NOT_ITEM_RE =
  /^(?:total|subtotal|ongkir|berat|weight|qty|jumlah|harga|price|catatan|note|alamat|address|telp|hp|no\.?\s*hp|kode\s*pos|penerima|pengirim|from|to|order\s*id|package\s*id|nick\s*name|in\s*transit|estimated)\b/i;

const MAX_ITEMS = 30;

function cleanLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** OCR runs phone numbers onto the end of name lines constantly. */
function stripPhone(s: string): string {
  return s.replace(/\s*[-(]?\+?\d[\d\s().*-]{7,}$/, "").trim();
}

/**
 * Leading junk: the label's own vertical rules and the box behind it come
 * through as a few stray characters before the real value.
 */
function stripLeadingNoise(s: string): string {
  return s.replace(/^[^A-Za-z0-9]+/, "").trim();
}

function parseMarketplace(text: string): string | null {
  for (const [re, name] of MARKETPLACES) if (re.test(text)) return name;
  return null;
}

function parseCourier(text: string): string | null {
  for (const [re, name] of COURIERS) if (re.test(text)) return name;
  return null;
}

function parseService(lines: string[]): string | null {
  for (const raw of lines.slice(0, SERVICE_SCAN_LINES)) {
    // The carrier's own name goes first. "J&T EXPRESS ECO" is a brand and a
    // service on one line, and scanning left to right without this returns the
    // brand -- which is what a test on a real label caught.
    let line = cleanLine(raw);
    for (const [re] of COURIERS) line = line.replace(re, " ");
    for (const token of line.split(/[^A-Za-z]+/)) {
      const up = token.toUpperCase();
      if (SERVICES.includes(up)) return up;
    }
  }
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

/** The name on a "Penerima:"/"Pengirim:" line, or the line under it. */
function parseParty(lines: string[], labelRe: RegExp): { name: string | null; at: number } {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(labelRe);
    if (!m) continue;
    let value = stripLeadingNoise(cleanLine(m[1] ?? ""));
    if (!value && i + 1 < lines.length) value = stripLeadingNoise(cleanLine(lines[i + 1] ?? ""));
    value = stripPhone(value);
    if (value.length >= 2 && value.length <= 120) return { name: value, at: i };
    return { name: null, at: i };
  }
  return { name: null, at: -1 };
}

/**
 * The province/city/district line, looked for in the few lines following the
 * name it belongs to. Bounded on purpose: searching the whole label would
 * happily attach the sender's area to the recipient.
 */
function parseArea(lines: string[], from: number, until = Number.MAX_SAFE_INTEGER): string | null {
  if (from < 0) return null;
  const end = Math.min(lines.length, from + 4, until);
  for (let i = from; i < end; i++) {
    const line = stripLeadingNoise(cleanLine(lines[i] ?? ""));
    if (AREA_RE.test(line) && line.length <= 200) return line;
  }
  return null;
}

function parseAddress(lines: string[], from: number): string | null {
  if (from < 0) return null;
  const parts: string[] = [];
  for (let i = from; i < Math.min(lines.length, from + 6); i++) {
    const line = stripLeadingNoise(cleanLine(lines[i] ?? ""));
    if (!line || AREA_RE.test(line)) continue;
    if (NOT_ITEM_RE.test(line)) continue;
    if (ADDRESS_HINT_RE.test(line)) parts.push(line);
  }
  if (!parts.length) return null;
  return parts.join(" ").slice(0, 400);
}

/**
 * COD is a single word in large type and matters commercially, so it is worth
 * reading — but only as a standalone all-caps token. Lower-case "cod" turns up
 * inside ordinary words, and this label prints it nowhere else.
 */
function parseCod(text: string): boolean | null {
  if (/\bNON\s*-?\s*COD\b/.test(text)) return false;
  if (/\bCOD\b/.test(text)) return true;
  return null;
}

function parseWeight(text: string): number | null {
  const m = text.match(WEIGHT_RE);
  if (!m?.[1]) return null;
  const value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const kg = /^k/i.test(m[2] ?? "") ? value : value / 1000;
  // A parcel over a tonne is a misread decimal point, not a parcel.
  return kg > 0 && kg < 1000 ? Number(kg.toFixed(3)) : null;
}

function firstMatch(text: string, re: RegExp, max: number): string | null {
  const m = text.match(re);
  const v = m?.[1] ? cleanLine(m[1]).replace(/[.,;|]+$/, "") : "";
  return v.length >= 1 && v.length <= max ? v : null;
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
      if (/^(?:total|qty\s*total)\b/i.test(line)) inSection = false;
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

export const EMPTY_LABEL: ParsedLabel = {
  orderNo: null,
  recipient: null,
  recipientArea: null,
  recipientAddress: null,
  senderName: null,
  senderArea: null,
  marketplace: null,
  courier: null,
  service: null,
  weightKg: null,
  cod: null,
  sortCode: null,
  packageId: null,
  buyerNickname: null,
  qtyTotal: null,
  shipDate: null,
  items: [],
};

/**
 * The parsed label as resi_scans columns.
 *
 * One place on purpose: the background reader and the on-demand re-read both
 * write these, and if they disagreed about which columns a reading owns, a
 * re-read would leave a field behind carrying the previous photo's answer.
 */
export function labelColumns(parsed: ParsedLabel) {
  return {
    labelOrderNo: parsed.orderNo?.slice(0, 128) ?? null,
    labelRecipient: parsed.recipient?.slice(0, 255) ?? null,
    labelRecipientArea: parsed.recipientArea?.slice(0, 200) ?? null,
    labelRecipientAddress: parsed.recipientAddress?.slice(0, 400) ?? null,
    labelSenderName: parsed.senderName?.slice(0, 160) ?? null,
    labelSenderArea: parsed.senderArea?.slice(0, 160) ?? null,
    labelMarketplace: parsed.marketplace?.slice(0, 32) ?? null,
    labelService: parsed.service?.slice(0, 32) ?? null,
    labelWeightKg: parsed.weightKg != null ? parsed.weightKg.toFixed(3) : null,
    labelCod: parsed.cod,
    labelSortCode: parsed.sortCode?.slice(0, 48) ?? null,
    labelPackageId: parsed.packageId?.slice(0, 64) ?? null,
    labelBuyerNickname: parsed.buyerNickname?.slice(0, 120) ?? null,
    labelQtyTotal: parsed.qtyTotal != null ? parsed.qtyTotal.toFixed(2) : null,
    labelShipDate: parsed.shipDate?.slice(0, 32) ?? null,
    labelItems: parsed.items.length ? parsed.items : null,
  };
}

/**
 * A later reading may only ADD to an earlier one.
 *
 * The background reader now runs after the scanner app has already had a go,
 * from dozens of live frames at full sensor resolution against one JPEG — so
 * it routinely finds less. Overwriting column by column would mean the
 * server's thinner pass erased the phone's order number every time. A machine
 * re-read that finds nothing should change nothing.
 *
 * Clearing a wrong value is still possible: the operator's own edit form
 * writes nulls directly and is not routed through here.
 */
export function mergeLabelColumns(
  existing: Record<string, unknown>,
  parsed: ParsedLabel,
): Record<string, unknown> {
  const fresh = labelColumns(parsed) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fresh)) {
    const had = existing[key];
    out[key] = value == null && had != null ? had : value;
  }
  return out;
}

export function parseShippingLabel(text: string): ParsedLabel {
  if (!text || !text.trim()) return { ...EMPTY_LABEL };

  const lines = text.split(/\r?\n/);
  const recipient = parseParty(lines, RECIPIENT_LABEL_RE);
  const sender = parseParty(lines, SENDER_LABEL_RE);

  return {
    orderNo: parseOrderNo(lines),
    recipient: recipient.name,
    recipientArea: parseArea(lines, recipient.at),
    recipientAddress: parseAddress(lines, recipient.at),
    senderName: sender.name,
    // Stop at the recipient's line: without the bound, a sender with no area
    // printed under it happily adopts the recipient's province.
    senderArea: parseArea(lines, sender.at, recipient.at >= 0 ? recipient.at : undefined),
    marketplace: parseMarketplace(text),
    courier: parseCourier(text),
    service: parseService(lines),
    weightKg: parseWeight(text),
    cod: parseCod(text),
    sortCode: firstMatch(text, SORT_CODE_RE, 48),
    packageId: firstMatch(text, PACKAGE_ID_RE, 64),
    buyerNickname: firstMatch(text, NICKNAME_RE, 120),
    qtyTotal: (() => {
      const v = firstMatch(text, QTY_TOTAL_RE, 8);
      const n = v == null ? NaN : Number(v);
      return Number.isFinite(n) && n > 0 && n <= 9999 ? n : null;
    })(),
    shipDate: firstMatch(text, SHIP_DATE_RE, 32),
    items: parseItems(lines),
  };
}
