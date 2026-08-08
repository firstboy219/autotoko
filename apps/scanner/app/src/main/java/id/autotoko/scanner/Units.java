package id.autotoko.scanner;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Turning what the box says into what the catalogue counts.
 *
 * A supplier ships glycerine in a 1 kg jug and a 5 kg jug; the catalogue holds
 * glycerine in grams, because grams is what a recipe consumes. Somebody has to
 * bridge that, and until now it was the packer, in their head, into a field
 * labelled only "gram". Typing 1 for a 1 kg jug is not carelessness — it is the
 * obvious reading of the label — and it credits the shelf with a thousandth of
 * what arrived, with nothing anywhere looking wrong afterwards.
 *
 * Mirrors packages/shared/src/units.ts. Kept as a copy rather than fetched,
 * because the sheet has to convert while the packer types and the phone is
 * routinely on a warehouse connection that a lookup cannot depend on.
 *
 * No density table on purpose: millilitres of an oil are not grams of it, and
 * a 1.0 that is right for water is wrong for everything anyone actually buys.
 */
public final class Units {

    public static final String MASS = "mass";
    public static final String VOLUME = "volume";
    public static final String COUNT = "count";
    public static final String UNKNOWN = "unknown";

    private static final class Def {
        final String kind;
        final double factor;
        final String label;

        Def(String kind, double factor, String label) {
            this.kind = kind;
            this.factor = factor;
            this.label = label;
        }
    }

    private static final Map<String, Def> UNITS = new HashMap<>();

    static {
        // mass, base = gram
        put("mg", MASS, 0.001, "mg");
        put("miligram", MASS, 0.001, "mg");
        put("g", MASS, 1, "gram");
        put("gr", MASS, 1, "gram");
        put("gram", MASS, 1, "gram");
        put("grams", MASS, 1, "gram");
        put("ons", MASS, 100, "ons");
        put("kg", MASS, 1000, "kg");
        put("kilo", MASS, 1000, "kg");
        put("kilogram", MASS, 1000, "kg");
        put("ton", MASS, 1000000, "ton");

        // volume, base = ml
        put("ml", VOLUME, 1, "ml");
        put("mililiter", VOLUME, 1, "ml");
        put("milliliter", VOLUME, 1, "ml");
        put("cc", VOLUME, 1, "ml");
        put("l", VOLUME, 1000, "liter");
        put("lt", VOLUME, 1000, "liter");
        put("ltr", VOLUME, 1000, "liter");
        put("liter", VOLUME, 1000, "liter");
        put("litre", VOLUME, 1000, "liter");
        put("galon", VOLUME, 19000, "galon");

        // count, base = one thing
        put("pcs", COUNT, 1, "pcs");
        put("pc", COUNT, 1, "pcs");
        put("buah", COUNT, 1, "pcs");
        put("unit", COUNT, 1, "pcs");
        put("biji", COUNT, 1, "pcs");
        put("lembar", COUNT, 1, "lembar");
        put("sheet", COUNT, 1, "lembar");
        put("label", COUNT, 1, "label");
        put("roll", COUNT, 1, "roll");
        put("botol", COUNT, 1, "botol");
        put("lusin", COUNT, 12, "lusin");
        put("dus", COUNT, 1, "dus");
        put("box", COUNT, 1, "box");
    }

    private static void put(String key, String kind, double factor, String label) {
        UNITS.put(key, new Def(kind, factor, label));
    }

    private Units() {}

    public static String normalize(String unit) {
        if (unit == null) return "";
        String u = unit.trim().toLowerCase(Locale.ROOT);
        while (u.endsWith(".") || u.endsWith(" ")) u = u.substring(0, u.length() - 1);
        return u;
    }

    public static String kindOf(String unit) {
        Def d = UNITS.get(normalize(unit));
        return d == null ? UNKNOWN : d.kind;
    }

    /**
     * What the packer may sensibly choose for a material held in `target`.
     *
     * The catalogue's own unit comes first, because most of the time the label
     * really does agree with it and that should not be the awkward pick.
     */
    public static List<String> compatible(String target) {
        String t = normalize(target);
        Def def = UNITS.get(t);
        Set<String> out = new LinkedHashSet<>();
        if (def == null) {
            if (!t.isEmpty()) out.add(t);
            return new ArrayList<>(out);
        }
        out.add(def.label);
        if (COUNT.equals(def.kind)) {
            // A count is only ever itself. "lusin" is twelve "pcs", but a
            // "botol" is not a "roll" and offering them together invites a
            // wrong pick that nothing downstream would catch.
            if ("pcs".equals(def.label) || "lusin".equals(def.label)) {
                out.add("pcs");
                out.add("lusin");
            }
            return new ArrayList<>(out);
        }
        for (Def d : UNITS.values()) {
            if (d.kind.equals(def.kind)) out.add(d.label);
        }
        return new ArrayList<>(out);
    }

    /**
     * `value` of unit `from`, expressed in `to`; null when it cannot be done.
     *
     * Null rather than a plausible number. Grams asked to become millilitres
     * has no answer without a density, and returning one anyway would put a
     * quantity of nothing on the shelf.
     */
    public static Double convert(double value, String from, String to) {
        if (Double.isNaN(value) || Double.isInfinite(value)) return null;

        String f = normalize(from);
        String t = normalize(to);

        // Same unit, or the catalogue never stated one: nothing to convert,
        // and inventing a conversion for a blank is worse than passing through.
        if (f.equals(t)) return value;
        if (f.isEmpty() || t.isEmpty()) return value;

        Def a = UNITS.get(f);
        Def b = UNITS.get(t);
        if (a == null || b == null) return null;
        if (!a.kind.equals(b.kind)) return null;

        return (value * a.factor) / b.factor;
    }

    /** "6.000 gram" — what the shelf will actually receive, spelled out. */
    public static String describe(Double qty, String unit) {
        if (qty == null) return "-";
        String n = qty == Math.floor(qty) && !Double.isInfinite(qty)
                ? String.format(Locale.GERMAN, "%,.0f", qty)
                : String.format(Locale.GERMAN, "%,.3f", qty);
        return unit == null || unit.isEmpty() ? n : n + " " + unit;
    }
}
