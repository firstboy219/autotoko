package id.autotoko.scanner;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Matches a line of label text to one of the seller's own products.
 *
 * The label prints a marketplace listing title, which is nothing like a master
 * product name: "Renature - Cool Mint Mouthspray wangi 24jam hilangkan bau
 * mulut spray perawatan penghilang untuk Cairan Penyegar" has to become "Cool
 * Mint 100ml". So the comparison is on shared words, not on the strings as a
 * whole, and the listing's marketing padding simply fails to match anything
 * and is ignored.
 *
 * The failure that matters is not a missed match, it is a confident wrong one.
 * This catalogue contains "Cool Mint 100ml" and "Cool Mint Spray 50ml",
 * "Refill Anti Ngantuk" and "Inhaler Anti Ngantuk" — pairs whose words overlap
 * almost entirely and which differ in exactly the places OCR is weakest. Two
 * rules exist for them:
 *
 *  - a size that contradicts is fatal, not merely unhelpful. If the product
 *    says 100ml and the label says 50ml, no amount of shared wording rescues
 *    it. Without this rule the two Cool Mints are separated by one token out
 *    of six and would swap on a single misread character.
 *
 *  - a match is only offered unattended when it also beats the runner-up by a
 *    clear margin. Two products scoring 0.71 and 0.70 means the reading cannot
 *    tell them apart, however good either number looks alone.
 */
public final class ProductMatcher {

    /** Below this the guess is not worth showing at all. */
    public static final double MIN_SCORE = 0.34;

    /** At or above this, and clear of the runner-up, the phone need not ask. */
    public static final double AUTO_SCORE = 0.72;

    /** How far ahead of the second-best a match must be to stand unattended. */
    public static final double AUTO_MARGIN = 0.15;

    public static final class Product {
        public final String id;
        public final String name;
        public final String sku;
        /**
         * What the marketplace listing calls it, one per line.
         *
         * Folded into the token set below for word matching, and kept as text
         * as well so the character-level matcher can score against it — the
         * listing title is often nothing like the internal name, which is the
         * whole reason this field exists.
         */
        public final String aliases;
        final Set<String> tokens;
        final Set<String> sizes;

        public Product(String id, String name, String sku) {
            this(id, name, sku, null);
        }

        /**
         * @param aliases other names this is sold under, one per line. They
         *     join the product's own words rather than being matched
         *     separately: a label carrying either the master name or a listing
         *     title should find the same product, and scoring them apart would
         *     mean picking a winner between two descriptions of one thing.
         */
        public Product(String id, String name, String sku, String aliases) {
            this.aliases = aliases == null ? "" : aliases;
            this.id = id;
            this.name = name == null ? "" : name;
            this.sku = sku == null ? "" : sku;
            String all = this.name + " " + this.sku + " " + (aliases == null ? "" : aliases);
            this.tokens = tokensOf(all);
            this.sizes = sizesOf(all);
        }
    }

    public static final class Match {
        public final Product product;
        public final double score;
        /** True when nothing else came close enough to be confusable. */
        public final boolean confident;

        Match(Product product, double score, boolean confident) {
            this.product = product;
            this.score = score;
            this.confident = confident;
        }
    }

    private ProductMatcher() {}

    /**
     * A product the packer named outright, wrapped so it travels the same path
     * as a matched one.
     *
     * Score zero, deliberately: nothing was compared. Recording 1.0 here would
     * make a human choice indistinguishable from the machine's most confident
     * guess, and the whole reason the score is stored is to find the guesses
     * that went wrong afterwards.
     */
    public static Match pick(Product p) {
        return new Match(p, 0, true);
    }

    /**
     * Words that carry no distinguishing power in this catalogue and appear in
     * most listing titles. Left in, they lift every score by the same amount
     * and flatten the gap between the right product and the wrong one.
     */
    private static final Set<String> STOP = new LinkedHashSet<>(Arrays.asList(
            "dan", "untuk", "yang", "dengan", "the", "of", "asli", "original",
            "ready", "stock", "free", "promo", "murah", "terlaris", "best",
            "seller", "grosir", "termurah", "new", "premium", "pcs", "pack"));

    static Set<String> tokensOf(String s) {
        Set<String> out = new LinkedHashSet<>();
        if (s == null) return out;
        String flat = s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
        if (flat.isEmpty()) return out;
        for (String t : flat.split(" ")) {
            if (t.length() < 2 || STOP.contains(t)) continue;
            out.add(t);
        }
        return out;
    }

    /**
     * Sizes mentioned, normalised to a single unit each: "100ml", "50 ml" and
     * "100ML" all reduce to the same token so a mismatch is detectable.
     */
    static Set<String> sizesOf(String s) {
        Set<String> out = new LinkedHashSet<>();
        if (s == null) return out;
        String flat = s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ");
        java.util.regex.Matcher m =
                java.util.regex.Pattern.compile("(\\d{1,4})\\s*(ml|gr|gram|g|kg|l)\\b").matcher(flat);
        while (m.find()) {
            String unit = m.group(2);
            if ("gram".equals(unit)) unit = "gr";
            out.add(m.group(1) + unit);
        }
        return out;
    }

