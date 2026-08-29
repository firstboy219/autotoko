package id.autotoko.scanner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * Dua pesan WhatsApp pencairan, disusun persis seperti di web.
 *
 * Ditaruh di kelas sendiri tanpa apa pun dari Android supaya isinya bisa diuji
 * unit. Yang dikirim ke orang lain lewat WhatsApp tidak bisa ditarik kembali,
 * jadi aturan "nominal seller tidak boleh ikut ke sub-seller" harus dijaga oleh
 * tes, bukan oleh kehati-hatian saat membaca kode.
 *
 * Sengaja menyalin susunannya dari web, bukan memanggil endpoint baru: pesannya
 * dibangun dari data batch yang memang sudah diambil layar ini, dan menambah
 * endpoint hanya akan membuat dua sumber kebenaran untuk teks yang sama.
 */
public final class PayoutShare {

    private PayoutShare() {}

    private static final String[] BULAN = {
        "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
        "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
    };

    /* ------------------------------------------------------------ pembantu */

    /**
     * String yang benar-benar berisi, atau null.
     *
     * optString() milik Android mengembalikan "null" (empat huruf) untuk field
     * yang nilainya null di JSON, sedangkan implementasi org.json biasa
     * mengembalikan penggantinya. Beda itu tidak kelihatan sampai ada tautan
     * bukti bertuliskan "null" terkirim ke sub-seller.
     */
    static String str(JSONObject o, String k) {
        if (o == null || !o.has(k) || o.isNull(k)) return null;
        String v = o.optString(k, "");
        if (v.isEmpty() || "null".equals(v)) return null;
        return v;
    }

    static double num(JSONObject o, String k) {
        if (o == null || !o.has(k) || o.isNull(k)) return 0;
        return o.optDouble(k, 0);
    }

    static String rp(double v) {
        return "Rp " + String.format(new Locale("id", "ID"), "%,.0f", v);
    }

    /** Tautan relatif dari server dijadikan tautan yang bisa dibuka siapa pun. */
    static String absolut(String url, String baseUrl) {
        if (url == null) return null;
        if (url.regionMatches(true, 0, "http", 0, 4)) return url;
        String b = baseUrl == null ? "" : baseUrl;
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        return b + url;
    }

    /**
     * "16 Agu 2026".
     *
     * Dua bentuk masuk ke sini: tanggal polos ("2026-08-16", tanpa zona waktu)
     * dan cap waktu penuh (punya zona). Membaca tanggal polos sebagai waktu
     * lokal menggesernya mundur sehari untuk siapa pun di timur UTC, jadi
     * masing-masing dibaca di zona tempat ia ditulis -- sama seperti di web.
     */
    static String tglPanjang(String iso) {
        if (iso == null || iso.length() < 10) return "-";
        boolean polos = iso.length() <= 10;
        try {
            if (polos) {
                int th = Integer.parseInt(iso.substring(0, 4));
                int bl = Integer.parseInt(iso.substring(5, 7));
                int hr = Integer.parseInt(iso.substring(8, 10));
                if (bl < 1 || bl > 12) return "-";
                return hr + " " + BULAN[bl - 1] + " " + th;
            }
            // Diurai sendiri, bukan lewat Format: kelas ini sengaja tidak
            // menyentuh apa pun dari Android supaya tetap bisa diuji unit.
            Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
            c.clear();
            c.set(Integer.parseInt(iso.substring(0, 4)),
                    Integer.parseInt(iso.substring(5, 7)) - 1,
                    Integer.parseInt(iso.substring(8, 10)),
                    Integer.parseInt(iso.substring(11, 13)),
                    Integer.parseInt(iso.substring(14, 16)),
                    iso.length() >= 19 ? Integer.parseInt(iso.substring(17, 19)) : 0);
            c.add(Calendar.MINUTE, -offsetMenit(iso));
            Calendar j = Calendar.getInstance(TimeZone.getTimeZone("Asia/Jakarta"));
            j.setTimeInMillis(c.getTimeInMillis());
            return j.get(Calendar.DAY_OF_MONTH) + " " + BULAN[j.get(Calendar.MONTH)]
                    + " " + j.get(Calendar.YEAR);
        } catch (Exception e) {
            return "-";
        }
    }

