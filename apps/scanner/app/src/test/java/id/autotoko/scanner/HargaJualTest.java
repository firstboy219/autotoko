package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * HargaJual adalah SALINAN dari kalkulator bersama yang dipakai web dan
 * backend. Salinan bisa menyimpang, dan yang menyimpang di sini adalah harga
 * yang dipakai orang memutuskan jual-beli. Tes ini yang menahannya.
 *
 * Angka yang dipakai bukan karangan: 42% adalah potongan TikTok Shop yang
 * terukur pada laporan penyelesaian sungguhan toko ini, dan 39.300 adalah
 * harga jual yang benar-benar ada di katalognya.
 */
public class HargaJualTest {

    private static HargaJual.Tarif tarif(double mp, double ev, double af,
                                         double iklan, double sedekah, double reseller,
                                         long iklanTetapSen) {
        HargaJual.Tarif t = new HargaJual.Tarif();
        t.marketplace = mp;
        t.event = ev;
        t.affiliator = af;
        t.iklan = iklan;
        t.sedekah = sedekah;
        t.reseller = reseller;
        t.iklanTetapSen = iklanTetapSen;
        return t;
    }

    @Test
    public void kasus_yang_jadi_alasan_layar_ini_ada() {
        // Rp 39.300 dengan potongan marketplace yang SEBENARNYA, 42%, bukan
        // 15% bawaan yang selama ini diketik sendiri di kolomnya.
        HargaJual.Rincian r = HargaJual.hitung(
                3_930_000L, 1_500_000L, tarif(0.42, 0, 0, 0, 0, 0, 0));

        assertEquals(1_650_600L, r.biayaMarketplaceSen);
        assertEquals(2_279_400L, r.cairSen);
        assertEquals(2_279_400L, r.bagianSellerSen);
        assertEquals(779_400L, r.labaBersihSen);
        assertEquals(0.1983, r.marginBersih, 0.0001);
    }

    @Test
    public void selisih_15_persen_lawan_42_persen_bukan_hal_kecil() {
        // Produk yang sama dinilai dengan angka bawaan lawan angka nyata.
        // Ini alasan kenapa saran dari laporan pencairan itu penting: yang
        // pertama terlihat sehat, yang kedua nyaris tidak.
        long hpp = 1_500_000L;
        HargaJual.Rincian bawaan = HargaJual.hitung(3_930_000L, hpp, tarif(0.15, 0, 0, 0, 0, 0, 0));
        HargaJual.Rincian nyata = HargaJual.hitung(3_930_000L, hpp, tarif(0.42, 0, 0, 0, 0, 0, 0));

        assertEquals(1_840_500L, bawaan.labaBersihSen);
        assertEquals(779_400L, nyata.labaBersihSen);
        // Labanya menyusut lebih dari separuh.
        assertTrue(nyata.labaBersihSen < bawaan.labaBersihSen / 2);
    }

    @Test
    public void jumlah_pembagian_selalu_sama_persis_dengan_yang_cair() {
        // Sisa diturunkan dengan pengurangan, bukan rumus kedua yang
        // dibulatkan lagi. Kalau invarian ini pecah, ada uang yang muncul atau
        // hilang di layar tanpa ada yang menerimanya.
        double[][] kombinasi = {
            {0.42, 0.025, 0.10}, {0.357, 0.05, 0.15}, {0.15, 0.0, 0.0},
            {0.42, 0.033, 0.07}, {0.60, 0.10, 0.30}, {0.0, 0.025, 0.0},
        };
        for (double[] k : kombinasi) {
            for (long harga : new long[]{1L, 999L, 3_930_000L, 4_930_000L, 25_260_000L}) {
                HargaJual.Rincian r = HargaJual.hitung(
                        harga, 1_000_000L, tarif(k[0], 0, 0, 0, k[1], k[2], 0));
                assertEquals("harga=" + harga + " tarif=" + k[0],
                        r.cairSen, r.sedekahSen + r.resellerSen + r.bagianSellerSen);
            }
        }
    }