    /**
     * How much of the product's own wording the label carries.
     *
     * Measured against the PRODUCT's tokens rather than the label's: a listing
     * title is thirty words of marketing and a product name is three, so
     * scoring over the union would drown every real match in padding.
     */
    static double similarity(Product p, Set<String> labelTokens, Set<String> labelSizes) {
        if (p.tokens.isEmpty() || labelTokens.isEmpty()) return 0;

        // A size the label states and the product contradicts. Not a penalty:
        // "Cool Mint 100ml" cannot be a parcel whose label says 50ml, however
        // many other words agree.
        if (!p.sizes.isEmpty() && !labelSizes.isEmpty()) {
            boolean agrees = false;
            for (String s : p.sizes) if (labelSizes.contains(s)) agrees = true;
            if (!agrees) return 0;
        }

        int hit = 0;
        for (String t : p.tokens) if (labelTokens.contains(t)) hit++;
        double covered = hit / (double) p.tokens.size();

        // A single shared word out of three is coincidence, not a match.
        if (hit < 2 && p.tokens.size() > 1) covered *= 0.5;

        // Agreeing on a stated size is the strongest single signal available,
        // because it is the thing the near-identical pairs differ on.
        if (!p.sizes.isEmpty() && !labelSizes.isEmpty()) covered = Math.min(1.0, covered + 0.15);

        return covered;
    }

    /**
     * Sebanyak ini bobot bukti harus ditemukan sebelum sebuah produk diusulkan.
     *
     * Bukan rasio. Rasio -- bobot yang ketemu dibagi seluruh bobot kata produk
     * -- menghukum produk yang deskripsi marketplace-nya panjang: terukur,
     * "Inhaler Minimalis Peppermint" mencocokkan EMPAT kata khas dan hanya
     * mendapat 0,20 karena ia punya 17 kata, sementara "Inhaler sinus" yang
     * cuma bermodal kata umum "inhaler" mendapat 0,27 dan menang.
     *
     * Dibandingkan pada 284 scan yang itemnya dikonfirmasi manusia:
     *   rasio >= 0,26   tebakan muncul 76%, teratas tepat 49%, di-3 65%
     *   bukti >= 3,0    tebakan muncul 89%, teratas tepat 54%, di-3 72%
     */
    public static final double MIN_BUKTI_TEKS = 3.0;

    /**
     * Mengubah bobot bukti menjadi angka 0..1 untuk disimpan dan dibandingkan.
     *
     * Menjenuh, bukan linear: bukti kesepuluh tidak menambah keyakinan sebanyak
     * bukti kedua. Dengan tetapan ini, AUTO_SCORE 0,72 menuntut bukti sekitar
     * 10 -- artinya sederet kata khas, bukan satu kebetulan.
     */
    static double skorDariBukti(double bukti) {
        return bukti / (bukti + 4.0);
    }

    /** Kata yang muncul di paling banyak sekian produk dianggap khas. */
    private static final int KHAS_MAKS_PRODUK = 2;

    /**
     * Berapa banyak produk di katalog yang memakai tiap kata.
     *
     * Dihitung dari katalognya sendiri, bukan dari daftar kata umum yang saya
     * susun: katalog toko lain akan punya kata umum yang lain sama sekali, dan
     * daftar tetap akan salah di sana.
     */
    private static java.util.Map<String, Integer> sebaran(List<Product> katalog) {
        java.util.Map<String, Integer> df = new java.util.HashMap<>();
        for (Product p : katalog) {
            for (String t : p.tokens) {
                Integer n = df.get(t);
                df.put(t, n == null ? 1 : n + 1);
            }
        }
        return df;
    }

    private static double bobot(String t, java.util.Map<String, Integer> df, int jumlahProduk) {
        Integer n = df.get(t);
        return Math.log((jumlahProduk + 1.0) / ((n == null ? 0 : n) + 1.0)) + 0.2;
    }

    /** Beda paling banyak satu huruf: sisipan, hilang, atau tertukar. */
    static boolean bedaSatuHuruf(String a, String b) {
        if (a.equals(b)) return true;
        if (Math.abs(a.length() - b.length()) > 1) return false;
        int i = 0, j = 0, beda = 0;
        while (i < a.length() && j < b.length()) {
            if (a.charAt(i) == b.charAt(j)) { i++; j++; continue; }
            if (++beda > 1) return false;
            if (a.length() > b.length()) i++;
            else if (b.length() > a.length()) j++;
            else { i++; j++; }
        }
        return beda + (a.length() - i) + (b.length() - j) <= 1;
    }

