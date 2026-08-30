package id.autotoko.scanner;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Order id dari label: mengesahkan, memperbaiki, dan menolak.
 *
 * Cerminan aturan yang sama di server (order-id.ts), ditaruh di sini karena
 * sejak order id diwajibkan, ponsel harus bisa mengatakan "belum" SEBELUM
 * paketnya dilepas -- menunggu server menolaknya berarti menahan orang yang
 * sudah menaruh paket di tumpukan berikutnya.
 *
 * Aturannya diturunkan dari laporan penyelesaian sungguhan: dari 66 baris
 * berjenis "Pesanan", SELURUHNYA angka murni 18 digit. Yang 19 digit bukan
 * pesanan -- ia referensi pencairan di muka dan penyesuaian komisi.
 *
 * Dua jalur, dan pemisahannya disengaja:
 *
 *   dariOcr()     -- 18 digit murni, titik. Melonggarkan di sini persis yang
 *                    dulu menyimpan kode sortir kurir dan nomor pengiriman
 *                    Shopee ke kolom order id; 79% isinya jadi mustahil.
 *   dariKetikan() -- boleh juga bentuk Shopee. Mengetik adalah tindakan sadar
 *                    dengan label di tangan, bukan tebakan mesin. Tanpa jalur
 *                    ini, mewajibkan order id akan membuat paket Shopee
 *                    mustahil disimpan sama sekali.
 */
final class OrderId {

    private OrderId() {}

    static final int DIGIT = 18;

    /** Hanya kekeliruan OCR yang benar-benar sering terjadi pada label termal. */
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

    private static String bersihkan(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[\\s\\-/.]", "");
    }

    /** Order id hasil pembacaan mesin, atau null. */
    static String dariOcr(String raw) {
        String bersih = bersihkan(raw);
        if (bersih.isEmpty()) return null;
        if (bersih.matches("\\d{" + DIGIT + "}")) return bersih;
        // Perbaikan huruf hanya diterima kalau HASILNYA jadi 18 digit penuh;
        // kalau masih tersisa huruf, kandidatnya memang bukan order id.
        String perbaikan = rapikan(bersih);
        if (perbaikan.matches("\\d{" + DIGIT + "}")) return perbaikan;
        return null;
    }

    /** Bentuk nomor pesanan Shopee: enam angka tanggal lalu huruf/angka. */
    private static final Pattern SHOPEE = Pattern.compile("^[0-9]{6}[A-Z0-9]{6,10}$");

    /** Order id yang diketik orang, atau null. */
    static String dariKetikan(String raw) {
        String ketat = dariOcr(raw);
        if (ketat != null) return ketat;
        String bersih = bersihkan(raw).toUpperCase(java.util.Locale.US);
        return SHOPEE.matcher(bersih).matches() ? bersih : null;
    }

    private static final Pattern JANGKAR = Pattern.compile(
            "(?:order\\s*id|no\\.?\\s*pesanan|nomor\\s*pesanan|no\\.?\\s*order|invoice)"
                    + "\\s*[:#]?\\s*([0-9OoSsIilBZzGD|]{16,20})",
            Pattern.CASE_INSENSITIVE);

    /**
     * Cari order id di dalam teks label.
     *
     * Berjangkar dulu, baru angka telanjang. Yang telanjang WAJIB berbatas
     * non-digit: tanpa itu, awalan sebuah angka 19 digit ikut tercocok sebagai
     * "18 digit" dan menghasilkan order id yang terpotong satu angka -- salah
     * yang paling sulit terlihat, karena bentuknya sempurna.
     */
    static String cari(String teks) {
        if (teks == null || teks.isEmpty()) return null;

        Matcher j = JANGKAR.matcher(teks);
        if (j.find()) {
            String v = dariOcr(j.group(1));
            if (v != null) return v;
        }

        Matcher t = Pattern.compile("(?<!\\d)\\d{" + DIGIT + "}(?!\\d)").matcher(teks);
        String satu = null;
        while (t.find()) {
            String v = t.group();
            if (satu == null) satu = v;
            // Beberapa angka 18 digit yang BERBEDA: tidak ada dasar memilih
            // salah satunya, jadi tidak ada yang dipilih.
            else if (!satu.equals(v)) return null;
        }
        return satu;
    }
}
