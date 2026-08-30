package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Order id WAJIB, jadi aturannya menentukan apakah sebuah paket bisa disimpan
 * sama sekali. Terlalu longgar: sampah masuk dan audit menuduh marketplace
 * atas kegagalan kita. Terlalu ketat: paket Shopee mustahil disimpan dan
 * pekerjaan berhenti -- itulah yang benar-benar terjadi, dan yang diperbaiki.
 *
 * Nilainya diambil dari data sungguhan: order id asli dari laporan
 * penyelesaian, sampah asli yang pernah tersimpan di kolom ini, dan label
 * Shopee dari tangkapan layar hasil tes.
 */
public class OrderIdTest {

    private static final String ASLI = "585623070310172189";
    private static final String SHOPEE = "260827EXWKKVDE";

    /** Label Shopee sungguhan dari hasil tes, apa adanya. */
    private static final String LABEL_SHOPEE =
            "Penerima: Ziza\n"
            + "Berat: 10 gr    COD Cek Dulu: Tidak\n"
            + "Batas Kirim: 28-08-2026\n"
            + "No.Pesanan: " + SHOPEE + "\n";

    // --- jalur ketat: dipakai membaca laporan marketplace ------------------

    @Test public void ocr_menerima_18_digit() {
        assertEquals(ASLI, OrderId.dariOcr(ASLI));
    }

    @Test public void ocr_memperbaiki_huruf_yang_tertukar_angka() {
        assertEquals(ASLI, OrderId.dariOcr("S85623070310172189"));
        assertEquals(ASLI, OrderId.dariOcr("5856230703101721B9"));
    }

    @Test public void ocr_menolak_yang_masih_bersisa_huruf() {
        assertNull(OrderId.dariOcr("SH8476199355610969"));
        assertNull(OrderId.dariOcr("SHS4BSTISSIATTO04E"));
    }

    @Test public void ocr_mengabaikan_spasi_dan_pemisah() {
        assertEquals(ASLI, OrderId.dariOcr("5856 2307 0310 172189"));
        assertEquals(ASLI, OrderId.dariOcr("585623-070310-172189"));
    }

    // --- yang diperbaiki: label Shopee -------------------------------------

    /**
     * Pemeriksaan yang paling penting di berkas ini.
     *
     * Aplikasi membaca label ini dengan sempurna -- panel bawah menampilkan
     * "Pesanan 260827EXWKKVDE (3 frame)" -- lalu pengesahnya menolak, dan
     * panel panduan berkata "Belum terbaca, 154 frame, kejelasan 99%". Karena
     * order id diwajibkan, setiap paket Shopee berhenti di langkah pertama.
     */
    @Test public void label_shopee_dari_hasil_tes_terbaca() {
        assertEquals(SHOPEE, OrderId.cari(LABEL_SHOPEE));
        assertTrue(OrderId.berjangkar(LABEL_SHOPEE));
    }

    @Test public void alasan_bacaan_menyebut_jangkarnya() {
        OrderId.Bacaan b = OrderId.baca(LABEL_SHOPEE);
        assertNotNull(b);
        assertEquals("tinggi", b.keyakinan);
        assertEquals("Shopee", b.keluarga);
        assertTrue(b.alasan.contains("No. Pesanan"));
    }

    // --- yang tidak boleh ikut longgar -------------------------------------

    @Test public void nomor_pengiriman_kurir_ditolak_walau_berjangkar() {
        assertNull(OrderId.cari("Order ID: SPXID064183635268"));
        assertNull(OrderId.cari("No. Pesanan: JX1234567890123"));
    }

    @Test public void nilai_di_sebelah_kata_resi_tidak_pernah_jadi_order_id() {
        assertNull(OrderId.cari("No. Resi: " + ASLI));
        assertNull(OrderId.cari("AWB: " + SHOPEE));
    }

    @Test public void sembilan_belas_digit_bukan_pesanan() {
        // Di laporan, entri 19 digit seluruhnya referensi pencairan di muka
        // atau penyesuaian komisi -- bukan pesanan.
        assertNull(OrderId.cari("Package ID 1205938906612515436"));
        assertNull(OrderId.cari("1206362770642142504"));
    }

    @Test public void tidak_memotong_angka_yang_lebih_panjang() {
        assertNull(OrderId.cari("1206362770642142504"));
    }

    @Test public void menolak_memilih_kalau_dua_sama_kuat() {
        assertNull(OrderId.cari(ASLI + "\n585688912408380856"));
    }

    @Test public void jangkar_menang_atas_angka_telanjang() {
        assertEquals(ASLI, OrderId.cari("585688912408380856\nOrder ID: " + ASLI));
    }

