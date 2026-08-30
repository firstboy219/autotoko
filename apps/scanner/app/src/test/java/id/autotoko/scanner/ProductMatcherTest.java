package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

/**
 * Cases taken from this seller's actual catalogue and actual labels, because
 * the pairs that matter are specific: "Cool Mint 100ml" against "Cool Mint
 * Spray 50ml" is not a hypothetical, it is two rows in their master data whose
 * names differ in the one place OCR is least reliable.
 */
public class ProductMatcherTest {

    /** The real catalogue, abbreviated to the products that can be confused. */
    private static List<ProductMatcher.Product> catalogue() {
        return new ArrayList<>(Arrays.asList(
                new ProductMatcher.Product("p-cm100", "Cool Mint 100ml", "CM100ML"),
                new ProductMatcher.Product("p-cm50", "Cool Mint Spray 50ml", "CM50ML"),
                new ProductMatcher.Product("p-swk", "Mouthspray Siwak 100ml", "SPSWK100ML"),
                new ProductMatcher.Product("p-swk50", "Siwak Spray 50ml", "SWKSPRY50ML"),
                new ProductMatcher.Product("p-inh-ppm", "Inhaler Regular Peppermint", "RegPPM"),
                new ProductMatcher.Product("p-ref-ppm", "Refill Peppermint", "RefillPPM"),
                new ProductMatcher.Product("p-inh-ng", "Inhaler Anti Ngantuk", "RegAntiNgantuk"),
                new ProductMatcher.Product("p-ref-ng", "Refill Anti Ngantuk", "RefillAntiNgntk"),
                new ProductMatcher.Product("p-mozzy", "Mozzy Gel", "Mozzy")));
    }

    /** A real Tokopedia line: listing title plus the SKU column beside it. */
    private static final String COOL_MINT_100 =
            "Renature - Cool Mint Mouthspray wangi 24jam hilangkan bau mulut spray "
                    + "perawatan penghilang untuk Cairan Penyegar   Life. 100ML";

    @Test
    public void picks_the_right_product_from_a_marketing_title() {
        ProductMatcher.Match m = ProductMatcher.best(COOL_MINT_100, catalogue());
        assertNotNull(m);
        assertEquals("p-cm100", m.product.id);
        assertTrue("harus cukup yakin, skor=" + m.score, m.confident);
    }

    @Test
    public void a_contradicting_size_rules_a_product_out_completely() {
        // The pair this rule exists for. Same words, different volume.
        List<ProductMatcher.Match> ranked = ProductMatcher.rank(COOL_MINT_100, catalogue(), 5);
        for (ProductMatcher.Match m : ranked) {
            assertFalse("50ml tidak boleh muncul untuk label 100ml", "p-cm50".equals(m.product.id));
        }
    }

    @Test
    public void the_50ml_listing_picks_the_50ml_product() {
        String line = "Renature - Cool Mint Mouthspray spray alami perawatan  Bold, 50ML";
        ProductMatcher.Match m = ProductMatcher.best(line, catalogue());
        assertNotNull(m);
        assertEquals("p-cm50", m.product.id);
    }

    @Test
    public void asks_rather_than_guesses_when_two_products_are_close() {
        // "Refill Peppermint" and "Inhaler Regular Peppermint" share their only
        // distinguishing word with the label; neither may be taken unattended.
        String line = "Renature Peppermint Inhaler Jack Heule Aromatherapy minyak angin "
                + "hidung tersumbat  Refill 5ml Peppermint";
        List<ProductMatcher.Match> ranked = ProductMatcher.rank(line, catalogue(), 5);
        assertTrue("harus ada kandidat", ranked.size() >= 2);
        assertFalse("tidak boleh diterima otomatis", ranked.get(0).confident);
    }

    @Test
    public void a_product_whose_words_are_absent_is_not_offered() {
        // Nothing in this catalogue is coffee. An empty answer is the right one.
        ProductMatcher.Match m = ProductMatcher.best("Kopi Arabika Gayo 200gr biji utuh", catalogue());
        assertNull("tidak ada produk yang cocok, jadi jangan menawarkan apa pun", m);
    }

    @Test
    public void one_shared_word_is_coincidence_not_a_match() {
        // "gel" alone must not carry Mozzy Gel.
        ProductMatcher.Match m = ProductMatcher.best("hand sanitizer gel antiseptik", catalogue());
        if (m != null) {
            assertFalse("skor kebetulan tidak boleh yakin", m.confident);
        }
    }

