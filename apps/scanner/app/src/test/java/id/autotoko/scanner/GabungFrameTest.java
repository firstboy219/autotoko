package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Tata letak gambar gabungan.
 *
 * Yang diuji di sini hitungannya, bukan penggambarannya: batas memori dan
 * batas ukuran adalah tempat gambar gabungan bisa menjatuhkan aplikasi di
 * tengah paket yang sedang dipegang, dan itu justru yang paling mudah lolos
 * dari pemeriksaan mata.
 */
public class GabungFrameTest {

    @Test public void empat_bidikan_jadi_kisi_dua_kali_dua() {
        assertEquals(2, GabungFrame.kolom(4));
        assertEquals(2, GabungFrame.baris(4));
    }

    @Test public void tiga_bidikan_tetap_dua_kolom() {
        assertEquals(2, GabungFrame.kolom(3));
        assertEquals(2, GabungFrame.baris(3)); // satu sel kosong, kisinya rapi
    }

    @Test public void satu_bidikan_tidak_perlu_kisi() {
        assertEquals(1, GabungFrame.kolom(1));
        assertEquals(1, GabungFrame.baris(1));
    }

    /**
     * Batas yang paling penting. Kanvas yang melewatinya berarti aplikasi mati
     * kehabisan memori, dan matinya terjadi tepat saat paket sedang dipegang.
     */
    @Test public void kanvas_tidak_pernah_melewati_anggaran_piksel() {
        int[][] sumber = {{2560, 1920}, {1920, 2560}, {4000, 3000}, {1080, 1920}};
        for (int n = 1; n <= 6; n++) {
            for (int[] s : sumber) {
                int[] u = GabungFrame.ukuran(n, s[0], s[1]);
                long piksel = (long) u[0] * u[1];
                assertTrue("n=" + n + " " + s[0] + "x" + s[1] + " -> " + u[0] + "x" + u[1]
                        + " = " + piksel, piksel <= GabungFrame.MAKS_PIKSEL);
                assertTrue("sisi terpanjang " + Math.max(u[0], u[1]),
                        Math.max(u[0], u[1]) <= GabungFrame.MAKS_SISI);
            }
        }
    }

    /**
     * Setara Full HD atau lebih. Kalau tidak, penggabungannya justru membuang
     * ketajaman yang sudah susah payah didapat dengan memotret dari dekat.
     */
    @Test public void kanvas_setidaknya_setara_full_hd() {
        int[] u = GabungFrame.ukuran(4, 2560, 1920);
        long piksel = (long) u[0] * u[1];
        assertTrue("hanya " + u[0] + "x" + u[1], piksel >= 1920L * 1080L);
    }

    @Test public void sel_menyisakan_jalur_untuk_nama_tahap() {
        int[] u = GabungFrame.ukuran(4, 2560, 1920);
        int lebarSel = u[2], tinggiSel = u[3];
        // Tinggi sel harus lebih dari sekadar gambarnya: ada jalur nama.
        assertTrue(tinggiSel > Math.round(lebarSel * (1920f / 2560f)));
    }

    /**
     * Bidikan tidak boleh dipotong untuk memenuhi selnya -- tepi label sering
     * justru yang memuat nomor pesanannya.
     */
    @Test public void bidikan_dimuat_utuh_tanpa_dipotong() {
        int[] r = GabungFrame.muat(1000, 800, 2560, 1920);
        assertTrue("lebar " + r[2] + " melewati sel", r[2] <= 1000);
        assertTrue("tinggi " + r[3] + " melewati sel", r[3] <= 800);
        // Rasionya dipertahankan.
        float rasioAsal = 1920f / 2560f;
        float rasioHasil = (float) r[3] / r[2];
        assertTrue(Math.abs(rasioAsal - rasioHasil) < 0.02f);
    }

    @Test public void bidikan_tegak_juga_muat() {
        int[] r = GabungFrame.muat(1000, 800, 1080, 1920);
        assertTrue(r[2] <= 1000);
        assertTrue(r[3] <= 800);
        assertTrue("harus terpusat", r[0] > 0);
    }

    /**
     * Pengecilan yang berlebihan tidak bisa dibatalkan: sekali piksel dibuang
     * saat memuat, ia tidak kembali betapa pun besar gambarnya digambar.
     */
    @Test public void sampel_tidak_pernah_mengecilkan_di_bawah_sel() {
        int s = GabungFrame.sampel(2560, 1920, 1000, 750);
        assertEquals(2, s);
        assertTrue("2560/" + s + " harus >= 1000", 2560 / s >= 1000);

        s = GabungFrame.sampel(4000, 3000, 500, 375);
        assertTrue("4000/" + s + " harus >= 500", 4000 / s >= 500);
    }

    @Test public void sampel_satu_kalau_gambarnya_sudah_kecil() {
        assertEquals(1, GabungFrame.sampel(800, 600, 1000, 750));
        assertEquals(1, GabungFrame.sampel(0, 0, 100, 100));
    }

    @Test public void ukuran_aman_untuk_masukan_ngawur() {
        int[] u = GabungFrame.ukuran(0, 100, 100);
        assertEquals(0, u[0]);
        u = GabungFrame.ukuran(4, 0, 0);
        assertEquals(0, u[0]);
        int[] r = GabungFrame.muat(100, 100, 0, 0);
        assertEquals(0, r[2]);
    }
}