    /** Menit di timur UTC yang tertulis di ekor cap waktu; 0 untuk "Z". */
    static int offsetMenit(String iso) {
        int i = Math.max(iso.lastIndexOf('+'), iso.lastIndexOf('-'));
        // Tanda hubung di bagian tanggal jangan ikut terbaca sebagai offset.
        if (i > 10 && i + 3 <= iso.length()) {
            try {
                int jam = Integer.parseInt(iso.substring(i + 1, i + 3));
                int menit = 0;
                String sisa = iso.substring(i + 3);
                if (sisa.startsWith(":") && sisa.length() >= 3) {
                    menit = Integer.parseInt(sisa.substring(1, 3));
                } else if (sisa.length() >= 2) {
                    menit = Integer.parseInt(sisa.substring(0, 2));
                }
                int total = jam * 60 + menit;
                return iso.charAt(i) == '-' ? -total : total;
            } catch (Exception ignored) {}
        }
        return 0;
    }

    private static String kodeBatch(JSONObject batch) {
        String code = str(batch, "code");
        if (code != null) return "#" + code;
        String id = str(batch, "id");
        return id == null ? "-" : id.substring(0, Math.min(8, id.length()));
    }

    private static String namaToko(JSONArray shops, String shopId) {
        for (int i = 0; shops != null && i < shops.length(); i++) {
            JSONObject s = shops.optJSONObject(i);
            if (s == null) continue;
            if (shopId != null && shopId.equals(str(s, "id"))) {
                String n = str(s, "displayName");
                if (n == null) n = str(s, "shopName");
                if (n != null) return n;
            }
        }
        return shopId == null ? "(tanpa nama)" : shopId.substring(0, Math.min(8, shopId.length()));
    }

    /* -------------------------------------------------------- pesan seller */

    /**
     * Ringkasan untuk pemiliknya sendiri.
     *
     * Tanpa pecahan per toko: yang ingin dibaca di sini adalah "toko mana
     * mencairkan berapa, mana buktinya". Bagian seller ikut, karena memang
     * untuk seller.
     */
    public static String pesanSeller(JSONObject batch, JSONArray shops, String baseUrl) {
        JSONArray mutations = batch.optJSONArray("mutations");
        int n = mutations == null ? 0 : mutations.length();

        double credit = 0, sedekah = 0, seller = 0, material = 0, sub = 0, subSub = 0;
        List<String> hari = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            JSONObject m = mutations.optJSONObject(i);
            if (m == null) continue;
            credit += num(m, "creditAmount");
            sedekah += num(m, "sedekahAmount");
            seller += num(m, "sellerAmount");
            material += num(m, "sellerMaterialAmount");
            sub += num(m, "subSellerAmount");
            subSub += num(m, "subSubSellerAmount");
            String t = str(m, "payoutDate");
            if (t != null) hari.add(t);
        }
        java.util.Collections.sort(hari);

        StringBuilder b = new StringBuilder();
        b.append("*Rekap Pencairan* (").append(n).append(" toko)\n");
        b.append("Batch: ").append(kodeBatch(batch)).append("\n");
        // Tanggal uangnya, bukan tanggal batch dibuka: batch yang dimulai Senin
        // bisa memuat transfer hari Jumat.
        if (!hari.isEmpty()) {
            String awal = hari.get(0), akhir = hari.get(hari.size() - 1);
            b.append("Tanggal pencairan: ").append(tglPanjang(awal));
            if (!awal.equals(akhir)) b.append(" – ").append(tglPanjang(akhir));
            b.append("\n");
        }
        b.append("Dibuat: ").append(tglPanjang(str(batch, "createdAt"))).append("\n");
        b.append("Total Kredit: ").append(rp(credit)).append("\n");
        b.append("\n*Hasil Kalkulasi*\n");
        b.append("Sedekah: ").append(rp(sedekah)).append("\n");
        if (sub > 0) b.append("Sub-seller: ").append(rp(sub)).append("\n");
        if (subSub > 0) b.append("Sub-sub-seller: ").append(rp(subSub)).append("\n");
        b.append("Seller: ").append(rp(seller)).append("\n");
        if (material > 0) {
            b.append("  - Bahan baku: ").append(rp(material)).append("\n");
            b.append("  - Sisa seller: ").append(rp(seller - material)).append("\n");
        }