    @Test
    public void reseller_nol_bukan_sub_seller_nol_persen() {
        // Keduanya menghasilkan bagian seller yang sama, tapi lewat jalur yang
        // berbeda di modul Pencairan. Yang dijaga di sini: tidak ada baris
        // reseller yang muncul untuk toko milik seller sendiri.
        HargaJual.Rincian r = HargaJual.hitung(
                1_000_000L, 0L, tarif(0, 0, 0, 0, 0.025, 0, 0));
        assertEquals(25_000L, r.sedekahSen);
        assertEquals(0L, r.resellerSen);
        assertEquals(975_000L, r.bagianSellerSen);
    }

    @Test
    public void sedekah_dari_yang_cair_reseller_dari_sisanya() {
        // Urutannya, bukan sekadar angkanya. Sedekah 2,5% dari yang cair;
        // reseller 10% dari yang TERSISA sesudah sedekah -- bukan dari yang
        // cair, dan bukan dari harga publish.
        HargaJual.Rincian r = HargaJual.hitung(
                1_000_000L, 0L, tarif(0, 0, 0, 0, 0.025, 0.10, 0));
        assertEquals(1_000_000L, r.cairSen);
        assertEquals(25_000L, r.sedekahSen);
        assertEquals(97_500L, r.resellerSen);   // 10% dari 975.000
        assertEquals(877_500L, r.bagianSellerSen);
    }

    @Test
    public void tarif_yang_melewati_seratus_persen_tidak_membuat_cair_negatif() {
        // Marketplace tidak pernah mentransfer angka minus. Kerugiannya harus
        // muncul di laba bersih, tempat orang mencarinya.
        HargaJual.Rincian r = HargaJual.hitung(
                1_000_000L, 200_000L, tarif(0.6, 0.3, 0.2, 0, 0, 0, 0));
        assertEquals(0L, r.cairSen);
        assertEquals(0L, r.bagianSellerSen);
        assertEquals(-200_000L, r.labaBersihSen);
        assertTrue(r.marginBersih < 0);
    }

    @Test
    public void iklan_tetap_ditambahkan_di_luar_persentase() {
        HargaJual.Rincian r = HargaJual.hitung(
                1_000_000L, 0L, tarif(0, 0, 0, 0.05, 0, 0, 30_000L));
        assertEquals(80_000L, r.iklanSen);       // 5% dari sejuta + Rp 300
        assertEquals(920_000L, r.labaBersihSen);
    }

    @Test
    public void tarif_di_luar_jangkauan_dijepit_bukan_ditolak() {
        // Orang mengetik "150" di kolom persen. Yang tidak boleh terjadi:
        // potongan lebih besar dari harganya, atau potongan negatif.
        HargaJual.Rincian tinggi = HargaJual.hitung(
                1_000_000L, 0L, tarif(1.5, 0, 0, 0, 0, 0, 0));
        assertEquals(1_000_000L, tinggi.biayaMarketplaceSen);
        assertEquals(0L, tinggi.cairSen);

        HargaJual.Rincian minus = HargaJual.hitung(
                1_000_000L, 0L, tarif(-0.5, 0, 0, 0, 0, 0, 0));
        assertEquals(0L, minus.biayaMarketplaceSen);
        assertEquals(1_000_000L, minus.cairSen);
    }

    @Test
    public void harga_nol_tidak_membagi_dengan_nol() {
        HargaJual.Rincian r = HargaJual.hitung(0L, 1_000_000L, tarif(0.42, 0, 0, 0, 0, 0, 0));
        assertEquals(0.0, r.marginBersih, 0.0);
        assertEquals(-1_000_000L, r.labaBersihSen);
    }

