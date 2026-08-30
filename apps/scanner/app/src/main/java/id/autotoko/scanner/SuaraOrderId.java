package id.autotoko.scanner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Mengumpulkan pembacaan dari SEMUA frame, lalu memilih yang paling didukung.
 *
 * KENAPA ADA. Pemindaian satu resi menghasilkan ratusan frame -- di hasil tes
 * tercatat 154 -- tapi keputusannya diambil dari satu frame yang kebetulan
 * sedang dilihat. Frame ke-3 boleh saja membaca "26O827EXWKKVDE" dan frame
 * ke-4 membaca "260827EXWKKVDE"; yang lama hanya melihat satu dari keduanya
 * dan tidak punya cara tahu mana yang benar. Ratusan pembacaan bebas atas
 * kertas yang sama adalah bukti yang dibuang percuma.
 *
 * DUA LAPIS.
 *
 * 1. Suara per nilai. Nilai yang muncul berulang dari frame yang berbeda lebih
 *    layak dipercaya daripada yang muncul sekali.
 * 2. Suara per HURUF. Nilai-nilai yang panjangnya sama dan hampir serupa
 *    dianggap satu benda yang terbaca berbeda-beda, lalu setiap posisi
 *    diputuskan sendiri secara terbanyak. Tiga frame membaca 'D' dan satu
 *    membaca '0' pada posisi yang sama menghasilkan 'D' -- perbaikan yang
 *    mustahil dilakukan satu frame, sejernih apa pun.
 *
 * SATU BATAS YANG DISENGAJA. Banyaknya suara boleh MENGUATKAN, tapi tidak
 * boleh menaikkan tebakan tanpa jangkar menjadi otomatis. Kode sortir kurir
 * juga tercetak di label dan juga akan terbaca ratusan kali; kalau suara saja
 * bisa membuat sesuatu diterima otomatis, ia akan diterima otomatis. Maka
 * tanpa tulisan "No. Pesanan" di sebelahnya, skornya ditahan di bawah ambang
 * dan nilainya DITAWARKAN untuk dibenarkan, bukan disimpan diam-diam.
 */
final class SuaraOrderId {

    /**
     * Nilai berbeda yang masih ditampung. Label yang buram menghasilkan bacaan
     * baru hampir setiap frame; tanpa batas, peta ini tumbuh sepanjang paket
     * itu dipegang dan penggugusan yang berbiaya kuadrat ikut tumbuh bersamanya.
     * Sesudah batas ini yang sudah ada tetap dihitung, hanya yang baru berhenti
     * ditampung -- yang benar hampir pasti sudah masuk jauh sebelumnya.
     */
    private static final int MUAT = 400;

    private final Map<String, Integer> suara = new HashMap<>();
    private final Map<String, OrderId.Bacaan> terbaik = new HashMap<>();
    /** Nilai yang datang dari barcode, yang punya checksum. */
    private final java.util.Set<String> dariBarcode = new java.util.HashSet<>();
    private int frame;
    private int frameBerisi;

    /**
     * Satu frame teks OCR.
     *
     * Dipanggil dari utas pembaca kamera, sementara panel membaca hasilnya
     * dari utas utama empat kali sedetik -- karena itu seluruh kelas ini
     * dikunci. Tanpa itu, penggugusan bisa berjalan di atas peta yang sedang
     * berubah, dan kegagalannya akan muncul sebagai kerusakan sesekali yang
     * mustahil ditirukan.
     */
    synchronized void catat(String teks) {
        frame++;
        List<OrderId.Bacaan> hasil = OrderId.semua(teks);
        if (hasil.isEmpty()) return;
        frameBerisi++;
        for (OrderId.Bacaan b : hasil) {
            Integer n = suara.get(b.nilai);
            if (n == null && suara.size() >= MUAT) continue;
            suara.put(b.nilai, n == null ? 1 : n + 1);
            OrderId.Bacaan lama = terbaik.get(b.nilai);
            if (lama == null || b.skor > lama.skor) terbaik.put(b.nilai, b);
        }
    }

