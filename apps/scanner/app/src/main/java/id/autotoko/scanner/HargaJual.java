package id.autotoko.scanner;

/**
 * Susunan harga jual: dari harga publish sampai laba bersih seller.
 *
 * TIRUAN PERSIS dari packages/shared/src/costing.ts yang dipakai web dan
 * backend. Disalin, bukan dipanggil lewat endpoint, karena layar ini harus
 * menghitung ulang sambil orang mengetik -- menunggu jaringan tiap ketukan
 * membuat angka tertinggal di belakang jari, dan satu-satunya hal yang lebih
 * buruk daripada angka yang lambat adalah angka yang salah sesaat.
 *
 * Karena disalin, ia bisa menyimpang. Itulah yang dijaga HargaJualTest: hasil
 * di sini harus sama sampai ke satu sen dengan hitungan web, sebab keduanya
 * dipakai orang yang sama untuk memutuskan harga yang sama.
 *
 * SATUANNYA SEN (rupiah x 100), bilangan bulat. Bukan kesopanan: menghitung
 * uang dengan pecahan desimal membuat 42% dari Rp 39.300 berbeda beberapa sen
 * tergantung urutan operasinya, dan selisih itu muncul di layar sebagai laba
 * yang tidak bisa dijelaskan.
 *
 * URUTANNYA PENTING dan bukan sembarang. Marketplace memotong dari harga
 * PUBLISH; sedekah dan reseller memotong dari yang CAIR; HPP dan iklan
 * ditanggung seller dari bagiannya sendiri. Menukar salah satu tahap akan
 * menghasilkan angka yang tetap masuk akal dibaca tapi tidak pernah cocok
 * dengan rekening.
 */
final class HargaJual {

    private HargaJual() {}

    /** Tarif potongan. Pecahan 0..1, BUKAN persen -- 0.42, bukan 42. */
    static final class Tarif {
        double marketplace;
        double event;
        double affiliator;
        double iklan;
        double sedekah;
        double reseller;
        /** Iklan yang rupiahnya tetap per pcs, di luar persentase. */
        long iklanTetapSen;
    }

    static final class Rincian {
        long hargaPublishSen;

        /* ---- ditahan marketplace, dihitung dari harga publish ---- */
        long biayaMarketplaceSen;
        long eventSen;
        long affiliatorSen;
        long ditahanMarketplaceSen;

        /** Yang benar-benar ditransfer marketplace ke rekening seller. */
        long cairSen;

        /* ---- diambil saat dana itu dicairkan ---- */
        long sedekahSen;
        long resellerSen;
        /** Bagian seller sesudah sedekah dan reseller, sebelum biayanya sendiri. */
        long bagianSellerSen;

        /* ---- biaya seller sendiri ---- */
        long hppSen;
        long iklanSen;

        long labaBersihSen;
        /** Laba bersih dibagi harga publish. Nol bila harganya nol. */
        double marginBersih;
    }

    /**
     * Tarif di luar 0..1 diperlakukan sebagai batasnya, bukan ditolak.
     *
     * Orang mengetik "150" di kolom persen, dan menolaknya di tengah pengetikan
     * membuat kolomnya melompat. Yang penting hasilnya tidak pernah mengarang
     * potongan negatif atau lebih besar dari harganya.
     */
    static double batas01(double r) {
        if (Double.isNaN(r) || Double.isInfinite(r)) return 0;
        if (r < 0) return 0;
        if (r > 1) return 1;
        return r;
    }

