package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Isi kedua pesan WhatsApp pencairan.
 *
 * Yang dijaga di sini bukan "fungsinya jalan", melainkan janji yang tidak bisa
 * ditarik kembali setelah pesannya terkirim: pesan sub-seller tidak boleh
 * memuat nominal seller, dan transfer yang belum ada buktinya harus tetap
 * disebut. Keduanya permintaan eksplisit pemiliknya.
 */
public class PayoutShareTest {

    private static final String BASE = "https://viewtoko.cosger.online";

    /** Angka yang khas supaya bisa dicari apa adanya di dalam teks. */
    private static final double SELLER = 1234567;
    private static final double BAHAN = 222333;

    private JSONObject batch() throws Exception {
        JSONObject b = new JSONObject();
        b.put("id", "0f3a91cc-1111-2222-3333-444455556666");
        b.put("code", "A1B");
        b.put("status", "selesai");
        b.put("createdAt", "2026-08-10T02:00:00.000000+00:00");
        b.put("completedAt", "2026-08-16T09:30:00.000000+00:00");

        JSONArray m = new JSONArray();
        JSONObject m1 = new JSONObject();
        m1.put("shopId", "shop-a");
        m1.put("payoutDate", "2026-08-12");
        m1.put("creditAmount", 2000000);
        m1.put("sedekahAmount", 50000);
        m1.put("sellerAmount", SELLER);
        m1.put("sellerMaterialAmount", BAHAN);
        m1.put("subSellerAmount", 300000);
        m1.put("subSubSellerAmount", 0);
        m1.put("subSellerId", "sub-1");
        m1.put("marketplaceProofUrl", "/uploads/bukti-a.png");
        m.put(m1);

        JSONObject m2 = new JSONObject();
        m2.put("shopId", "shop-b");
        m2.put("payoutDate", "2026-08-14");
        m2.put("creditAmount", 500000);
        m2.put("sedekahAmount", 12500);
        m2.put("sellerAmount", 400000);
        m2.put("sellerMaterialAmount", 0);
        m2.put("subSellerAmount", 87500);
        m2.put("subSubSellerAmount", 0);
        m2.put("subSellerId", "sub-1");
        m2.put("marketplaceProofUrl", JSONObject.NULL);
        m.put(m2);
        b.put("mutations", m);

        JSONArray d = new JSONArray();
        JSONObject d1 = new JSONObject();
        d1.put("recipientType", "sub_seller");
        d1.put("recipientName", "Fiki");
        d1.put("recipientSubSellerId", "sub-1");
        d1.put("expectedAmount", 387500);
        d1.put("carryoverAmount", 8230);
        d1.put("proofUrl", "/uploads/tf-fiki.png");
        d.put(d1);

        JSONObject d2 = new JSONObject();
        d2.put("recipientType", "sedekah");
        d2.put("recipientName", "Rekening Sedekah");
        d2.put("expectedAmount", 62500);
        d2.put("proofUrl", JSONObject.NULL);
        d.put(d2);

        // Jatah bahan baku: harus hilang sama sekali dari pesan sub-seller.
        JSONObject d3 = new JSONObject();
        d3.put("recipientType", "bahan_baku");
        d3.put("recipientName", "Rekening Bahan Baku");
        d3.put("expectedAmount", BAHAN);
        d3.put("proofUrl", "/uploads/tf-bahan.png");
        d.put(d3);
        b.put("disbursements", d);
        return b;
    }

    private JSONArray shops() throws Exception {
        JSONArray s = new JSONArray();
        JSONObject a = new JSONObject();
        a.put("id", "shop-a");
        a.put("displayName", "Whiteline Shopee");
        s.put(a);
        JSONObject b = new JSONObject();
        b.put("id", "shop-b");
        b.put("displayName", "Bulanjacom Tokopedia");
        s.put(b);
        return s;
    }

    /* ------------------------------------------------------------- seller */

    @Test
    public void pesan_seller_memuat_kepala_dan_detail_toko() throws Exception {
        String t = PayoutShare.pesanSeller(batch(), shops(), BASE);

        assertTrue(t.startsWith("*Rekap Pencairan* (2 toko)"));
        assertTrue(t.contains("Batch: #A1B"));
        assertTrue(t.contains("Total Kredit: Rp 2.500.000"));
        // Rentang tanggal diambil dari tanggal uangnya, bukan tanggal batch.
        assertTrue(t.contains("Tanggal pencairan: 12 Agu 2026 – 14 Agu 2026"));
        assertTrue(t.contains("Dibuat: 10 Agu 2026"));

        assertTrue(t.contains("*Hasil Kalkulasi*"));
        assertTrue(t.contains("Sedekah: Rp 62.500"));
        assertTrue(t.contains("Sub-seller: Rp 387.500"));
        assertTrue(t.contains("Seller: Rp 1.634.567"));
        assertTrue(t.contains("- Bahan baku: Rp 222.333"));
        assertTrue(t.contains("- Sisa seller: Rp 1.412.234"));

        assertTrue(t.contains("*Detail Toko*"));
        assertTrue(t.contains("1. Whiteline Shopee - Rp 2.000.000"));
        assertTrue(t.contains("2. Bulanjacom Tokopedia - Rp 500.000"));
    }

    @Test
    public void tautan_bukti_dijadikan_alamat_penuh_dan_yang_kosong_diterangkan()
            throws Exception {
        String t = PayoutShare.pesanSeller(batch(), shops(), BASE);
        assertTrue(t.contains(BASE + "/uploads/bukti-a.png"));
        // Yang null tidak boleh jadi tautan bertuliskan "null".
        assertFalse(t.contains("null"));
        assertTrue(t.contains("(bukti pencairan belum diunggah)"));
    }

