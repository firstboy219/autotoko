package id.autotoko.scanner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Builds one reading of a label out of many camera frames.
 *
 * This is the whole reason reading on the phone beats reading on the server.
 * The server gets one JPEG and one attempt: a digit misread there is misread
 * for good. The phone sees the same label twenty times in the second the
 * packer holds it still, and the errors are not the same twice — so the
 * agreement between frames is itself the correction.
 *
 * Order numbers are voted position by position, not as whole strings. Whole
 * strings hardly ever match exactly at this print size, while the individual
 * digits are right in most frames; taking the commonest character at each
 * position rebuilds a number that no single frame actually reported.
 *
 * Product titles are CLUSTERED by similarity rather than matched exactly. An
 * earlier version keyed them on their words, which failed for the obvious
 * reason once tested: one letter of drift — "mouthspray" read as "mouthsprav"
 * — split a title into two readings, neither of which then reached the
 * threshold, and no product was ever recognised. Lines that share most of
 * their words are one line.
 */
public final class LabelReader {

    /** Order ids on these labels run 18-19 digits; the range is deliberately loose. */
    private static final int ID_MIN = 14;
    private static final int ID_MAX = 22;

    /** Seen in fewer frames than this and it is one frame's noise, not a reading. */
    private static final int MIN_SIGHTINGS = 2;

    /** A listing title is long. Anything shorter is an address or a heading. */
    private static final int MIN_LINE_CHARS = 12;

    /** Share of words two readings must have in common to be the same line. */
    private static final double SAME_LINE = 0.55;

    private static final Pattern ORDER_ANCHOR = Pattern.compile(
            "(?:order\\s*id|no\\.?\\s*pesanan|nomor\\s*pesanan|no\\.?\\s*order|invoice)"
                    + "\\s*[:#.]?\\s*([0-9][0-9\\s-]{" + (ID_MIN - 1) + "," + (ID_MAX * 2) + "})",
            Pattern.CASE_INSENSITIVE);