    @Test public void angka_telanjang_18_digit_tetap_diterima() {
        assertEquals(ASLI, OrderId.cari("tokopedia Shop\n" + ASLI + "\nJNE"));
    }

    // --- tingkat sedang: ditawarkan, bukan ditolak diam-diam ---------------

    /**
     * Kode sortir kurir tidak bisa dibedakan bentuknya dari nomor pesanan
     * Shopee. Dulu itu alasan menolak SEMUA bentuk Shopee dari OCR -- membuang
     * yang benar bersama yang salah. Sekarang ia ditawarkan untuk dibenarkan,
     * dan yang memutuskan adalah orang yang memegang labelnya.
     */
    @Test public void shopee_tanpa_jangkar_ditawarkan_bukan_diterima() {
        String teks = "BW-33\n" + SHOPEE + "\nSPX";
        assertNull(OrderId.cari(teks));              // tidak otomatis
        OrderId.Bacaan b = OrderId.baca(teks);
        assertNotNull(b);                             // tapi tidak hilang
        assertEquals(SHOPEE, b.nilai);
        assertEquals("sedang", b.keyakinan);
        assertFalse(b.berjangkar);
    }

    @Test public void kode_sortir_juga_hanya_sampai_tingkat_sedang() {
        OrderId.Bacaan b = OrderId.baca("2605149T3NJJJN");
        assertNotNull(b);
        assertEquals("sedang", b.keyakinan);
    }

    // --- ketikan orang -----------------------------------------------------

    @Test public void ketikan_orang_jauh_lebih_longgar() {
        // Yang mengetik sedang memegang labelnya; bentuk apa pun yang masuk
        // akal diterima. Menolak di sini berarti menghentikan pekerjaan.
        assertEquals(SHOPEE, OrderId.dariKetikan(SHOPEE));
        assertEquals(ASLI, OrderId.dariKetikan(ASLI));
        assertEquals("INV20260827MPL123456", OrderId.dariKetikan("INV/20260827/MPL/123456"));
    }

    @Test public void ketikan_tetap_menolak_yang_jelas_bukan() {
        assertNull(OrderId.dariKetikan("SPXID064183635268"));
        assertNull(OrderId.dariKetikan("081234567890"));
        assertNull(OrderId.dariKetikan("12345"));
    }

    // --- dari korpus 309 label sungguhan -------------------------------

    @Test public void sisa_garis_barcode_di_tepi_tidak_jadi_angka() {
        // Cacat nyata: "|" ditafsirkan sebagai 1, hasilnya 26081505EJ88X71.
        assertEquals("260815D5EJ88X7", OrderId.cari("No. Pesanan: 260815D5EJ88X7|"));
    }

    @Test public void nama_layanan_kurir_tidak_jadi_nomor() {
        // Cacat nyata: "GrotbExpress" -> "6R0T8EXPRE55", ditawarkan.
        assertNull(OrderId.baca("Layanan GrotbExpress"));
        assertNull(OrderId.baca("No. Pesanan: GrotbExpress"));
    }

    @Test public void hasil_perbaikan_huruf_tidak_pernah_otomatis() {
        // Diukur di korpus: perbaikan huruf benar 5 kali, salah 13 kali.
        String[][] mentah = {
            {"S85367823326934914", "585367823326934914"},
            {"S85601186906867702", "585601186906867702"},
            {"S8S4896I1730814406", "585489611730814406"},
        };
        for (String[] m : mentah) {
            OrderId.Bacaan b = OrderId.baca("Order ID: " + m[0]);
            assertNotNull(m[0], b);
            // Yang ditawarkan bentuk 18-angkanya, tapi tidak pernah otomatis.
            assertEquals(m[0], m[1], b.nilai);
            assertEquals(m[0], "sedang", b.keyakinan);
            assertTrue(m[0] + " skor " + b.skor, b.skor < 0.80);
        }
    }

    @Test public void yang_terbaca_bersih_tetap_otomatis() {
        assertEquals("588426503116162183", OrderId.cari("Order ID: 588426503116162183"));
        assertEquals("2608246WS3ANCS", OrderId.cari("No. Pesanan: 2608246WS3ANCS"));
    }

    @Test public void nomor_resi_kurir_di_korpus_bukan_pesanan() {
        // 287 dari 311 barcode di korpus berbentuk ini.
        assertNull(OrderId.baca("JY1311292924"));
        assertNull(OrderId.baca("CM67961230459"));
    }

    @Test public void kosong_tetap_kosong() {
        assertNull(OrderId.cari(null));
        assertNull(OrderId.cari(""));
        assertNull(OrderId.dariOcr(null));
        assertNull(OrderId.dariKetikan(null));
    }
}
