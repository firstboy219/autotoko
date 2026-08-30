package id.autotoko.scanner;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Suara antar-frame untuk bahan baku di nota, dan keputusan kapan berhenti.
 *
 * Cerminan peran SuaraOrderId di scan resi packing: satu frame adalah tebakan,
 * beberapa frame yang sepakat adalah bukti. Dipisah dari layarnya supaya bisa
 * diuji tanpa Android -- keputusan "kapan panduan berhenti" adalah tempat yang
 * paling mudah keliru dan paling sulit terlihat kalau salah, karena gagalnya
 * berupa orang berdiri di depan kamera tanpa ujung.
 *
 * Yang dihitung di sini HANYA untuk memutuskan kapan berhenti. Bahan mana yang
 * diusulkan tetap diambil dari teks terkumpul seluruh frame, supaya nama yang
 * terbelah antar baris tetap utuh -- satu frame jarang memuat nama lengkapnya.
 */
final class SuaraBahan {

    /** Sebanyak ini frame harus sepakat sebelum sebuah bahan dianggap terbaca. */
    static final int SUARA_MIN = 3;

    /**
     * Panduan tidak berhenti sebelum selama ini, walau sudah ada yang dikenali.
     *
     * Berhenti pada bukti pertama berarti berhenti sebelum kamera sempat
     * melihat baris nota yang lain; sebuah nota rutin memuat lebih dari satu
     * bahan, dan yang kedua biasanya baru terbaca sedetik kemudian.
     */
    static final long MIN_MS = 2500;

    /**
     * Dan tidak pernah lebih lama dari ini, dikenali atau tidak.
     *
     * Tanpa batas atas, nota yang memang tidak memuat nama bahan -- terukur,
     * 17 dari 19 pengiriman yang ada -- akan menahan orang di depan kamera
     * tanpa ujung, dan itu lebih buruk daripada lembar yang dibuka kosong.
     */
    static final long MAKS_MS = 9000;

    private final Map<String, Integer> suara = new HashMap<>();
    private int frame;

    /** Satu frame teks yang sudah dicocokkan ke katalog. */
    void catat(List<ProductMatcher.Match> hasil) {
        frame++;
        if (hasil == null) return;
        for (ProductMatcher.Match m : hasil) {
            Integer n = suara.get(m.product.id);
            suara.put(m.product.id, n == null ? 1 : n + 1);
        }
    }

    /** Berapa bahan yang sudah disepakati cukup banyak frame. */
    int disepakati() {
        int n = 0;
        for (Integer v : suara.values()) if (v >= SUARA_MIN) n++;
        return n;
    }

    int suaraUntuk(String id) {
        Integer n = suara.get(id);
        return n == null ? 0 : n;
    }

    int frame() { return frame; }

    void kosongkan() {
        suara.clear();
        frame = 0;
    }

    /**
     * Panduan boleh berhenti?
     *
     * Dua jalan, dan keduanya perlu: sudah ada yang dikenali DAN sudah cukup
     * lama membaca, atau waktunya habis. Yang pertama tanpa yang kedua
     * berhenti terlalu dini; yang kedua tanpa yang pertama tidak pernah
     * berhenti.
     */
    static boolean selesai(int disepakati, long lewatMs) {
        return (disepakati > 0 && lewatMs >= MIN_MS) || lewatMs >= MAKS_MS;
    }
}
