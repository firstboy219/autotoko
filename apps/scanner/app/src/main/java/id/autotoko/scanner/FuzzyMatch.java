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
        Scored(ProductMatcher.Product p, double s) { this.product = p; this.score = s; }
    }

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
            double s = coverage(p.name, hay);
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