    @Test
    public void survives_junk_and_empty_input() {
        assertNull(ProductMatcher.best("", catalogue()));
        assertNull(ProductMatcher.best("!!! ??? ...", catalogue()));
        assertNull(ProductMatcher.best(COOL_MINT_100, new ArrayList<>()));
        assertNull(ProductMatcher.best(null, catalogue()));
    }

    @Test
    public void sizes_are_normalised_however_they_are_printed() {
        assertTrue(ProductMatcher.sizesOf("isi 100 ML").contains("100ml"));
        assertTrue(ProductMatcher.sizesOf("100ml").contains("100ml"));
        assertTrue(ProductMatcher.sizesOf("berat 200 gram").contains("200gr"));
    }

    @Test
    public void marketing_padding_does_not_lift_every_score_equally() {
        // READY STOCK / FREE / PROMO appear on most listings; if they counted,
        // the gap between the right product and the wrong one would shrink.
        assertFalse(ProductMatcher.tokensOf("READY STOCK FREE PROMO").contains("ready"));
        assertFalse(ProductMatcher.tokensOf("READY STOCK FREE PROMO").contains("promo"));
    }

    // --- pencarian seluruh teks ----------------------------------------
    //
    // Katalog di bawah disalin dari master produk toko yang sebenarnya, dan
    // teks labelnya dari device_text yang benar-benar tersimpan.

    private static java.util.List<ProductMatcher.Product> katalogAsli() {
        java.util.List<ProductMatcher.Product> k = new java.util.ArrayList<>();
        k.add(new ProductMatcher.Product("cm100", "Cool Mint 100ml", "CM100ML",
                "Renature - Cool Mint Mouthspray wangi 24jam hilangkan bau mulut spray alami"
                + " Perawatan Menyembuhkan satu barang non-medis jam 24 Fresh Berry Kumur Gusi"));
        k.add(new ProductMatcher.Product("cm50", "Cool Mint Spray 50ml", "CM50ML", null));
        k.add(new ProductMatcher.Product("ppm", "Inhaler Regular Peppermint", "RegPPM",
                "[READY STOCK] Peppermint Inhaler / Inhaler Lisa / Inhaler double / Minyak angin"
                + " / Hidung tersumbat / Inhaler 100% Plossa Freshcare Field Black Simple"));
        k.add(new ProductMatcher.Product("mini", "Inhaler Minimalis Peppermint", "MinimalisHitamPpm",
                "[READY STOCK] Minimalis Peppermint Inhaler / Inhaler Lisa / Inhaler double"
                + " / Minyak angin / Hidung tersumbat / Inhaler 100% Plossa Freshcare Field Black"));
        k.add(new ProductMatcher.Product("duo", "Inhaler Duo", "IHRDUO",
                "Renature Duo Inhaler COOL MINT Menyegarkan dan Melegakan Pernafasan"));
        k.add(new ProductMatcher.Product("cant", "Renature-Cantengan", "RENATURECANT-XESU",
                "Renature-Cantengan Mengobati cantengan & mempercepat pemulihan 15ML"));
        k.add(new ProductMatcher.Product("kopi", "Kopi Arabika Premium 200gr", "KOPI-ARABIKA-200", null));
        return k;
    }

    /**
     * Teks nyata yang tersimpan sebagai rawName di basis data: alamat dan nama
     * produk menyatu dalam satu baris, karena OCR memotong baris menurut tata
     * letak cetakan. Pencocokan per baris tersandung tepat di sini.
     */
    @Test public void cariDiTeks_menemukan_produk_walau_alamat_menyatu() {
        String teks = "Penerima: Budi\n"
                + "P'asar agro Purwvodadi, JI. Gajah Mada No.7 Peppermint Inhaler "
                + "/ Inhaler Lisa / Inhaler double / Min\n"
                + "JY1328393153\n";
        java.util.List<ProductMatcher.Match> m =
                ProductMatcher.cariDiTeks(teks, katalogAsli(), 3);
        assertFalse("tidak ada kandidat sama sekali", m.isEmpty());
        assertTrue("yang benar tidak ada di 3 besar",
                m.get(0).product.id.equals("ppm") || m.get(0).product.id.equals("mini")
                        || (m.size() > 1 && (m.get(1).product.id.equals("ppm")
                            || m.get(1).product.id.equals("mini"))));
    }

    /** "Mouthapray" untuk "mouthspray": label termal keliru satu huruf terus. */
    @Test public void cariDiTeks_tahan_salah_satu_huruf() {
        String teks = "wangi 24jam hilangkan bau mulul spray alami Perawatan "
                + "Renature -Cool Mint Mouthapray 100ml";
        java.util.List<ProductMatcher.Match> m =
                ProductMatcher.cariDiTeks(teks, katalogAsli(), 3);
        assertFalse(m.isEmpty());
        assertEquals("cm100", m.get(0).product.id);
    }