    /**
     * Kata produk ini ada di teks label -- persis, termuat, atau beda satu huruf.
     *
     * "Termuat" perlu karena OCR sering menyambung kata dengan tetangganya
     * ("InhalerLisa"), dan beda-satu-huruf perlu karena label termal keliru
     * satu huruf terus-menerus.
     */
    private static boolean adaDiTeks(String t, Set<String> tokenTeks, String teksRata) {
        if (tokenTeks.contains(t)) return true;
        if (t.length() >= 5 && teksRata.contains(t)) return true;
        if (t.length() >= 6) {
            for (String u : tokenTeks) {
                if (Math.abs(u.length() - t.length()) > 1) continue;
                if (bedaSatuHuruf(t, u)) return true;
            }
        }
        return false;
    }

    /**
     * Produk yang kata-katanya muncul di SELURUH teks label.
     *
     * Bukan pengganti rank() melainkan pelengkapnya: rank() dipakai saat ada
     * baris produk yang jelas, dan ini menangkap yang barisnya tidak pernah
     * terbentuk -- yang terukur adalah dua pertiga dari seluruh scan.
     */
    public static List<Match> cariDiTeks(String seluruhTeks, List<Product> katalog, int limit) {
        List<Match> out = new ArrayList<>();
        if (seluruhTeks == null || seluruhTeks.length() < 8) return out;
        if (katalog == null || katalog.isEmpty()) return out;

        Set<String> tokenTeks = tokensOf(seluruhTeks);
        Set<String> ukuranTeks = sizesOf(seluruhTeks);
        if (tokenTeks.isEmpty()) return out;
        String rata = seluruhTeks.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "");

        java.util.Map<String, Integer> df = sebaran(katalog);
        List<Match> semua = new ArrayList<>();
        for (Product p : katalog) {
            if (p.tokens.isEmpty()) continue;

            // Ukuran yang bertentangan tetap mematikan, sama seperti di rank():
            // "Cool Mint 100ml" tidak mungkin paket yang labelnya menulis 50ml,
            // sebanyak apa pun kata lain yang cocok.
            if (!p.sizes.isEmpty() && !ukuranTeks.isEmpty()) {
                boolean sepakat = false;
                for (String u : p.sizes) if (ukuranTeks.contains(u)) sepakat = true;
                if (!sepakat) continue;
            }

            double bukti = 0;
            int khasKena = 0;
            for (String t : p.tokens) {
                if (!adaDiTeks(t, tokenTeks, rata)) continue;
                bukti += bobot(t, df, katalog.size());
                Integer n = df.get(t);
                if (n != null && n <= KHAS_MAKS_PRODUK) khasKena++;
            }
            // Tanpa satu pun kata khas, yang cocok cuma kata umum katalog ini.
            if (khasKena == 0) continue;
            if (bukti >= MIN_BUKTI_TEKS) {
                semua.add(new Match(p, skorDariBukti(bukti), false));
            }
        }
        if (semua.isEmpty()) return out;

        Collections.sort(semua, (a, b) -> Double.compare(b.score, a.score));
        double atas = semua.get(0).score;
        double kedua = semua.size() > 1 ? semua.get(1).score : 0;
        boolean yakin = atas >= AUTO_SCORE && (atas - kedua) >= AUTO_MARGIN;

        out.add(new Match(semua.get(0).product, atas, yakin));
        for (int i = 1; i < semua.size() && out.size() < limit; i++) {
            out.add(new Match(semua.get(i).product, semua.get(i).score, false));
        }
        return out;
    }

    /** Best product for a line of label text, or null when nothing is close. */
    public static Match best(String labelLine, List<Product> catalogue) {
        List<Match> ranked = rank(labelLine, catalogue, 2);
        if (ranked.isEmpty()) return null;
        return ranked.get(0);
    }

    /**
     * Candidates in descending order, for the sheet shown when the phone is not
     * sure. The top one carries whether it was clear enough to stand alone.
     */
    public static List<Match> rank(String labelLine, List<Product> catalogue, int limit) {
        List<Match> out = new ArrayList<>();
        if (labelLine == null || catalogue == null || catalogue.isEmpty()) return out;

        Set<String> tokens = tokensOf(labelLine);
        Set<String> sizes = sizesOf(labelLine);
        if (tokens.isEmpty()) return out;

        List<Match> all = new ArrayList<>();
        for (Product p : catalogue) {
            double s = similarity(p, tokens, sizes);
            if (s >= MIN_SCORE) all.add(new Match(p, s, false));
        }
        if (all.isEmpty()) return out;

        Collections.sort(all, (a, b) -> Double.compare(b.score, a.score));

        double top = all.get(0).score;
        double second = all.size() > 1 ? all.get(1).score : 0;
        boolean confident = top >= AUTO_SCORE && (top - second) >= AUTO_MARGIN;

        out.add(new Match(all.get(0).product, top, confident));
        for (int i = 1; i < all.size() && out.size() < limit; i++) {
            out.add(new Match(all.get(i).product, all.get(i).score, false));
        }
        return out;
    }
}