    @Test
    public void saran_harga_bolak_balik_menghasilkan_margin_yang_diminta() {
        // Uji terpenting di berkas ini: saran harga dan air terjunnya harus
        // saling cocok. Kalau tidak, layar menyarankan harga lalu langsung
        // menampilkan margin yang berbeda dari yang dijanjikan -- dan yang
        // salah tidak akan kelihatan mana.
        long hpp = 1_500_000L;
        HargaJual.Tarif t = tarif(0.42, 0, 0.05, 0.02, 0.025, 0.10, 30_000L);

        Long sen = HargaJual.hargaPublishDiperlukanSen(hpp, t, 0.20);
        assertNotNull(sen);

        HargaJual.Rincian r = HargaJual.hitung(sen, hpp, t);
        // Pembulatan per tahap menggeser sedikit; yang dijaga adalah tidak
        // pernah DI BAWAH target, karena saran yang meleset ke bawah membuat
        // orang memasang harga yang tidak mencapai marginnya.
        assertTrue("margin=" + r.marginBersih, r.marginBersih >= 0.20 - 0.0005);
        assertTrue("margin=" + r.marginBersih, r.marginBersih <= 0.20 + 0.005);
    }

    @Test
    public void saran_harga_tanpa_potongan_apa_pun_bentuknya_sederhana() {
        // hpp 30.000 dengan target margin 20% dan tanpa potongan: harganya
        // 30.000 / 0,8 = 37.500. Angka yang bisa diperiksa di kepala.
        Long sen = HargaJual.hargaPublishDiperlukanSen(
                3_000_000L, tarif(0, 0, 0, 0, 0, 0, 0), 0.20);
        assertNotNull(sen);
        assertEquals(3_750_000L, (long) sen);

        HargaJual.Rincian r = HargaJual.hitung(sen, 3_000_000L, tarif(0, 0, 0, 0, 0, 0, 0));
        assertEquals(0.20, r.marginBersih, 0.0000001);
    }

    @Test
    public void target_yang_tidak_mungkin_menjawab_null_bukan_angka_raksasa() {
        // Potongan sudah menghabiskan harga jual. Tidak ada harga yang
        // mencapai target, dan mengatakannya lebih berguna daripada
        // menyarankan Rp 900 juta.
        assertNull(HargaJual.hargaPublishDiperlukanSen(
                3_000_000L, tarif(0.6, 0.3, 0.2, 0, 0, 0, 0), 0.20));

        // Target 90% dengan potongan 42% juga tidak mungkin.
        assertNull(HargaJual.hargaPublishDiperlukanSen(
                3_000_000L, tarif(0.42, 0, 0, 0, 0, 0, 0), 0.90));
    }

    @Test
    public void saran_untuk_laba_rupiah_tetap() {
        // Tanpa potongan: harga = hpp + laba yang diminta.
        Long sen = HargaJual.hargaPublishUntukLabaSen(
                3_000_000L, tarif(0, 0, 0, 0, 0, 0, 0), 1_000_000L);
        assertNotNull(sen);
        assertEquals(4_000_000L, (long) sen);

        HargaJual.Rincian r = HargaJual.hitung(sen, 3_000_000L, tarif(0, 0, 0, 0, 0, 0, 0));
        assertEquals(1_000_000L, r.labaBersihSen);
    }

    @Test
    public void rupiah_dari_sen_dibulatkan_ke_atas() {
        // Rp 9.259,26 tidak pernah dipasang sebagai harga; yang dipasang
        // Rp 9.260. Dibulatkan ke ATAS supaya marginnya tidak turun di bawah
        // target hanya karena pembulatan.
        assertEquals(9_260L, HargaJual.rupiahDariSen(925_926L));
        assertEquals(100L, HargaJual.rupiahDariSen(10_000L));
        assertEquals(1L, HargaJual.rupiahDariSen(1L));
        assertEquals(0L, HargaJual.rupiahDariSen(0L));
    }

    @Test
    public void hpp_negatif_tidak_menambah_laba() {
        // Data rusak tidak boleh terbaca sebagai keuntungan.
        HargaJual.Rincian r = HargaJual.hitung(1_000_000L, -500_000L, tarif(0, 0, 0, 0, 0, 0, 0));
        assertEquals(0L, r.hppSen);
        assertEquals(1_000_000L, r.labaBersihSen);
    }
}
