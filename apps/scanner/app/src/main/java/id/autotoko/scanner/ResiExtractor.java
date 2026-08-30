package id.autotoko.scanner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Pulls waybill-number candidates out of whatever OCR read off a label.
 *
 * This deliberately returns a RANKED LIST rather than one answer. A shipping
 * label is a dense page of digits — the buyer's phone number, the order id,
 * the postcode, the shipping fee — and OCR has no idea which of them is the
 * resi. Committing to a single guess would silently record the wrong number,
 * and because the server refuses duplicates, a wrong record is worse than no
 * record: it burns a key the correct parcel may later need. So the app shows
 * the best guess plus the runners-up and a human confirms.
 *
 * Everything here is pure and side-effect free precisely so it can be unit
 * tested on the JVM — there is no way to run OCR itself in a test, so the
 * parsing logic is the part that has to be provably right.
 */
public final class ResiExtractor {

    private ResiExtractor() {}

    public static final class Candidate {
        public final String value;   // normalised; this is what gets submitted
        public final String raw;     // as it appeared on screen, for display
        public final int score;
        public final String courier; // null when nothing recognisable

        Candidate(String value, String raw, int score, String courier) {
            this.value = value;
            this.raw = raw;
            this.score = score;
            this.courier = courier;
        }

        @Override public String toString() { return value + "(" + score + ")"; }
    }

    private static final String[] HINTS = {
        "RESI", "AWB", "TRACKING", "WAYBILL", "AIRWAYBILL", "NOMOR RESI", "NO RESI"
    };

    /**
     * Awalan terpanjang lebih dulu, supaya SPXID menang atas SPX.
     *
     * JY dan MY ditambahkan dari data, bukan dari daftar resmi: 241 scan
     * berawalan JY dikonfirmasi manusia sebagai J&T sementara deteksi
     * otomatisnya kosong, dan MY satu kali. Sebelum ini daftarnya hanya
     * mengenali JX -- yang muncul 3 kali dari 312.
     */
    private static final String[][] COURIERS = {
        {"SPXID", "SPX"},
        {"JY", "J&T"},
        {"MY", "J&T"},
        {"NLID", "Ninja"},
        {"10000", "Anteraja"},
        {"JNE", "JNE"},
        {"CGK", "JNE"},
        {"TLS", "JNE"},
        {"IDX", "ID Express"},
        {"IDE", "ID Express"},
        {"SPX", "SPX"},
        {"JX", "J&T"},
        {"JP", "J&T"},
        {"JT", "J&T"},
        {"LP", "Lion Parcel"},
        {"SC", "SiCepat"},
    };

    /**
     * Awalan yang jelas nomor pengiriman tapi kurirnya TIDAK bisa dipastikan.
     *
     * CM muncul 17 kali dan manusia menyebutnya J&T delapan kali dan JNE enam
     * kali. Menebak salah satunya berarti menuliskan kurir yang salah pada
     * hampir separuh paket; yang bisa dipastikan hanyalah bahwa ia nomor
     * pengiriman, dan itu saja sudah cukup untuk memenangkannya atas nomor
     * pesanan saat memilih resi.
     */
    private static final String[] AWALAN_TANPA_NAMA = {"CM"};

    /** Bentuknya nomor pengiriman, walau kurirnya belum tentu bisa disebut. */
    public static boolean berawalanResi(String normalized) {
        if (normalized == null) return false;
        if (courierOf(normalized) != null) return true;
        for (String p : AWALAN_TANPA_NAMA) {
            if (normalized.startsWith(p)) return true;
        }
        return false;
    }

    private static final int MIN_LEN = 8;
    private static final int MAX_LEN = 24;
    private static final int MIN_DIGITS = 6;
    private static final int MAX_RESULTS = 5;