    @Test
    public void sub_sub_seller_hanya_muncul_kalau_ada() throws Exception {
        assertFalse(PayoutShare.pesanSeller(batch(), shops(), BASE).contains("Sub-sub-seller:"));
    }

    /* --------------------------------------------------------- sub-seller */

    @Test
    public void pesan_sub_seller_tidak_memuat_nominal_seller_sama_sekali()
            throws Exception {
        String t = PayoutShare.pesanSubSeller(batch(), BASE);
        // Inti permintaannya. Tiga bentuk angka seller yang mungkin bocor:
        // bagian seller, jatah bahan baku, dan sisa bersihnya.
        assertFalse(t.contains("1.234.567"));
        assertFalse(t.contains("222.333"));
        assertFalse(t.contains("1.412.234"));
        assertFalse(t.contains("Seller:"));
        assertFalse(t.contains("Rekening Bahan Baku"));
        assertFalse(t.contains("Bahan baku"));
    }

    @Test
    public void pesan_sub_seller_merinci_tiap_penerima() throws Exception {
        String t = PayoutShare.pesanSubSeller(batch(), BASE);
        assertTrue(t.startsWith("*Bukti Transfer Pencairan*"));
        assertTrue(t.contains("Batch: #A1B"));
        assertTrue(t.contains("Tanggal: 16 Agu 2026"));

        // Terurut dari nominal terbesar: Fiki 387.500 sebelum sedekah 62.500.
        assertTrue(t.indexOf("1. Fiki (Sub-seller) — Rp 387.500")
                < t.indexOf("2. Rekening Sedekah (Sedekah) — Rp 62.500"));

        // Total pencairan toko dihitung lewat id sub-seller, bukan lewat
        // mutasi: 2.000.000 + 500.000 dari dua toko yang sama-sama miliknya.
        assertTrue(t.contains("Total pencairan toko: Rp 2.500.000"));
        assertTrue(t.contains("(termasuk Rp 8.230 bawaan batch sebelumnya)"));
        assertTrue(t.contains(BASE + "/uploads/tf-fiki.png"));
        assertTrue(t.contains("(1 transfer belum ada buktinya)"));
    }

    @Test
    public void sedekah_tidak_diberi_total_pencairan_toko() throws Exception {
        String t = PayoutShare.pesanSubSeller(batch(), BASE);
        // Baris sedekah digabung seluruh batch, jadi "total pencairan"-nya akan
        // sama dengan total batch -- ringkasan yang justru tidak diinginkan.
        int sedekah = t.indexOf("2. Rekening Sedekah");
        assertEquals(-1, t.indexOf("Total pencairan toko", sedekah));
    }

    /* -------------------------------------------------------------- syarat */

    @Test
    public void syarat_munculnya_tiap_tombol() throws Exception {
        JSONObject b = batch();
        assertTrue(PayoutShare.bisaBagikanSeller(b));
        assertTrue(PayoutShare.bisaBagikanSubSeller(b));

        // Masih langkah 1: belum ada yang ditransfer, jadi belum ada yang
        // bisa dikirimi bukti.
        b.put("status", "berjalan");
        assertFalse(PayoutShare.bisaBagikanSubSeller(b));
        assertTrue(PayoutShare.bisaBagikanSeller(b));

        // Batch tanpa pencairan sama sekali.
        JSONObject kosong = new JSONObject();
        kosong.put("mutations", new JSONArray());
        assertFalse(PayoutShare.bisaBagikanSeller(kosong));
        assertFalse(PayoutShare.bisaBagikanSubSeller(kosong));

        // Hanya jatah bahan baku: tidak ada penerima luar.
        JSONObject sendiri = new JSONObject();
        sendiri.put("status", "selesai");
        JSONArray d = new JSONArray();
        JSONObject x = new JSONObject();
        x.put("recipientType", "bahan_baku");
        x.put("recipientName", "Rekening Bahan Baku");
        d.put(x);
        sendiri.put("disbursements", d);
        assertFalse(PayoutShare.bisaBagikanSubSeller(sendiri));
    }

    /* ------------------------------------------------------------ tanggal */

    @Test
    public void tanggal_polos_tidak_bergeser_sehari() {
        // Bug yang nyata kalau tanggal polos dibaca sebagai waktu lokal:
        // "2026-08-16" akan terbaca 15 Agustus bagi siapa pun di timur UTC.
        assertEquals("16 Agu 2026", PayoutShare.tglPanjang("2026-08-16"));
        assertEquals("1 Jan 2027", PayoutShare.tglPanjang("2027-01-01"));
    }

    @Test
    public void cap_waktu_dibaca_di_waktu_jakarta() {
        // 16 Agustus 19:00 UTC sudah tanggal 17 di Jakarta (+7).
        assertEquals("17 Agu 2026", PayoutShare.tglPanjang("2026-08-16T19:00:00.000000+00:00"));
        assertEquals("16 Agu 2026", PayoutShare.tglPanjang("2026-08-16T09:30:00.000000+00:00"));
        assertEquals("17 Agu 2026", PayoutShare.tglPanjang("2026-08-16T19:00:00Z"));
    }

    @Test
    public void offset_selain_utc_ikut_diperhitungkan() {
        assertEquals(0, PayoutShare.offsetMenit("2026-08-16T19:00:00Z"));
        assertEquals(420, PayoutShare.offsetMenit("2026-08-16T19:00:00+07:00"));
        assertEquals(-300, PayoutShare.offsetMenit("2026-08-16T19:00:00-05:00"));
        // Waktu yang sudah ditulis dalam WIB tidak boleh digeser lagi.
        assertEquals("16 Agu 2026", PayoutShare.tglPanjang("2026-08-16T23:00:00+07:00"));
    }
}