    /**
     * Package ids sit right beside the order id and are LONGER — 19 digits
     * against 18 on every label seen. Without pulling them out first, a
     * tie-break that prefers the longer run returns the package id every time,
     * which is exactly what happened before this pattern existed.
     */
    private static final Pattern PACKAGE_ANCHOR = Pattern.compile(
            "package\\s*id\\s*[:#.]?\\s*([0-9][0-9\\s-]{" + (ID_MIN - 1) + "," + (ID_MAX * 2) + "})",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern BARE_ID =
            Pattern.compile("(?<![0-9])([0-9]{" + ID_MIN + "," + ID_MAX + "})(?![0-9])");

    private static final Pattern NOT_PRODUCT = Pattern.compile(
            "^(?:product\\s*name|nama\\s*produk|penerima|pengirim|order\\s*id|package\\s*id|"
                    + "nick\\s*name|qty|jumlah|total|berat|weight|wght|ship|in\\s*transit|"
                    + "estimated|alamat|jl\\.?|jalan|desa|dusun|kec\\.?|kel\\.?|rt\\s*\\d|"
                    + "cod|non\\s*cod|seller\\s*sku|sku)\\b",
            Pattern.CASE_INSENSITIVE);

    public static final class Line {
        public final String text;
        public final int sightings;

        Line(String text, int sightings) {
            this.text = text;
            this.sightings = sightings;
        }
    }

    private static final class Cluster {
        Set<String> words;
        String longest;
        int count;
    }

    /** Anchored sightings are trusted over bare digit runs; see PACKAGE_ANCHOR. */
    private final List<String> anchored = new ArrayList<>();
    private final List<String> bare = new ArrayList<>();
    private final List<Cluster> clusters = new ArrayList<>();
    private String longestText = "";
    private int frames = 0;

    public void reset() {
        anchored.clear();
        bare.clear();
        clusters.clear();
        longestText = "";
        frames = 0;
    }

    public int frames() { return frames; }

    /** The single fullest frame, kept for the record rather than for parsing. */
    public String rawText() { return longestText; }

    public void addFrame(String text) {
        if (text == null || text.trim().isEmpty()) return;
        frames++;
        if (text.length() > longestText.length()) longestText = text;

        // One frame is one sighting, however many patterns happen to match it.
        // Counting every regex hit separately made a single frame look like two
        // independent readings and defeated the whole threshold.
        Set<String> anchoredHere = new LinkedHashSet<>();
        Set<String> bareHere = new LinkedHashSet<>();
        Set<String> packageIds = new LinkedHashSet<>();

        Matcher pkg = PACKAGE_ANCHOR.matcher(text);
        while (pkg.find()) {
            String d = digits(pkg.group(1));
            if (d != null) packageIds.add(d);
        }
        Matcher ord = ORDER_ANCHOR.matcher(text);
        while (ord.find()) {
            String d = digits(ord.group(1));
            if (d != null && !packageIds.contains(d)) anchoredHere.add(d);
        }
        Matcher any = BARE_ID.matcher(text.replaceAll("[ \\-]", ""));
        while (any.find()) {
            String d = any.group(1);
            if (!packageIds.contains(d) && !anchoredHere.contains(d)) bareHere.add(d);
        }
        anchored.addAll(anchoredHere);
        bare.addAll(bareHere);

        for (String raw : text.split("\\r?\\n")) {
            String line = raw.replaceAll("\\s+", " ").trim();
            if (line.length() < MIN_LINE_CHARS) continue;
            if (NOT_PRODUCT.matcher(line).find()) continue;
            // Needs real words, not a row of codes.
            if (line.replaceAll("[^A-Za-z]", "").length() < 8) continue;
            absorb(line);
        }
    }

    private static String digits(String s) {
        String d = s.replaceAll("[^0-9]", "");
        return (d.length() >= ID_MIN && d.length() <= ID_MAX) ? d : null;
    }

    static Set<String> words(String line) {
        Set<String> out = new LinkedHashSet<>();
        String flat = line.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
        if (flat.isEmpty()) return out;
        for (String w : flat.split(" ")) if (w.length() >= 3) out.add(w);
        return out;
    }

    static double overlap(Set<String> a, Set<String> b) {
        if (a.isEmpty() || b.isEmpty()) return 0;
        int hit = 0;
        for (String w : a) if (b.contains(w)) hit++;
        // Against the smaller set: one frame often clips the tail of a long
        // title, and a clipped reading is still the same line.
        return hit / (double) Math.min(a.size(), b.size());
    }

    private void absorb(String line) {
        Set<String> w = words(line);
        if (w.size() < 2) return;
        for (Cluster c : clusters) {
            if (overlap(w, c.words) >= SAME_LINE) {
                c.count++;
                if (line.length() > c.longest.length()) {
                    c.longest = line;
                    c.words = w;
                }
                return;
            }
        }
        Cluster c = new Cluster();
        c.words = w;
        c.longest = line;
        c.count = 1;
        clusters.add(c);
    }

    /**
     * The order number the frames agree on, or null.
     *
     * Anchored sightings win outright when there are enough of them: a run of
     * digits that followed the words "Order Id" is evidence a bare run on some
     * other part of the label simply does not have.
     *
     * Length is decided first by majority, then each position separately.
     * Mixing lengths would align the wrong digits against each other and
     * produce a number worse than any single frame's guess.
     */
    public String orderNo() {
        String fromAnchor = vote(anchored);
        if (fromAnchor != null) return fromAnchor;
        return vote(bare);
    }

    private static String vote(List<String> candidates) {
        if (candidates.size() < MIN_SIGHTINGS) return null;

        Map<Integer, Integer> lengths = new LinkedHashMap<>();
        for (String c : candidates) {
            Integer n = lengths.get(c.length());
            lengths.put(c.length(), n == null ? 1 : n + 1);
        }
        int bestLen = -1, bestVotes = 0;
        for (Map.Entry<Integer, Integer> e : lengths.entrySet()) {
            if (e.getValue() > bestVotes || (e.getValue() == bestVotes && e.getKey() > bestLen)) {
                bestLen = e.getKey();
                bestVotes = e.getValue();
            }
        }
        if (bestVotes < MIN_SIGHTINGS) return null;

        List<String> agreed = new ArrayList<>();
        for (String c : candidates) if (c.length() == bestLen) agreed.add(c);

        StringBuilder out = new StringBuilder();
        for (int i = 0; i < bestLen; i++) {
            int[] tally = new int[10];
            for (String c : agreed) tally[c.charAt(i) - '0']++;
            int digit = 0;
            for (int d = 1; d < 10; d++) if (tally[d] > tally[digit]) digit = d;
            out.append((char) ('0' + digit));
        }
        return out.toString();
    }

    /** How many frames backed the winning order number, for the confidence shown. */
    public int orderSightings() {
        String no = orderNo();
        if (no == null) return 0;
        List<String> pool = vote(anchored) != null ? anchored : bare;
        int n = 0;
        for (String c : pool) if (c.length() == no.length()) n++;
        return n;
    }

    /** Candidate product lines, the most-agreed first. */
    public List<Line> productLines() {
        List<Line> out = new ArrayList<>();
        for (Cluster c : clusters) {
            if (c.count < MIN_SIGHTINGS) continue;
            out.add(new Line(c.longest, c.count));
        }
        Collections.sort(out, (a, b) -> Integer.compare(b.sightings, a.sightings));
        return out;
    }
}