    /**
     * Ukuran yang bertentangan tetap mematikan. Katalog ini memuat Cool Mint
     * 100ml di sebelah Cool Mint Spray 50ml -- pasangan yang bedanya justru di
     * tempat OCR paling lemah.
     */
    @Test public void cariDiTeks_ukuran_yang_bertentangan_tetap_mematikan() {
        String teks = "Renature Cool Mint Mouthspray 50ml";
        for (ProductMatcher.Match m : ProductMatcher.cariDiTeks(teks, katalogAsli(), 5)) {
            assertFalse("100ml tidak boleh muncul untuk label 50ml",
                    m.product.id.equals("cm100"));
        }
    }

    /**
     * Tanpa syarat "harus ada kata khas", kata umum katalog seperti "inhaler"
     * saja sudah cukup mengangkat setiap produk.
     */
    @Test public void cariDiTeks_kata_umum_saja_tidak_cukup() {
        assertTrue(ProductMatcher.cariDiTeks("Inhaler", katalogAsli(), 5).isEmpty());
        assertTrue(ProductMatcher.cariDiTeks("Renature inhaler spray", katalogAsli(), 5).isEmpty());
    }

    @Test public void cariDiTeks_kata_khas_menemukan_produknya() {
        java.util.List<ProductMatcher.Match> m =
                ProductMatcher.cariDiTeks("Renature-Cantengan Mengobati cantengan 15ML",
                        katalogAsli(), 3);
        assertFalse(m.isEmpty());
        assertEquals("cant", m.get(0).product.id);
    }

    @Test public void cariDiTeks_alamat_saja_tidak_menghasilkan_apa_apa() {
        String teks = "Penerima: Ziza\nPerumahan Graha Sejahtera, West Pondok Kacang\n"
                + "PONDOK AREN, KOTA TANGERANG SELATAN, BANTEN\nCOD Cek Dulu: Tidak\n";
        assertTrue(ProductMatcher.cariDiTeks(teks, katalogAsli(), 5).isEmpty());
    }

    /** Produk yang memang tidak ada di master tidak boleh dikarang jadi ada. */
    @Test public void cariDiTeks_produk_asing_tidak_dipaksakan() {
        String teks = "Nama Produk: LKCARE Azeclair Cream - Night Cream Acne Scar "
                + "Dark Spot Brightening 10gr\nSKU C-LK-AZECLAIR-10gr-1407\n";
        assertTrue(ProductMatcher.cariDiTeks(teks, katalogAsli(), 5).isEmpty());
    }

    @Test public void cariDiTeks_aman_untuk_masukan_kosong() {
        assertTrue(ProductMatcher.cariDiTeks(null, katalogAsli(), 3).isEmpty());
        assertTrue(ProductMatcher.cariDiTeks("abc", katalogAsli(), 3).isEmpty());
        assertTrue(ProductMatcher.cariDiTeks("Peppermint Inhaler",
                new java.util.ArrayList<ProductMatcher.Product>(), 3).isEmpty());
    }

    @Test public void bedaSatuHuruf_apa_adanya() {
        assertTrue(ProductMatcher.bedaSatuHuruf("mouthspray", "mouthapray"));
        assertTrue(ProductMatcher.bedaSatuHuruf("inhaler", "inhaller"));
        assertTrue(ProductMatcher.bedaSatuHuruf("cantengan", "cantengn"));
        assertFalse(ProductMatcher.bedaSatuHuruf("peppermint", "spearmint"));
        assertFalse(ProductMatcher.bedaSatuHuruf("kopi", "teh"));
    }

    // --- master BAHAN BAKU ----------------------------------------------
    //
    // Nama bahan baku jauh lebih pendek daripada nama produk marketplace, dan
    // di situlah ambang yang disetel untuk produk gagal: "Tali" berbobot 2,28,
    // "Shrink" 2,57, "Tabung" 2,57 -- semuanya di bawah MIN_BUKTI_TEKS 3,0.

