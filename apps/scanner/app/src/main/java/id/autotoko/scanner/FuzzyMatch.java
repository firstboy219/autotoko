package id.autotoko.scanner;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Finding a product name in text OCR has chewed up.
 *
 * The earlier attempt asked for every word of a product's name to appear intact
 * somewhere in the reading. On these labels that never once succeeded: a real
 * capture reads "Reralus Swak Spey Mih / 100ML" for "Mouthspray Siwak 100ml"
 * and "RenalurB-Cardengar- Mergobai / 15ML" for a Renature line. Whole words
 * survive rarely; most survive with a letter dropped or swapped.
 *
 * So words are compared by how close they are rather than whether they are
 * equal, and a product is proposed when enough of its words have a near match
 * somewhere in the text. "siwak" against "swak" is one deletion and scores 0.8;
 * "100ml" is usually exact because digits survive better than letters.
 *
 * Still a proposal. The packer confirms, as they always have — the point is to
 * open the sheet with something in it rather than empty.
 */
public final class FuzzyMatch {

    /**
     * What this tenant has already answered, by kind.
     *
     * Static because three screens need it and none of them owns it: the scan
     * sheet, the delivery sheet and the history editors all ask the same
     * question of the same corrections. Loaded once per launch.
     */
    private static final java.util.Map<String, java.util.LinkedHashMap<String, String>> MEMORY =
            new java.util.HashMap<>();

    /** Replace everything learned for one kind. */
    public static void setMemory(String kind, java.util.LinkedHashMap<String, String> map) {
        MEMORY.put(kind, map);
    }

    /** Lower case, alphanumerics, single spaces — the key the server stores. */
    public static String memoryKey(String raw) {
        if (raw == null) return "";
        return raw.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    }

    /**
     * The answer already given to this reading, or null.
     *
     * Exact key first, then near keys: one label read twice is never
     * byte-identical but is close. The bar is high because a remembered answer
     * is trusted without any scoring against the catalogue.
     */
    public static String recall(String kind, String rawText) {
        java.util.LinkedHashMap<String, String> map = MEMORY.get(kind);
        if (map == null || map.isEmpty()) return null;
        String key = memoryKey(rawText);
        int floor = "courier".equals(kind) ? 3 : 4;
        if (key.length() < floor) return null;

        String exact = map.get(key);
        if (exact != null) return exact;

        String best = null;
        double bestSim = 0;
        for (java.util.Map.Entry<String, String> e : map.entrySet()) {
            double sim = similarity(key, e.getKey());
            if (sim > bestSim) { bestSim = sim; best = e.getValue(); }
        }
        return bestSim >= 0.85 ? best : null;
    }

    /** How close two words must be to count as the same word. */
    private static final double WORD_SIMILARITY = 0.72;
    /** How much of a product's name must be found before it is worth proposing. */
    private static final double NAME_COVERAGE = 0.5;
    /**
     * How far ahead of the next candidate the best must be.
     *
     * "Inhaler Regular Peppermint" and "Inhaler Minimalis Peppermint" share two
     * words of three. Without a margin the reading picks whichever sorted first,
     * which is a confident wrong answer — the failure this whole screen exists
     * to avoid.
     */
    private static final double MARGIN = 0.10;

    private FuzzyMatch() {}

    /** Lower case, letters and digits only, split on everything else. */
    public static List<String> tokens(String text) {
        List<String> out = new ArrayList<>();
        if (text == null) return out;
        for (String t : text.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
            if (t.length() >= 3) out.add(t);
        }
        return out;
    }

    /**
     * 0..1, by Levenshtein distance over the longer word.
     *
     * Deliberately not a phonetic algorithm: OCR errors are visual, not aural.
     * It reads "Swak" for "Siwak" because the i is thin, and "rn" for "m"
     * because they look alike — neither is something a sound-alike index helps
     * with.
     */
    public static double similarity(String a, String b) {
        if (a.equals(b)) return 1.0;
        int max = Math.max(a.length(), b.length());
        if (max == 0) return 0;
        return 1.0 - (double) distance(a, b) / max;
    }