        if (n > 0) {
            b.append("\n*Detail Toko*\n");
            for (int i = 0; i < n; i++) {
                JSONObject m = mutations.optJSONObject(i);
                if (m == null) continue;
                b.append(i + 1).append(". ").append(namaToko(shops, str(m, "shopId")))
                 .append(" - ").append(rp(num(m, "creditAmount"))).append("\n");
                // Buktinya disebut ada-tidaknya, bukan dilewati diam-diam:
                // baris tanpa tautan yang tidak diterangkan terbaca seperti
                // bukti yang hilang.
                String bukti = absolut(str(m, "marketplaceProofUrl"), baseUrl);
                b.append(bukti != null ? "   " + bukti : "   (bukti pencairan belum diunggah)")
                 .append("\n");
            }
        }
        return b.toString().trim();
    }

    /* ---------------------------------------------------- pesan sub-seller */

    private static final class Grup {
        String nama, jenis;
        double total, bawaan, cair;
        final List<String> bukti = new ArrayList<>();
        int tanpaBukti;
    }

    /**
     * Bukti transfer untuk yang menerimanya.
     *
     * Kebalikan dari pesan seller: di sini yang dikirim justru rinciannya.
     * Jatah bahan baku TIDAK ikut -- uang itu dipotong dari bagian seller dan
     * masuk ke rekening pemilik sendiri, jadi menampilkannya berarti
     * memperlihatkan nominal seller lewat pintu lain.
     *
     * Transfer yang belum ada buktinya tetap didaftar dan disebut belum ada:
     * menghilangkannya membuat pesan terlihat lengkap sementara ada yang masih
     * menunggu uangnya.
     */
    public static String pesanSubSeller(JSONObject batch, String baseUrl) {
        Map<String, String> JENIS = new LinkedHashMap<>();
        JENIS.put("sub_seller", "Sub-seller");
        JENIS.put("sub_sub_seller", "Sub-sub-seller");
        JENIS.put("sedekah", "Sedekah");

        /*
         * Berapa yang cair di toko yang menghasilkan bagian tiap orang.
         *
         * Dicocokkan lewat id sub-seller, BUKAN lewat mutasi: baris transfer
         * sub-seller digabung per penerima, jadi payoutMutationId-nya null dan
         * menghitung lewat mutasi menghasilkan nol untuk semua orang.
         */
        Map<String, Double> cairPerSub = new LinkedHashMap<>();
        JSONArray mutations = batch.optJSONArray("mutations");
        for (int i = 0; mutations != null && i < mutations.length(); i++) {
            JSONObject m = mutations.optJSONObject(i);
            if (m == null) continue;
            double kredit = num(m, "creditAmount");
            String a = str(m, "subSellerId");
            String c = str(m, "subSubSellerId");
            if (a != null) cairPerSub.put(a, (cairPerSub.containsKey(a) ? cairPerSub.get(a) : 0) + kredit);
            if (c != null) cairPerSub.put(c, (cairPerSub.containsKey(c) ? cairPerSub.get(c) : 0) + kredit);
        }

        Map<String, Grup> per = new LinkedHashMap<>();
        JSONArray disb = batch.optJSONArray("disbursements");
        for (int i = 0; disb != null && i < disb.length(); i++) {
            JSONObject d = disb.optJSONObject(i);
            if (d == null) continue;
            String jenis = str(d, "recipientType");
            if ("bahan_baku".equals(jenis)) continue;
            String nama = str(d, "recipientName");
            String kunci = jenis + "|" + nama;
            Grup g = per.get(kunci);
            if (g == null) {
                g = new Grup();
                g.nama = nama == null ? "(tanpa nama)" : nama;
                g.jenis = jenis == null ? "" : jenis;
                per.put(kunci, g);
            }
            g.total += num(d, "expectedAmount");
            g.bawaan += num(d, "carryoverAmount");
            String idPenerima = str(d, "recipientSubSellerId");
            if (idPenerima == null) idPenerima = str(d, "recipientSubSubSellerId");
            if (idPenerima != null && cairPerSub.containsKey(idPenerima)) {
                g.cair += cairPerSub.get(idPenerima);
            }
            String bukti = absolut(str(d, "proofUrl"), baseUrl);
            if (bukti != null) g.bukti.add(bukti);
            else g.tanpaBukti += 1;
        }

        String tgl = str(batch, "completedAt");
        if (tgl == null) tgl = str(batch, "closedAt");
        if (tgl == null) tgl = str(batch, "createdAt");

        StringBuilder b = new StringBuilder();
        b.append("*Bukti Transfer Pencairan*\n");
        b.append("Batch: ").append(kodeBatch(batch)).append("\n");
        b.append("Tanggal: ").append(tglPanjang(tgl)).append("\n\n");

        List<Grup> urut = new ArrayList<>(per.values());
        java.util.Collections.sort(urut, (x, y) -> Double.compare(y.total, x.total));
        int n = 0;
        for (Grup g : urut) {
            n += 1;
            String label = JENIS.containsKey(g.jenis) ? JENIS.get(g.jenis) : g.jenis;
            b.append(n).append(". ").append(g.nama).append(" (").append(label)
             .append(") — ").append(rp(g.total)).append("\n");
            // Hanya untuk penerima yang bagiannya berasal dari toko tertentu.
            // Baris sedekah digabung untuk seluruh batch, jadi "total
            // pencairan"-nya sama dengan total seluruh batch -- ringkasan yang
            // justru tidak diinginkan di pesan ini.
            if (g.cair > 0) {
                b.append("   Total pencairan toko: ").append(rp(g.cair)).append("\n");
            }
            // Disebut kalau ada, karena tanpa ini penerimanya akan menghitung
            // persentasenya sendiri dan menyimpulkan angkanya salah.
            if (g.bawaan > 0) {
                b.append("   (termasuk ").append(rp(g.bawaan))
                 .append(" bawaan batch sebelumnya)\n");
            }
            for (String u : g.bukti) b.append("   ").append(u).append("\n");
            if (g.tanpaBukti > 0) {
                b.append("   (").append(g.tanpaBukti).append(" transfer belum ada buktinya)\n");
            }
        }
        return b.toString().trim();
    }

    /* ------------------------------------------------------------- syarat */

    /** Pesan seller ada isinya begitu ada pencairan yang direkam. */
    public static boolean bisaBagikanSeller(JSONObject batch) {
        JSONArray m = batch == null ? null : batch.optJSONArray("mutations");
        return m != null && m.length() > 0;
    }

    /**
     * Pesan sub-seller baru ada artinya setelah input ditutup DAN ada penerima
     * selain jatah bahan baku -- batch yang seluruhnya milik pemiliknya sendiri
     * tidak punya siapa pun untuk dikirimi.
     */
    public static boolean bisaBagikanSubSeller(JSONObject batch) {
        if (batch == null) return false;
        if ("berjalan".equals(str(batch, "status"))) return false;
        JSONArray d = batch.optJSONArray("disbursements");
        for (int i = 0; d != null && i < d.length(); i++) {
            JSONObject x = d.optJSONObject(i);
            if (x != null && !"bahan_baku".equals(str(x, "recipientType"))) return true;
        }
        return false;
    }
}