    private static java.util.List<ProductMatcher.Product> katalogBahanBaku() {
        java.util.List<ProductMatcher.Product> k = new java.util.ArrayList<>();
        String[][] b = {
            {"aq", "Aquades", "ml"}, {"jo", "Jojoba Oil", "ml"},
            {"opm", "Oil Peppermint", "ml"}, {"obp", "Oil Black Pepper", "ml"},
            {"oeu", "Oil Eucalyptus", "ml"}, {"bs100", "Botol Spray 100ml", "pcs"},
            {"bs70", "Botol Spray 70ml", "pcs"}, {"tali", "Tali", "Pcs"},
            {"talimini", "Tali Mini Leher", "Pcs"},
            {"talireg", "Tali Reguler Leher", "pcs"},
            {"shrink", "Shrink", "pcs"}, {"shrinkw", "Shrink Wrap", "pcs"},
            {"tabung", "Tabung", "pcs"}, {"tabungih", "Tabung Inhaler Reguler", "pcs"},
            {"kardus", "Kardus Packing", "pcs"}, {"kunyit", "Bubuk Kunyit", "gram"},
            {"siwak", "Siwak", "Batang"}, {"label", "Label Sticker", "pcs"},
        };
        for (String[] x : b) k.add(new ProductMatcher.Product(x[0], x[1], x[2]));
        return k;
    }

    /**
     * Nama sependek satu kata tetap ketemu.
     *
     * Tanpa jalan kedua di ambangnya, "Aquades" mustahil cocok betapa pun
     * jelas tercetak di nota -- bobotnya sendiri di bawah MIN_BUKTI_TEKS.
     */
    @Test public void bahan_bernama_pendek_tetap_ketemu() {
        java.util.List<ProductMatcher.Match> m = ProductMatcher.cariDiTeks(
                "Nota Pembelian\nAquades 5 liter\nJojoba Oil 100ml",
                katalogBahanBaku(), 5);
        assertFalse(m.isEmpty());
        java.util.Set<String> id = new java.util.HashSet<>();
        for (ProductMatcher.Match x : m) id.add(x.product.id);
        assertTrue("Aquades tidak ketemu", id.contains("aq"));
        assertTrue("Jojoba Oil tidak ketemu", id.contains("jo"));
    }

    /** Yang lebih lengkap namanya menang atas yang namanya penggalan. */
    @Test public void bahan_nama_lengkap_menang_atas_penggalannya() {
        java.util.List<ProductMatcher.Match> m = ProductMatcher.cariDiTeks(
                "Tali Mini Leher 100 pcs", katalogBahanBaku(), 5);
        assertFalse(m.isEmpty());
        assertEquals("talimini", m.get(0).product.id);
    }

    @Test public void bahan_shrink_wrap_menang_atas_shrink() {
        java.util.List<ProductMatcher.Match> m = ProductMatcher.cariDiTeks(
                "Shrink Wrap 30 pcs", katalogBahanBaku(), 5);
        assertFalse(m.isEmpty());
        assertEquals("shrinkw", m.get(0).product.id);
    }

    /**
     * Label kurir yang selama ini tertangkap, apa adanya dari basis data.
     * Tidak ada nama bahan di dalamnya, dan tidak boleh dikarang jadi ada.
     */
    @Test public void label_kurir_tidak_menghasilkan_bahan() {
        for (String teks : new String[]{
            "[COD Cek Dulu: Tidak]",
            "[JTN-A-04, SPX]",
            "[A-319, S Shopee, JTN-A-04, SPX, STD]",
            "[cOD Cek Dulu: Tidak DO, voTA JAKARTA TIMUR, SPX, TANPA ADANYA VIDEO UNBOXING, CASHLESS]",
        }) {
            assertTrue("mengarang bahan dari: " + teks,
                    ProductMatcher.cariDiTeks(teks, katalogBahanBaku(), 5).isEmpty());
        }
    }

    /** Ukuran yang bertentangan tetap mematikan, sama seperti untuk produk. */
    @Test public void bahan_ukuran_bertentangan_tetap_mematikan() {
        for (ProductMatcher.Match m : ProductMatcher.cariDiTeks(
                "Botol Spray 70ml x 30", katalogBahanBaku(), 5)) {
            assertFalse("100ml tidak boleh muncul untuk nota 70ml",
                    m.product.id.equals("bs100"));
        }
    }

    @Test public void bahan_dari_nota_yang_terpotong_barisnya() {
        // OCR memotong baris menurut tata letak; nama bahan terbelah.
        String teks = "Nota\nBotol\nSpray 100ml\nqty 30\n";
        java.util.List<ProductMatcher.Match> m =
                ProductMatcher.cariDiTeks(teks, katalogBahanBaku(), 5);
        assertFalse("terbelah baris jadi tidak ketemu", m.isEmpty());
        assertEquals("bs100", m.get(0).product.id);
    }
}
