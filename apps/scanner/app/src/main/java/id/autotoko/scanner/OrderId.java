package id.autotoko.scanner;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Membaca nomor pesanan dari label dengan MENIMBANG BUKTI. Cermin order-id.ts.
 *
 * Versi sebelumnya adalah daftar bentuk yang boleh: 18 angka murni, titik. Di
 * hasil tes, label Shopee bertuliskan harfiah "No.Pesanan: 260827EXWKKVDE"
 * terbaca sempurna -- panel bawah menampilkan nomornya -- lalu ditolak, dan
 * panel panduan berkata "Belum terbaca, 154 frame, kejelasan 99%". Karena
 * order id sudah diwajibkan, setiap paket Shopee berhenti di langkah pertama.
 *
 * Sekarang setiap kandidat diberi SKOR dari bukti yang ada di label itu
 * sendiri, dan hasilnya tiga tingkat, bukan dua: tinggi dipakai langsung,
 * sedang ditawarkan untuk dibenarkan sekali sentuh, rendah diabaikan.
 *
 * Tingkat sedang itu inti perubahannya. Kode sortir kurir bentuknya tidak bisa
 * dibedakan dari nomor pesanan Shopee -- dulu itu alasan menolak SEMUA bentuk
 * Shopee, yang berarti membuang yang benar bersama yang salah. Menawarkannya
 * menyerahkan keputusan kepada satu-satunya pihak yang bisa memutuskan: orang
 * yang sedang memegang labelnya.
 */
final class OrderId {

    private OrderId() {}

    static final int DIGIT = 18;

    /** Hasil pembacaan berikut alasannya. */
    static final class Bacaan {
        final String nilai;
        final double skor;
        /** "tinggi" | "sedang" */
        final String keyakinan;
        final String keluarga;
        final boolean berjangkar;
        final String alasan;

        Bacaan(String nilai, double skor, String keluarga, boolean berjangkar, String alasan) {
            this.nilai = nilai;
            this.skor = skor;
            this.keyakinan = skor >= 0.80 ? "tinggi" : "sedang";
            this.keluarga = keluarga;
            this.berjangkar = berjangkar;
            this.alasan = alasan;
        }

        Bacaan dengan(double skorBaru, String alasanBaru) {
            return new Bacaan(nilai, skorBaru, keluarga, berjangkar, alasanBaru);
        }

        boolean pasti() { return "tinggi".equals(keyakinan); }
    }

    // -----------------------------------------------------------------------

