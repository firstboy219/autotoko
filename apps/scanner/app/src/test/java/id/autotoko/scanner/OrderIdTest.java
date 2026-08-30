package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Order id sekarang WAJIB, jadi aturannya menentukan apakah sebuah paket bisa
 * disimpan sama sekali. Terlalu longgar: sampah masuk dan audit menuduh
 * marketplace atas kegagalan kita. Terlalu ketat: paket Shopee mustahil
 * disimpan dan pekerjaan berhenti.
 *
 * Nilainya diambil dari data sungguhan -- order id asli dari laporan
 * penyelesaian, dan sampah asli yang pernah tersimpan di kolom ini.
 */
public class OrderIdTest {

    private static final String ASLI = "585623070310172189";

    @Test public void ocr_menerima_18_digit() {
        assertEquals(ASLI, OrderId.dariOcr(ASLI));
    }

    @Test public void ocr_memperbaiki_huruf_yang_tertukar_angka() {
        assertEquals(ASLI, OrderId.dariOcr("S85623070310172189"));
        assertEquals(ASLI, OrderId.dariOcr("5856230703101721B9"));
    }

    @Test public void ocr_menolak_yang_masih_bersisa_huruf() {
        // Nomor pengiriman Shopee, bukan order id: H tidak ada di peta.
        assertNull(OrderId.dariOcr("SH8476199355610969"));
        assertNull(OrderId.dariOcr("SHS4BSTISSIATTO04E"));
    }

    @Test public void ocr_menolak_kode_sortir_kurir() {
        assertNull(OrderId.dariOcr("2605149T3NJJJN"));
        assertNull(OrderId.dariOcr("260B100JHWOY"));
    }

    @Test public void ocr_menolak_19_digit() {
        // Di laporan, entri 19 digit seluruhnya referensi pencairan di muka
        // atau penyesuaian komisi -- bukan pesanan.
        assertNull(OrderId.dariOcr("3690853782936651237"));
    }

    @Test public void ocr_mengabaikan_spasi_dan_pemisah() {
        assertEquals(ASLI, OrderId.dariOcr("5856 2307 0310 172189"));
        assertEquals(ASLI, OrderId.dariOcr("585623-070310-172189"));
    }

    /* ------------------------------------------------------------ ketikan */

    @Test public void ketikan_menerima_bentuk_shopee() {
        // Tanpa ini, mewajibkan order id memblokir seluruh marketplace Shopee.
        assertEquals("260828H020F080", OrderId.dariKetikan("260828H020F080"));
        assertEquals("260828H020F080", OrderId.dariKetikan("260828h020f080"));
    }

    @Test public void ketikan_tetap_menerima_18_digit() {
        assertEquals(ASLI, OrderId.dariKetikan(ASLI));
    }

    @Test public void ketikan_tetap_menolak_yang_bukan_apa_apa() {
        assertNull(OrderId.dariKetikan("abc"));
        assertNull(OrderId.dariKetikan("12"));
        assertNull(OrderId.dariKetikan(""));
        assertNull(OrderId.dariKetikan(null));
    }

    /* -------------------------------------------------------------- cari */

    @Test public void cari_yang_berjangkar() {
        assertEquals(ASLI, OrderId.cari("Penerima: Budi\nOrder ID : " + ASLI + "\nJNE REG"));
        assertEquals(ASLI, OrderId.cari("No. Pesanan " + ASLI));
    }

    @Test public void cari_angka_telanjang() {
        assertEquals(ASLI, OrderId.cari("tokopedia Shop\n" + ASLI + "\nJNE"));
    }

    /**
     * Pemeriksaan paling penting di berkas ini.
     *
     * Tanpa batas non-digit, pola 18 angka mencocok DELAPAN BELAS ANGKA PERTAMA
     * dari package id 19 digit dan menghasilkan order id terpotong satu angka.
     * Bentuknya sempurna, nilainya salah, dan tidak akan pernah berpasangan
     * dengan laporan mana pun.
     */
    @Test public void cari_tidak_memotong_angka_lebih_panjang() {
        assertNull(OrderId.cari("Package ID 1205938906612515436"));
        assertNull(OrderId.cari("1206362770642142504"));
    }

    @Test public void cari_menolak_memilih_kalau_ada_dua_yang_berbeda() {
        assertNull(OrderId.cari(ASLI + "\n585688912408380856"));
    }

    @Test public void cari_angka_sama_dua_kali_tetap_terbaca() {
        // Label sering mencetak nomor yang sama di dua tempat; itu bukan
        // ambiguitas.
        assertEquals(ASLI, OrderId.cari(ASLI + "\nbla bla\n" + ASLI));
    }

    @Test public void jangkar_menang_atas_angka_telanjang() {
        assertEquals(ASLI, OrderId.cari("585688912408380856\nOrder ID: " + ASLI));
    }
}