    private static int distance(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] swap = prev;
            prev = cur;
            cur = swap;
        }
        return prev[b.length()];
    }

    /**
     * How much of `name` can be found among `haystack`, 0..1.
     *
     * Words shorter than four characters are skipped unless they carry digits:
     * "ml" and "spy" match half the label, while "50ml" and "100ml" are among
     * the most reliable tokens on it because digits survive OCR better than
     * letters do.
     */
    public static double coverage(String name, List<String> haystack) {
        List<String> words = tokens(name);
        int need = 0;
        int hit = 0;
        for (String w : words) {
            // Weighted by length, not counted per word. Counting words let a
            // product whose distinguishing word was short be judged on the
            // generic one alone: "Inhaler Duo" scored a perfect match against
            // "Inhaler Peppermint" because "duo" was skipped for being three
            // letters. A short word that fails should still cost something.
            need += w.length();
            for (String h : haystack) {
                if (similarity(w, h) >= WORD_SIMILARITY) { hit += w.length(); break; }
            }
        }
        return need == 0 ? 0 : (double) hit / need;
    }

    /** One catalogue entry and how well the reading supports it. */
    public static final class Scored {
        public final ProductMatcher.Product product;
        public final double score;
        public Scored(ProductMatcher.Product p, double s) { this.product = p; this.score = s; }
    }

    /**
     * The closest entry regardless of how poor the fit is.
     *
     * Used where the seller has asked for a field never to be left blank: an
     * unset picker meant the packer had to go looking for the product before
     * they could even start, and on a bench that is worse than a wrong default
     * they can see and change. Callers must show that it is a weak guess —
     * best() is still the one to use when the answer has to be trustworthy.
     */
    public static Scored closest(String text, List<ProductMatcher.Product> catalogue) {
        List<String> hay = tokens(text);
        if (catalogue.isEmpty()) return null;
        Scored top = null;
        for (ProductMatcher.Product p : catalogue) {
            double s = hay.isEmpty() ? 0 : coverage(p.name, hay);
            if (p.aliases != null && !p.aliases.isEmpty()) {
                for (String alias : p.aliases.split("\\r?\\n")) {
                    if (alias.trim().length() < 3) continue;
                    s = Math.max(s, coverage(alias, hay));
                }
            }
            if (top == null || s > top.score) top = new Scored(p, s);
        }
        return top;
    }

    /** True when a score is firm enough to present without a caveat. */
    public static boolean isConfident(double score) { return score >= NAME_COVERAGE; }

    /**
     * The catalogue entry this text is about, or null when it is not clear.
     *
     * Null rather than the best of a bad lot: on this screen an empty field
     * asks the packer a question and a wrong one answers it for them.
     */
    public static Scored best(String text, List<ProductMatcher.Product> catalogue) {
        List<String> hay = tokens(text);
        if (hay.isEmpty() || catalogue.isEmpty()) return null;

        Scored top = null;
        double second = 0;
        for (ProductMatcher.Product p : catalogue) {
            // Best of the internal name and every marketplace alias. A listing
            // title is often nothing like the name the seller uses internally,
            // and it is the title that is printed on the label.
            double s = coverage(p.name, hay);
            if (p.aliases != null && !p.aliases.isEmpty()) {
                for (String alias : p.aliases.split("\\r?\\n")) {
                    if (alias.trim().length() < 3) continue;
                    s = Math.max(s, coverage(alias, hay));
                }
            }
            if (top == null || s > top.score) {
                if (top != null) second = top.score;
                top = new Scored(p, s);
            } else if (s > second) {
                second = s;
            }
        }
        if (top == null || top.score < NAME_COVERAGE) return null;
        if (top.score - second < MARGIN) return null;
        return top;
    }
}