    /**
     * Nilai dari sebuah BARCODE, bukan dari OCR.
     *
     * Diberi dorongan besar karena barcode punya checksum: yang terbaca salah
     * tidak lolos sama sekali, sementara OCR yang terbaca salah menghasilkan
     * untaian yang bentuknya sempurna dan isinya keliru. Diukur di korpus,
     * perbaikan huruf pada OCR menghasilkan nilai salah 13 dari 19 kali;
     * barcode tidak punya mode kegagalan seperti itu.
     *
     * Pemeriksaan bentuknya TIDAK dilonggarkan. Nomor pengiriman kurir juga
     * datang sebagai barcode -- 287 dari 311 kode di korpus justru berbentuk
     * itu -- dan ia tetap harus lolos keluarga bentuk yang sama seperti
     * bacaan OCR. Yang berubah hanya seberapa dipercaya sesudah lolos.
     */
    synchronized void catatBarcode(String nilai) {
        OrderId.Bacaan dasar = OrderId.skorkan(nilai, false, false);
        if (dasar == null) return;
        double skor = Math.min(1.0, dasar.skor + 0.35);
        OrderId.Bacaan b = new OrderId.Bacaan(
                dasar.nilai, skor, dasar.keluarga, dasar.berjangkar,
                dasar.alasan + ", terbaca dari barcode");
        dariBarcode.add(b.nilai);
        Integer n = suara.get(b.nilai);
        suara.put(b.nilai, n == null ? 1 : n + 1);
        OrderId.Bacaan lama = terbaik.get(b.nilai);
        if (lama == null || b.skor > lama.skor) terbaik.put(b.nilai, b);
    }

    synchronized void kosongkan() {
        suara.clear();
        terbaik.clear();
        dariBarcode.clear();
        frame = 0;
        frameBerisi = 0;
    }

    synchronized int frame() { return frame; }
    synchronized int frameBerisi() { return frameBerisi; }
    synchronized boolean kosong() { return suara.isEmpty(); }

    /** Berapa frame yang membaca nilai ini. */
    synchronized int suaraUntuk(String nilai) {
        Integer n = suara.get(nilai);
        return n == null ? 0 : n;
    }

    /**
     * Nilai-nilai yang layak ditawarkan, terkuat dulu. Paling banyak tiga.
     *
     * Tiga tombol untuk disentuh mengalahkan satu kotak ketik: yang benar
     * hampir selalu ada di antaranya, dan menyentuh tidak bisa salah ketik.
     */
    synchronized List<OrderId.Bacaan> pilihan() {
        List<OrderId.Bacaan> out = kumpulkan();
        return out.size() > 3 ? out.subList(0, 3) : out;
    }

    /** Bacaan terkuat dari seluruh frame, atau null. */
    synchronized OrderId.Bacaan hasil() {
        List<OrderId.Bacaan> out = kumpulkan();
        return out.isEmpty() ? null : out.get(0);
    }

    // -----------------------------------------------------------------------

    private List<OrderId.Bacaan> kumpulkan() {
        List<OrderId.Bacaan> out = new ArrayList<>();
        List<String> sisa = new ArrayList<>(suara.keySet());
        // Yang paling banyak disuarakan menjadi inti gugusnya, supaya bacaan
        // sesekali tidak pernah menarik yang mayoritas ke arahnya.
        Collections.sort(sisa, (a, b) -> {
            int d = suaraUntuk(b) - suaraUntuk(a);
            return d != 0 ? d : Double.compare(terbaik.get(b).skor, terbaik.get(a).skor);
        });

        while (!sisa.isEmpty()) {
            String inti = sisa.remove(0);
            List<String> gugus = new ArrayList<>();
            gugus.add(inti);
            for (int i = sisa.size() - 1; i >= 0; i--) {
                if (serupa(inti, sisa.get(i))) gugus.add(sisa.remove(i));
            }
            OrderId.Bacaan b = putuskan(gugus);
            if (b != null) out.add(b);
        }

        Collections.sort(out, (a, b) -> Double.compare(b.skor, a.skor));
        return out;
    }

