package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Ratusan frame atas kertas yang sama adalah bukti. Yang lama membuangnya dan
 * memutuskan dari satu frame yang kebetulan sedang dilihat.
 */
public class SuaraOrderIdTest {

    private static final String SHOPEE = "260827EXWKKVDE";

    private static String label(String nomor) {
        return "Penerima: Ziza\nBatas Kirim: 28-08-2026\nNo.Pesanan: " + nomor + "\n";
    }

    @Test public void frame_yang_sepakat_menguatkan() {
        SuaraOrderId s = new SuaraOrderId();
        for (int i = 0; i < 12; i++) s.catat(label(SHOPEE));
        OrderId.Bacaan b = s.hasil();
        assertNotNull(b);
        assertEquals(SHOPEE, b.nilai);
        assertEquals("tinggi", b.keyakinan);
        assertEquals(12, s.suaraUntuk(SHOPEE));
        assertTrue(b.alasan.contains("disepakati"));
    }

    /**
     * Perbaikan yang mustahil dilakukan satu frame, sejernih apa pun.
     *
     * Tiga frame membaca 'D' di posisi yang sama, satu membaca '0'. Yang
     * terbanyak menang per posisi, jadi nomornya utuh kembali meskipun TIDAK
     * ADA satu pun frame yang salah dibuang.
     */
    @Test public void satu_huruf_yang_salah_dipulihkan_suara_terbanyak() {
        SuaraOrderId s = new SuaraOrderId();
        for (int i = 0; i < 3; i++) s.catat(label(SHOPEE));
        s.catat(label("260827EXWKKV0E"));
        OrderId.Bacaan b = s.hasil();
        assertNotNull(b);
        assertEquals(SHOPEE, b.nilai);
    }

    /**
     * Batas yang disengaja. Kode sortir kurir juga tercetak di label dan juga
     * akan terbaca ratusan kali; kalau banyaknya suara bisa membuat sesuatu
     * diterima otomatis, ia akan diterima otomatis.
     */
    @Test public void tanpa_jangkar_sebanyak_apa_pun_suaranya_tidak_pernah_otomatis() {
        SuaraOrderId s = new SuaraOrderId();
        for (int i = 0; i < 200; i++) s.catat("BW-33\n" + SHOPEE + "\nSPX");
        OrderId.Bacaan b = s.hasil();
        assertNotNull(b);
        assertEquals(SHOPEE, b.nilai);
        assertEquals("sedang", b.keyakinan);
        assertTrue(b.skor < 0.80);
    }

    @Test public void angka_18_digit_tetap_otomatis_tanpa_jangkar() {
        SuaraOrderId s = new SuaraOrderId();
        for (int i = 0; i < 5; i++) s.catat("tokopedia\n585623070310172189\nJNE");
        OrderId.Bacaan b = s.hasil();
        assertNotNull(b);
        assertEquals("585623070310172189", b.nilai);
        assertEquals("tinggi", b.keyakinan);
    }

    @Test public void menawarkan_paling_banyak_tiga_pilihan() {
        SuaraOrderId s = new SuaraOrderId();
        s.catat(label(SHOPEE));
        s.catat("270901ABCDEFGH\n280902ZZXXCCVV\n250703QQWWEERR\n260604MMNNBBVV");
        assertTrue(s.pilihan().size() <= 3);
        // Yang berjangkar tetap di urutan pertama, seberapa pun ramainya.
        assertEquals(SHOPEE, s.pilihan().get(0).nilai);
    }

    // --- barcode: dari korpus 311 kode sungguhan -----------------------
    //
    //   287  panjang 12   JY1311292924        nomor pengiriman J&T
    //    17  panjang 13   CM67961230459       nomor pengiriman
    //     5  panjang 14   260814B62PDTY8      NOMOR PESANAN Shopee
    //     2  panjang 18   585527219881477623  NOMOR PESANAN 18 angka

    @Test public void barcode_dipercaya_lebih_dari_ocr() {
        SuaraOrderId s = new SuaraOrderId();
        // Bentuk Shopee dari OCR telanjang hanya sampai "sedang". Dari
        // barcode -- yang punya checksum -- ia layak dipakai langsung.
        s.catatBarcode("260814B62PDTY8");
        OrderId.Bacaan b = s.hasil();
        assertNotNull(b);
        assertEquals("260814B62PDTY8", b.nilai);
        assertEquals("tinggi", b.keyakinan);
        assertTrue(b.alasan.contains("barcode"));
    }

    @Test public void barcode_18_angka_juga_langsung_dipakai() {
        SuaraOrderId s = new SuaraOrderId();
        s.catatBarcode("585527219881477623");
        OrderId.Bacaan b = s.hasil();
        assertNotNull(b);
        assertEquals("585527219881477623", b.nilai);
        assertEquals("tinggi", b.keyakinan);
    }

    /**
     * 287 dari 311 barcode di korpus justru nomor pengiriman. Kalau jalur
     * barcode melonggarkan pemeriksaan bentuk, setiap paket akan menyimpan
     * nomor resi kurir di kolom nomor pesanan -- persis kekacauan yang dulu
     * memaksa aturan 18-digit yang kaku.
     */
    @Test public void barcode_nomor_pengiriman_tetap_ditolak() {
        SuaraOrderId s = new SuaraOrderId();
        s.catatBarcode("JY1311292924");
        s.catatBarcode("CM67961230459");
        s.catatBarcode("JY1338478473");
        assertTrue(s.kosong());
        assertEquals(null, s.hasil());
    }

    @Test public void barcode_menang_atas_bacaan_ocr_yang_ragu() {
        SuaraOrderId s = new SuaraOrderId();
        // OCR telanjang membaca bentuk Shopee berkali-kali: tetap "sedang".
        for (int i = 0; i < 30; i++) s.catat("BW-33\n260814B62PDTY8\nSPX");
        assertEquals("sedang", s.hasil().keyakinan);
        // Satu barcode sudah cukup untuk menyelesaikannya.
        s.catatBarcode("260814B62PDTY8");
        OrderId.Bacaan b = s.hasil();
        assertEquals("260814B62PDTY8", b.nilai);
        assertEquals("tinggi", b.keyakinan);
    }

    @Test public void kosong_aman() {
        SuaraOrderId s = new SuaraOrderId();
        s.catat(null);
        s.catat("");
        s.catat("tidak ada nomor apa pun di sini");
        assertTrue(s.kosong());
        assertEquals(null, s.hasil());
        assertTrue(s.pilihan().isEmpty());
    }

    @Test public void dikosongkan_saat_resi_berikutnya() {
        SuaraOrderId s = new SuaraOrderId();
        for (int i = 0; i < 5; i++) s.catat(label(SHOPEE));
        s.kosongkan();
        assertTrue(s.kosong());
        assertEquals(0, s.frame());
        assertEquals(0, s.suaraUntuk(SHOPEE));
    }
}