    private static String rapikan(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case 'S': case 's': b.append('5'); break;
                case 'O': case 'o': case 'D': b.append('0'); break;
                case 'I': case 'i': case 'l': case '|': b.append('1'); break;
                case 'B': b.append('8'); break;
                case 'Z': case 'z': b.append('2'); break;
                case 'G': b.append('6'); break;
                default: b.append(c);
            }
        }
        return b.toString();
    }

    /**
     * Batang barcode yang tersenggol bingkai OCR terbaca sebagai "|" di TEPI
     * untaian. Terukur di korpus: "260815D5EJ88X7|" berubah menjadi
     * "26081505EJ88X71" setelah "|" ditafsirkan sebagai angka, dan diterima
     * otomatis. Sisa garis di tepi adalah artefak, bukan angka.
     */
    private static String bersihkan(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("^[|:;,'\"`]+|[|:;,'\"`]+$", "")
                .replaceAll("[\\s\\-/.]", "").toUpperCase(Locale.US);
    }

    /**
     * Perbaikan huruf hanya masuk akal pada untaian yang memang angka. Tanpa
     * ini, "GrotbExpress" -- nama layanan kurir di label yang sama -- menjadi
     * "6R0T8EXPRE55" dan ditawarkan sebagai nomor pesanan.
     */
    private static boolean layakDiperbaiki(String v) {
        if (v == null || v.isEmpty()) return false;
        int angka = 0;
        for (int i = 0; i < v.length(); i++) {
            if (Character.isDigit(v.charAt(i))) angka++;
        }
        return (double) angka / v.length() >= 0.6;
    }

    /** Order id 18 digit yang sah, atau null. Ketat, dan sengaja dibiarkan ketat. */
    static String dariOcr(String raw) {
        String bersih = bersihkan(raw);
        if (bersih.isEmpty()) return null;
        if (bersih.matches("\\d{" + DIGIT + "}")) return bersih;
        String perbaikan = rapikan(bersih);
        if (perbaikan.matches("\\d{" + DIGIT + "}")) return perbaikan;
        return null;
    }

    private static final Pattern AWALAN_KURIR = Pattern.compile(
            "^(SPXID|SPX|JNE|JX|JP|JD|JT|JOB|CM|TKP|SICEPAT|SOCP|IDEXP|NCS|LEX|ANT|BLIB|GKX|GK|SAP|POS|TIKI)");

    /** Bentuk yang sudah pasti bukan nomor pesanan, sekuat apa pun jangkarnya. */
    private static boolean jelasBukan(String v) {
        if (AWALAN_KURIR.matcher(v).find()) return true;
        if (v.matches("0\\d{8,12}")) return true;   // telepon
        if (v.matches("62\\d{8,13}")) return true;  // telepon +62
        if (v.matches("\\d{5}")) return true;       // kode pos
        if (v.matches("\\d{1,4}")) return true;     // terlalu pendek
        if (v.startsWith("RP") || v.startsWith("IDR")) return true;
        if (v.matches("\\d{8}") && Integer.parseInt(v.substring(0, 2)) <= 31) return true; // tanggal
        return false;
    }

    /**
     * Enam angka pertama masuk akal sebagai tanggal YYMMDD.
     *
     * Inilah yang memisahkan nomor pesanan Shopee sungguhan dari untaian
     * huruf-angka mana pun yang kebetulan panjangnya mirip.
     */
    private static boolean tanggalMasukAkal(String v) {
        if (!v.matches("\\d{6}.*")) return false;
        int th = Integer.parseInt(v.substring(0, 2));
        int bl = Integer.parseInt(v.substring(2, 4));
        int hr = Integer.parseInt(v.substring(4, 6));
        return th >= 24 && th <= 35 && bl >= 1 && bl <= 12 && hr >= 1 && hr <= 31;
    }

    /**
     * Menilai satu nilai yang sudah bersih, atau null kalau bentuknya tak dikenal.
     *
     * Dipisah supaya penghitung suara antar-frame memakai timbangan yang sama
     * persis dengan pembacaan satu frame. Dua timbangan yang berbeda untuk
     * pertanyaan yang sama adalah cara membuat panel dan hasil akhir berbeda
     * pendapat -- persis kegagalan yang sedang diperbaiki di sini.
     */
    static Bacaan skorkan(String v, boolean berjangkar, boolean diperbaiki) {
        if (v == null || v.isEmpty() || jelasBukan(v)) return null;
        String[] kel = keluarga(v);
        if (kel == null) return null;

        double skor = Double.parseDouble(kel[1]);
        StringBuilder alasan = new StringBuilder("bentuk ").append(kel[0]);
        if (berjangkar) {
            // Bukti terkuat yang bisa ada di sehelai label: tulisan di
            // sebelahnya menyatakan bahwa nilai ini nomor pesanan.
            skor += 0.45;
            alasan.append(", tertulis di sebelah \"No. Pesanan\"");
        }
        if (diperbaiki) {
            // Batas keras, bukan potongan kecil. Diukur pada korpus 309 label:
            // perbaikan huruf menghasilkan nilai benar 5 kali dan nilai yang
            // bentuknya sempurna tapi SALAH 13 kali. Boleh ditawarkan, tidak
            // pernah dipakai sendiri.
            skor = Math.min(skor, 0.79);
            alasan.append(", ada huruf yang dibaca sebagai angka — perlu dibenarkan");
        }
        skor = Math.max(0, Math.min(1, skor));
        if (skor < 0.45) return null;
        return new Bacaan(v, skor, kel[0], berjangkar, alasan.toString());
    }

    /** Nama keluarga bentuk dan skornya TANPA jangkar, atau null kalau tak dikenal. */
    private static String[] keluarga(String v) {
        if (v.matches("\\d{18}")) return new String[]{"18 digit", "0.85"};
        if (v.matches("\\d{6}[A-Z0-9]{6,12}") && tanggalMasukAkal(v))
            return new String[]{"Shopee", "0.62"};
        if (v.matches("\\d{19}")) return new String[]{"19 digit", "0.34"};
        if (v.matches("INV\\d{8}MPL\\d{6,14}")) return new String[]{"Invoice Tokopedia", "0.60"};
        if (v.matches("\\d{12,16}")) return new String[]{"angka panjang", "0.30"};
        if (v.matches("[A-Z0-9]{10,24}") && v.matches(".*\\d.*") && v.matches(".*[A-Z].*"))
            return new String[]{"huruf-angka", "0.18"};
        return null;
    }

    private static final Pattern JANGKAR_ADALAH = Pattern.compile(
            "(?:order\\s*id|order\\s*no\\.?|no\\.?\\s*order|no\\.?\\s*pesanan|nomor\\s*pesanan"
                    + "|kode\\s*pesanan|id\\s*pesanan|invoice|no\\.?\\s*invoice)\\s*[:#]?\\s*$",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern JANGKAR_BUKAN = Pattern.compile(
            "(?:no\\.?\\s*resi|nomor\\s*resi|resi|awb|air\\s*way\\s*bill|tracking|no\\.?\\s*telp"
                    + "|telepon|hp|berat|weight|kode\\s*pos|batas\\s*kirim)\\s*[:#]?\\s*$",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern TOKEN =
            Pattern.compile("[A-Za-z0-9|][A-Za-z0-9|/\\-.]{4,30}");

    /** Semua kandidat di dalam teks, dari yang skornya tertinggi. */
    static List<Bacaan> semua(String teks) {
        List<Bacaan> out = new ArrayList<>();
        if (teks == null || teks.isEmpty()) return out;

        Map<String, Bacaan> unik = new LinkedHashMap<>();
        Matcher t = TOKEN.matcher(teks);
        while (t.find()) {
            String sebelum = teks.substring(Math.max(0, t.start() - 24), t.start());
            if (JANGKAR_BUKAN.matcher(sebelum).find()) continue;
            boolean berjangkar = JANGKAR_ADALAH.matcher(sebelum).find();

            String bersih = bersihkan(t.group());
            if (bersih.isEmpty()) continue;
            // Diperiksa SEBELUM perbaikan huruf, bukan sesudah. "SPXID0641..."
            // yang diperbaiki menjadi "5PX10064..." tidak lagi berawalan kode
            // kurir dan akan lolos -- padahal yang tercetak di kertas itu tetap
            // nomor pengiriman. Yang sudah jelas bukan, tetap bukan.
            if (jelasBukan(bersih)) continue;

            // Dua bacaan: apa adanya, lalu yang huruf-miripnya diperbaiki.
            // Yang apa adanya didahulukan -- perbaikan yang tidak mengubah
            // keluarga hanya menambah kemungkinan salah.
            String[] coba = (!layakDiperbaiki(bersih) || bersih.equals(rapikan(bersih)))
                    ? new String[]{bersih}
                    : new String[]{bersih, rapikan(bersih)};

            // Keduanya dinilai, yang tertinggi menang -- bukan berhenti di
            // yang pertama cocok. Yang apa adanya sering hanya menyentuh
            // keluarga terlemah sementara bentuk 18-angkanya tidak pernah
            // dilihat, sehingga yang ditawarkan ke orang untaian berhuruf di
            // depan alih-alih nomor yang bisa dikenali sekali lihat.
            Bacaan terbaik = null;
            for (int i = 0; i < coba.length; i++) {
                Bacaan b = skorkan(coba[i], berjangkar, i > 0);
                if (b == null) continue;
                if (terbaik == null || b.skor > terbaik.skor) terbaik = b;
            }
            if (terbaik != null) {
                Bacaan lama = unik.get(terbaik.nilai);
                if (lama == null || terbaik.skor > lama.skor) unik.put(terbaik.nilai, terbaik);
            }
        }

        out.addAll(unik.values());
        java.util.Collections.sort(out, (a, b) -> Double.compare(b.skor, a.skor));
        return out;
    }

    /**
     * Bacaan terbaik, atau null.
     *
     * Kalau dua kandidat sama kuat dan nilainya berbeda, tidak ada dasar
     * memilih salah satunya, jadi keduanya turun ke "sedang" -- biar orangnya
     * yang menunjuk. Diam-diam memilih yang pertama adalah cara menghasilkan
     * nomor yang bentuknya sempurna dan isinya salah.
     */
    static Bacaan baca(String teks) {
        List<Bacaan> s = semua(teks);
        if (s.isEmpty()) return null;
        Bacaan atas = s.get(0);
        if (s.size() > 1 && s.get(1).skor == atas.skor) {
            return atas.dengan(Math.min(atas.skor, 0.70), atas.alasan + ", ada kandidat lain yang sama kuat");
        }
        return atas;
    }

    /** Order id yang boleh dipakai TANPA dibenarkan orang. Hanya keyakinan tinggi. */
    static String cari(String teks) {
        Bacaan b = baca(teks);
        return b != null && b.pasti() ? b.nilai : null;
    }

    /** True kalau bacaan terbaiknya tercetak tepat di sebelah label nomor pesanan. */
    static boolean berjangkar(String teks) {
        Bacaan b = baca(teks);
        return b != null && b.berjangkar;
    }

    /**
     * Order id yang DIKETIK atau DIBENARKAN orang.
     *
     * Jauh lebih longgar, dan itu disengaja: orang yang mengetiknya sedang
     * memegang labelnya. Yang ditolak hanyalah yang jelas-jelas bukan nomor
     * pesanan -- nomor pengiriman kurir, telepon, nominal.
     */
    static String dariKetikan(String raw) {
        String bersih = bersihkan(raw);
        if (bersih.isEmpty()) return null;
        if (bersih.matches("\\d{" + DIGIT + "}")) return bersih;
        if (jelasBukan(bersih)) return null;
        if (bersih.length() < 8 || bersih.length() > 26) return null;
        return bersih.matches("[A-Z0-9]+") ? bersih : null;
    }
}
