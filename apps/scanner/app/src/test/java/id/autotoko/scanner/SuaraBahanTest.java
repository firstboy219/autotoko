package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

/**
 * Keputusan "kapan panduan nota berhenti".
 *
 * Kalau salah, gagalnya berupa orang berdiri di depan kamera tanpa ujung
 * sambil memegang kardus -- kegagalan yang tidak melempar apa pun dan tidak
 * muncul di log mana pun.
 */
public class SuaraBahanTest {

    private static List<ProductMatcher.Product> katalog() {
        List<ProductMatcher.Product> k = new ArrayList<>();
        k.add(new ProductMatcher.Product("aq", "Aquades", "ml"));
        k.add(new ProductMatcher.Product("jo", "Jojoba Oil", "ml"));
        k.add(new ProductMatcher.Product("bs", "Botol Spray 100ml", "pcs"));
        k.add(new ProductMatcher.Product("tali", "Tali Mini Leher", "pcs"));
        return k;
    }

    private static void frame(SuaraBahan s, String teks) {
        s.catat(ProductMatcher.cariDiTeks(teks, katalog(), 3));
    }

    @Test public void satu_frame_belum_cukup() {
        SuaraBahan s = new SuaraBahan();
        frame(s, "Nota: Aquades 5 liter");
        assertEquals(1, s.frame());
        assertEquals(0, s.disepakati());
        assertFalse(SuaraBahan.selesai(s.disepakati(), 3000));
    }

    @Test public void beberapa_frame_yang_sepakat_jadi_bukti() {
        SuaraBahan s = new SuaraBahan();
        for (int i = 0; i < SuaraBahan.SUARA_MIN; i++) frame(s, "Nota: Aquades 5 liter");
        assertEquals(1, s.disepakati());
        assertEquals(SuaraBahan.SUARA_MIN, s.suaraUntuk("aq"));
    }

    /**
     * Berhenti pada bukti pertama berarti berhenti sebelum kamera sempat
     * melihat baris nota yang lain.
     */
    @Test public void tidak_berhenti_sebelum_batas_bawah() {
        assertFalse(SuaraBahan.selesai(1, SuaraBahan.MIN_MS - 1));
        assertTrue(SuaraBahan.selesai(1, SuaraBahan.MIN_MS));
    }

    /**
     * Terukur: 17 dari 19 pengiriman yang ada tidak memuat nama bahan sama
     * sekali di teksnya. Tanpa batas atas, panduannya tidak pernah berhenti.
     */
    @Test public void selalu_berhenti_saat_waktunya_habis() {
        assertFalse(SuaraBahan.selesai(0, SuaraBahan.MAKS_MS - 1));
        assertTrue(SuaraBahan.selesai(0, SuaraBahan.MAKS_MS));
        assertTrue(SuaraBahan.selesai(0, SuaraBahan.MAKS_MS + 5000));
    }

    @Test public void batas_bawah_lebih_dulu_dari_batas_atas() {
        assertTrue("batas bawah harus lebih kecil", SuaraBahan.MIN_MS < SuaraBahan.MAKS_MS);
    }

    @Test public void dua_bahan_di_nota_terhitung_dua() {
        SuaraBahan s = new SuaraBahan();
        for (int i = 0; i < SuaraBahan.SUARA_MIN; i++) {
            frame(s, "Nota Pembelian\nAquades 5 liter\nJojoba Oil 100ml");
        }
        assertEquals(2, s.disepakati());
    }

    /** Label kurir sungguhan dari basis data: tidak boleh menghasilkan suara. */
    @Test public void label_kurir_tidak_menghasilkan_suara() {
        SuaraBahan s = new SuaraBahan();
        for (String teks : new String[]{
            "[COD Cek Dulu: Tidak]", "[JTN-A-04, SPX]",
            "[A-319, S Shopee, JTN-A-04, SPX, STD]",
        }) {
            for (int i = 0; i < 5; i++) frame(s, teks);
        }
        assertEquals(0, s.disepakati());
        assertTrue("frame tetap dihitung", s.frame() > 0);
        // Dan karena tidak ada yang dikenali, yang menghentikannya hanya waktu.
        assertFalse(SuaraBahan.selesai(s.disepakati(), SuaraBahan.MIN_MS));
        assertTrue(SuaraBahan.selesai(s.disepakati(), SuaraBahan.MAKS_MS));
    }

    @Test public void dikosongkan_saat_pengiriman_berikutnya() {
        SuaraBahan s = new SuaraBahan();
        for (int i = 0; i < 5; i++) frame(s, "Aquades 5 liter");
        s.kosongkan();
        assertEquals(0, s.frame());
        assertEquals(0, s.disepakati());
        assertEquals(0, s.suaraUntuk("aq"));
    }

    @Test public void aman_untuk_masukan_kosong() {
        SuaraBahan s = new SuaraBahan();
        s.catat(null);
        frame(s, "");
        assertEquals(0, s.disepakati());
    }
}
