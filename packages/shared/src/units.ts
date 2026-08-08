/**
 * Converting what arrived into what the recipe counts in.
 *
 * A supplier ships glycerine in a 1 kg jug and a 5 kg jug; the catalogue holds
 * glycerine in grams because that is what a recipe consumes. Somebody has to
 * turn one into the other, and until now that somebody was the packer, in their
 * head, into a box labelled only "gram". Typing 1 instead of 1000 there is not
 * an unlikely mistake — it is the obvious reading of "1 kg" — and it understates
 * the shelf by a factor of a thousand without anything looking wrong.
 *
 * Only mass and volume convert. Deliberately no density: millilitres of an oil
 * are not grams of it, and a table that quietly picked 1.0 would be wrong for
 * every material anyone actually buys.
 */

/** What a unit measures. Units of different kinds never convert. */
export type UnitKind = "mass" | "volume" | "count" | "unknown";

interface UnitDef {
  kind: UnitKind;
  /** How many base units (gram for mass, ml for volume) one of these is. */
  factor: number;
  /** What to show in a picker. */
  label: string;
}

/**
 * Spelling is not the packer's problem. The catalogue already holds "Pcs" and
 * "pcs" as separate strings, and a supplier writes "Kg", "KG" and "kilogram"
 * for the same jug, so everything is matched lowercased and trimmed.
 */
const UNITS: Record<string, UnitDef> = {
  // mass, base = gram
  mg: { kind: "mass", factor: 0.001, label: "mg" },
  miligram: { kind: "mass", factor: 0.001, label: "mg" },
  g: { kind: "mass", factor: 1, label: "gram" },
  gr: { kind: "mass", factor: 1, label: "gram" },
  gram: { kind: "mass", factor: 1, label: "gram" },
  grams: { kind: "mass", factor: 1, label: "gram" },
  ons: { kind: "mass", factor: 100, label: "ons" },
  kg: { kind: "mass", factor: 1000, label: "kg" },
  kilo: { kind: "mass", factor: 1000, label: "kg" },
  kilogram: { kind: "mass", factor: 1000, label: "kg" },
  ton: { kind: "mass", factor: 1_000_000, label: "ton" },

  // volume, base = ml
  ml: { kind: "volume", factor: 1, label: "ml" },
  mililiter: { kind: "volume", factor: 1, label: "ml" },
  milliliter: { kind: "volume", factor: 1, label: "ml" },
  cc: { kind: "volume", factor: 1, label: "ml" },
  l: { kind: "volume", factor: 1000, label: "liter" },
  lt: { kind: "volume", factor: 1000, label: "liter" },
  ltr: { kind: "volume", factor: 1000, label: "liter" },
  liter: { kind: "volume", factor: 1000, label: "liter" },
  litre: { kind: "volume", factor: 1000, label: "liter" },
  galon: { kind: "volume", factor: 19_000, label: "galon" },

  // count, base = one thing
  pcs: { kind: "count", factor: 1, label: "pcs" },
  pc: { kind: "count", factor: 1, label: "pcs" },
  buah: { kind: "count", factor: 1, label: "pcs" },
  unit: { kind: "count", factor: 1, label: "pcs" },
  biji: { kind: "count", factor: 1, label: "pcs" },
  lembar: { kind: "count", factor: 1, label: "lembar" },
  sheet: { kind: "count", factor: 1, label: "lembar" },
  label: { kind: "count", factor: 1, label: "label" },
  roll: { kind: "count", factor: 1, label: "roll" },
  botol: { kind: "count", factor: 1, label: "botol" },
  lusin: { kind: "count", factor: 12, label: "lusin" },
  dus: { kind: "count", factor: 1, label: "dus" },
  box: { kind: "count", factor: 1, label: "box" },
};

export function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? "").trim().toLowerCase().replace(/[.\s]+$/g, "");
}

export function unitKind(unit: string | null | undefined): UnitKind {
  const def = UNITS[normalizeUnit(unit)];
  return def ? def.kind : "unknown";
}

/**
 * Units the packer may sensibly enter for a material held in `target`.
 *
 * Ordered with the catalogue's own unit first, because most of the time the
 * label really does say what the catalogue says and the picker should not make
 * that the awkward choice.
 */
export function compatibleUnits(target: string | null | undefined): string[] {
  const t = normalizeUnit(target);
  const def = UNITS[t];
  if (!def) return t ? [t] : [];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (label: string) => {
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  };
  push(def.label);
  // A count is only ever itself: "lusin" converts to "pcs", but "botol" and
  // "roll" are not each other and offering them together invites a wrong pick.
  if (def.kind === "count") {
    if (def.label === "pcs" || def.label === "lusin") {
      push("pcs");
      push("lusin");
    }
    return out;
  }
  for (const d of Object.values(UNITS)) {
    if (d.kind === def.kind) push(d.label);
  }
  return out;
}

/**
 * `value` of unit `from`, expressed in unit `to`.
 *
 * Returns null when it cannot be done rather than a number that looks fine:
 * an unrecognised unit, or grams asked to become millilitres. The caller has to
 * decide what to do about that, and every caller here refuses the entry.
 */
export function convertUnit(
  value: number,
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  if (!Number.isFinite(value)) return null;

  const f = normalizeUnit(from);
  const t = normalizeUnit(to);

  // Same spelling, or the catalogue never stated a unit: nothing to convert,
  // and inventing a conversion for a blank unit would be worse than leaving
  // the number as the packer typed it.
  if (f === t) return value;
  if (!f || !t) return value;

  const a = UNITS[f];
  const b = UNITS[t];
  if (!a || !b) return null;
  if (a.kind !== b.kind) return null;

  return (value * a.factor) / b.factor;
}

/** True when the two units describe the same kind of thing. */
export function unitsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeUnit(a);
  const y = normalizeUnit(b);
  if (x === y) return true;
  if (!x || !y) return true;
  const da = UNITS[x];
  const db = UNITS[y];
  if (!da || !db) return false;
  return da.kind === db.kind;
}