    /** Upper case, alphanumerics only — must match the server's normalizeResi. */
    public static String normalize(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = Character.toUpperCase(s.charAt(i));
            if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) b.append(c);
        }
        return b.toString();
    }

    public static String courierOf(String normalized) {
        if (normalized == null) return null;
        for (String[] pair : COURIERS) {
            if (normalized.startsWith(pair[0])) return pair[1];
        }
        return null;
    }

    public static List<Candidate> extract(String ocrText) {
        List<Candidate> out = new ArrayList<>();
        if (ocrText == null || ocrText.isEmpty()) return out;

        Map<String, Candidate> best = new HashMap<>();
        for (String line : ocrText.split("\\r?\\n")) {
            if (line.trim().isEmpty()) continue;
            boolean hinted = hasHint(line);

            String[] tokens = line.split("[\\s|,;:/\\\\()\\[\\]]+");

            // Single tokens, plus 2-4 adjacent tokens joined. Labels routinely
            // print the number in spaced groups ("JX 1234 5678 90") and OCR
            // preserves those gaps, so a token-only pass would never see the
            // whole thing.
            for (int i = 0; i < tokens.length; i++) {
                consider(best, tokens[i], hinted);
                // Only continue a join from a token that could plausibly BEGIN
                // a waybill — one carrying digits, or a known courier prefix.
                // Starting anywhere welds the label's wording onto the next
                // field ("Telp" + "081234567890"), and the resulting hybrid is
                // long and mixed-case enough to outrank the real number.
                if (!canStartResi(tokens[i])) continue;
                for (int n = 2; n <= 4 && i + n <= tokens.length; n++) {
                    StringBuilder joined = new StringBuilder();
                    for (int k = i; k < i + n; k++) joined.append(tokens[k]);
                    consider(best, joined.toString(), hinted);
                }
            }
            // And the whole line, for labels that space out every character.
            // Same entry rule as the joins above, or this quietly rebuilds the
            // exact hybrid they were changed to avoid: a line beginning with a
            // word ("Telp 0812...") would otherwise still produce
            // "TELP081234567890", which reads as a long alphanumeric and so
            // escapes the phone-number penalty entirely.
            if (tokens.length > 0 && canStartResi(tokens[0])) {
                consider(best, line, hinted);
            }
        }

        // A shorter join of the same digit group is a TRUNCATED read, not a
        // genuine second option: "SPXID04321234" is just the first three
        // groups of "SPXID043212345678". Offering it would both clutter the
        // choices and — because the truncation is shorter and lands inside
        // the length bonus — sometimes outrank the complete number.
        List<Candidate> all = new ArrayList<>(best.values());
        for (Candidate c : all) {
            boolean truncated = false;
            for (Candidate other : all) {
                if (other != c && other.value.length() > c.value.length()
                        && other.value.startsWith(c.value)) {
                    truncated = true;
                    break;
                }
            }
            if (!truncated) out.add(c);
        }

        Collections.sort(out, (a, b) -> {
            if (a.score != b.score) return b.score - a.score;
            return b.value.length() - a.value.length();
        });
        return out.size() > MAX_RESULTS ? new ArrayList<>(out.subList(0, MAX_RESULTS)) : out;
    }

    /** Could this token be the first piece of a waybill number? */
    private static boolean canStartResi(String token) {
        String n = normalize(token);
        if (n.isEmpty()) return false;
        for (int i = 0; i < n.length(); i++) {
            if (Character.isDigit(n.charAt(i))) return true;
        }
        if (courierOf(n) != null) return true;
        // Also allow a partial prefix, e.g. OCR split "SPX" off "SPXID".
        for (String[] pair : COURIERS) {
            if (pair[0].startsWith(n)) return true;
        }
        return false;
    }

    private static void consider(Map<String, Candidate> best, String raw, boolean hinted) {
        String norm = normalize(raw);
        int s = score(norm, hinted);
        if (s < 0) return;
        Candidate existing = best.get(norm);
        if (existing == null || s > existing.score) {
            best.put(norm, new Candidate(norm, raw.trim(), s, courierOf(norm)));
        }
    }

    private static int score(String norm, boolean hinted) {
        int len = norm.length();
        if (len < MIN_LEN || len > MAX_LEN) return -1;
        int digits = countDigits(norm);
        if (digits < MIN_DIGITS) return -1;

        int s = 10;
        if (hinted) s += 25;
        if (berawalanResi(norm)) s += 40;
        if (len >= 10 && len <= 16) s += 10;

        // A shipping label always carries the recipient's mobile number, and
        // it is the single most convincing decoy on the page: same length,
        // all digits, often right under the name. Push it down hard.
        if (isPhoneLike(norm)) s -= 60;

        // 20260803 and friends.
        if (looksLikeDate(norm)) s -= 25;

        // A very long all-digit run is usually two fields OCR ran together.
        if (digits == len && len > 16) s -= 20;

        return s;
    }

    static boolean isPhoneLike(String norm) {
        if (countDigits(norm) != norm.length()) return false;
        if (norm.startsWith("08") && norm.length() >= 10 && norm.length() <= 14) return true;
        return norm.startsWith("628") && norm.length() >= 11 && norm.length() <= 15;
    }

    static boolean looksLikeDate(String norm) {
        if (norm.length() != 8 || countDigits(norm) != 8) return false;
        if (!norm.startsWith("20")) return false;
        int month = Integer.parseInt(norm.substring(4, 6));
        int day = Integer.parseInt(norm.substring(6, 8));
        return month >= 1 && month <= 12 && day >= 1 && day <= 31;
    }

    private static boolean hasHint(String line) {
        String u = line.toUpperCase();
        for (String h : HINTS) {
            if (u.contains(h)) return true;
        }
        return false;
    }

    private static int countDigits(String s) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) {
            if (Character.isDigit(s.charAt(i))) n++;
        }
        return n;
    }
}