    /**
     * Air terjun potongan untuk SATU pcs terjual.
     *
     * Pembagian sedekah/reseller sengaja mengikuti calculatePayoutSplit dengan
     * basis "total_credit" dan tanpa sub-sub-seller -- itulah yang dipanggil
     * costing.ts, dan halaman ini adalah PROYEKSI dari apa yang nanti benar-
     * benar dikerjakan modul Pencairan. Menghitungnya dengan cara lain di sini
     * berarti dua jawaban untuk satu pertanyaan uang.
     */
    static Rincian hitung(long hargaPublishSen, long hppSen, Tarif t) {
        Rincian r = new Rincian();
        long P = Math.max(0, hargaPublishSen);
        r.hargaPublishSen = P;

        r.biayaMarketplaceSen = Math.round(P * batas01(t.marketplace));
        r.eventSen = Math.round(P * batas01(t.event));
        r.affiliatorSen = Math.round(P * batas01(t.affiliator));
        r.ditahanMarketplaceSen = r.biayaMarketplaceSen + r.eventSen + r.affiliatorSen;

        // Tidak ada transfer bernilai negatif. Kalau tarifnya melewati 100%,
        // yang cair berhenti di nol dan kerugiannya muncul di laba bersih --
        // bukan disembunyikan sebagai "cair minus" yang tidak pernah terjadi.
        r.cairSen = Math.max(0, P - r.ditahanMarketplaceSen);

        double sedekahRate = batas01(t.sedekah);
        double resellerRate = batas01(t.reseller);

        r.sedekahSen = Math.round(r.cairSen * sedekahRate);
        long sesudahSedekah = r.cairSen - r.sedekahSen;
        if (resellerRate > 0) {
            // Sisa dihitung dengan PENGURANGAN, bukan rumus kedua yang
            // dibulatkan lagi. Itulah yang membuat sedekah + reseller + seller
            // selalu sama persis dengan yang cair.
            r.resellerSen = Math.round(sesudahSedekah * resellerRate);
            r.bagianSellerSen = sesudahSedekah - r.resellerSen;
        } else {
            // Reseller nol bukan "sub-seller 0%", melainkan toko milik seller
            // sendiri. Bedanya nyata di modul Pencairan, jadi dijaga sama.
            r.resellerSen = 0;
            r.bagianSellerSen = sesudahSedekah;
        }

        r.iklanSen = Math.round(P * batas01(t.iklan)) + Math.max(0, t.iklanTetapSen);
        r.hppSen = Math.max(0, hppSen);
        r.labaBersihSen = r.bagianSellerSen - r.hppSen - r.iklanSen;
        r.marginBersih = P > 0 ? (double) r.labaBersihSen / (double) P : 0;
        return r;
    }

    /**
     * Harga publish yang diperlukan supaya margin bersihnya mencapai target.
     *
     * Bentuk tertutup, mengabaikan pembulatan per tahap:
     *   K = (1 - mp - event - aff) x (1 - sedekah) x (1 - reseller)
     *   laba(P) = P x (K - tarifIklan) - hpp - iklanTetap
     * sehingga untuk target margin m:  P = (hpp + iklanTetap) / (K - tarifIklan - m)
     *
     * MENGEMBALIKAN null bila penyebutnya nol atau negatif, yaitu ketika
     * struktur biayanya memakan harga lebih cepat daripada harga itu tumbuh --
     * tidak ada harga yang mencapai target. Itu jawaban yang benar, dan jauh
     * lebih berguna daripada angka raksasa yang terlihat seperti saran.
     */
    static Long hargaPublishDiperlukanSen(long hppSen, Tarif t, double targetMargin) {
        double K = (1 - batas01(t.marketplace) - batas01(t.event) - batas01(t.affiliator))
                * (1 - batas01(t.sedekah))
                * (1 - batas01(t.reseller));
        double tarifIklan = batas01(t.iklan);
        double tetap = hppSen + Math.max(0, t.iklanTetapSen);

        double penyebut = K - tarifIklan - targetMargin;
        if (Double.isNaN(penyebut) || Double.isInfinite(penyebut) || penyebut <= 0) return null;

        double harga = tetap / penyebut;
        if (Double.isNaN(harga) || Double.isInfinite(harga) || harga < 0) return null;
        return (long) Math.ceil(harga);
    }

    /**
     * Harga publish yang diperlukan untuk laba tetap dalam rupiah.
     *
     * Dipakai endpoint suggest-price dengan kind "profit"; disediakan di sini
     * supaya layar bisa menawarkannya tanpa bolak-balik ke server.
     */
    static Long hargaPublishUntukLabaSen(long hppSen, Tarif t, long labaTargetSen) {
        double K = (1 - batas01(t.marketplace) - batas01(t.event) - batas01(t.affiliator))
                * (1 - batas01(t.sedekah))
                * (1 - batas01(t.reseller));
        double penyebut = K - batas01(t.iklan);
        if (Double.isNaN(penyebut) || Double.isInfinite(penyebut) || penyebut <= 0) return null;

        double harga = (hppSen + Math.max(0, t.iklanTetapSen) + labaTargetSen) / penyebut;
        if (Double.isNaN(harga) || Double.isInfinite(harga) || harga < 0) return null;
        return (long) Math.ceil(harga);
    }

    /* ------------------------------------------------------------ pembantu */

    /** Rupiah bulat dari sen, dibulatkan ke ATAS -- tidak ada yang memasang Rp 9.259,26. */
    static long rupiahDariSen(long sen) {
        return (long) Math.ceil(sen / 100.0);
    }

    static long senDariRupiah(double rupiah) {
        return Math.round(rupiah * 100);
    }
}