    /**
     * Sama panjang dan berbeda paling banyak seperempatnya.
     *
     * Panjang yang berbeda berarti ada huruf yang hilang atau bertambah, dan
     * suara per posisi tidak lagi membandingkan huruf yang sama -- yang
     * hasilnya bukan perbaikan melainkan campuran dua nomor.
     */
    private static boolean serupa(String a, String b) {
        if (a.length() != b.length()) return false;
        int beda = 0;
        for (int i = 0; i < a.length(); i++) if (a.charAt(i) != b.charAt(i)) beda++;
        return beda > 0 && beda * 4 <= a.length();
    }

    private OrderId.Bacaan putuskan(List<String> gugus) {
        String inti = gugus.get(0);
        int total = 0;
        boolean berjangkar = false;
        String barcode = null;
        for (String v : gugus) {
            total += suaraUntuk(v);
            if (terbaik.get(v).berjangkar) berjangkar = true;
            if (dariBarcode.contains(v)) barcode = v;
        }

        // Nilai dari barcode tidak ikut suara per huruf dan tidak terkena
        // batas "tanpa jangkar". Checksum-nya sudah lolos; merakitnya ulang
        // dari bacaan OCR di sekitarnya berarti membiarkan yang lebih lemah
        // mengoreksi yang lebih kuat.
        if (barcode != null) {
            OrderId.Bacaan d = OrderId.skorkan(barcode, berjangkar, false);
            if (d != null) {
                double sk = Math.min(1.0, d.skor + 0.35 + Math.min(0.10, 0.02 * (total - 1)));
                return new OrderId.Bacaan(barcode, sk, d.keluarga, berjangkar,
                        d.alasan + ", terbaca dari barcode");
            }
        }

        // Suara per posisi: setiap huruf diputuskan sendiri, ditimbang jumlah
        // frame yang membacanya. Inilah yang memulihkan satu huruf yang salah
        // di tengah nomor yang selebihnya benar.
        StringBuilder rakit = new StringBuilder(inti.length());
        for (int i = 0; i < inti.length(); i++) {
            Map<Character, Integer> hitung = new HashMap<>();
            for (String v : gugus) {
                char c = v.charAt(i);
                Integer n = hitung.get(c);
                hitung.put(c, (n == null ? 0 : n) + suaraUntuk(v));
            }
            char menang = inti.charAt(i);
            int tertinggi = -1;
            for (Map.Entry<Character, Integer> e : hitung.entrySet()) {
                if (e.getValue() > tertinggi) { tertinggi = e.getValue(); menang = e.getKey(); }
            }
            rakit.append(menang);
        }
        String nilai = rakit.toString();

        OrderId.Bacaan dasar = OrderId.skorkan(nilai, berjangkar, false);
        if (dasar == null) {
            // Rakitannya keluar dari bentuk yang dikenal -- berarti gugusnya
            // memang bukan satu benda. Kembali ke nilai yang paling didukung.
            dasar = terbaik.get(inti);
            if (dasar == null) return null;
            nilai = dasar.nilai;
        }

        // Kesepakatan antar-frame menguatkan, tapi tidak pernah mempromosikan
        // tebakan tanpa jangkar menjadi otomatis. Lihat catatan di kepala kelas.
        double bonus = Math.min(0.18, 0.045 * (total - 1));
        double skor = dasar.skor + bonus;
        if (!berjangkar && dasar.skor < 0.80) skor = Math.min(skor, 0.79);
        skor = Math.min(1, skor);

        String alasan = dasar.alasan + ", disepakati " + total + " frame";
        return new OrderId.Bacaan(nilai, skor, dasar.keluarga, berjangkar, alasan);
    }
}
