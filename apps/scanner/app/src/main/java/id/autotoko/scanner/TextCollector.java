package id.autotoko.scanner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Gathers readable lines of text from a moving camera.
 *
 * Same reasoning as LabelReader: one frame is a guess and several frames
 * disagreeing in different places is a correction. The difference is what gets
 * kept — LabelReader throws away everything that is not a product line on a
 * shipping label, which is exactly wrong here. A product's own packaging is
 * mostly the things that filter drops: weights, volumes, "isi 100ml".
 *
 * So the only filtering is on legibility, and the ranking is by how many frames
 * agreed — a name printed large and steady rises above a scrap of fine print
 * the camera caught once.
 */
final class TextCollector {

    /** Shorter than this and there is nothing to name anything after. */
    private static final int MIN_CHARS = 3;

    /** Share of words two readings must share to count as the same line. */
    private static final double SAME_LINE = 0.6;

    /** One sighting is noise; the second is what makes it a reading. */
    private static final int MIN_SIGHTINGS = 2;

    private static final int MAX_LINES = 12;

    private static final class Cluster {
        Set<String> words;
        String longest;
        int count;
    }

    private final List<Cluster> clusters = new ArrayList<>();
    private int frames = 0;

    void reset() {
        clusters.clear();
        frames = 0;
    }

    int frames() {
        return frames;
    }

    void addFrame(String text) {
        if (text == null || text.trim().isEmpty()) return;
        frames++;
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.replaceAll("\\s+", " ").trim();
            if (line.length() < MIN_CHARS) continue;
            // Needs at least one letter: a bare row of digits is a price or a
            // barcode, not a name for anything.
            if (!line.matches(".*[A-Za-z].*")) continue;
            absorb(line);
        }
    }

    /**
     * Words of a line, falling back to the whole line when it has none long
     * enough. "100 ML" has no word of three letters but is still one line, and
     * without the fallback every such reading would be its own cluster.
     */
    private static Set<String> keyOf(String line) {
        Set<String> words = LabelReader.words(line);
        if (!words.isEmpty()) return words;
        Set<String> one = new LinkedHashSet<>();
        one.add(line.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", ""));
        return one;
    }

    private void absorb(String line) {
        Set<String> w = keyOf(line);
        if (w.isEmpty()) return;
        for (Cluster c : clusters) {
            if (LabelReader.overlap(w, c.words) >= SAME_LINE) {
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

    /** Most-agreed first, then longest — the fullest reading of the steadiest line. */
    List<String> lines() {
        List<Cluster> keep = new ArrayList<>();
        for (Cluster c : clusters) if (c.count >= MIN_SIGHTINGS) keep.add(c);
        Collections.sort(keep, (a, b) -> {
            if (b.count != a.count) return Integer.compare(b.count, a.count);
            return Integer.compare(b.longest.length(), a.longest.length());
        });
        List<String> out = new ArrayList<>();
        for (Cluster c : keep) {
            out.add(c.longest);
            if (out.size() >= MAX_LINES) break;
        }
        return out;
    }
}
