package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Dashboard, disusun ulang untuk layar ponsel.
 *
 * Datanya sama persis dengan web -- satu panggilan ke endpoint yang sama --
 * tapi urutannya bukan tiruan tata letak lebar. Yang naik ke atas adalah yang
 * dicek pemiliknya sambil berdiri di meja packing: berapa yang masuk, seberapa
 * bisa dipercaya angkanya, toko dan produk mana yang bermasalah.
 *
 * Keterangan kejujuran ikut dibawa, bukan dibuang demi ringkas. Laju harian
 * tanpa rentangnya, atau peringkat toko tanpa cakupan datanya, bukan versi
 * yang lebih pendek dari kebenaran -- itu klaim yang berbeda.
 */
public class DashboardActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout root;
    private TextView status;
    private int hari = 30;
    private JSONObject insights, ringkasHariIni, peringatan, tugas, v2;
    private String tglDari, tglSampai, gagalInsights;
    private int menunggu = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Dashboard");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(abu());
        root.addView(status);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);
        muat();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    /**
     * Empat sumber, digambar setelah semuanya pulang.
     *
     * Digambar sekali di akhir, bukan ditempel satu per satu begitu tiap
     * jawaban datang: urutan kedatangan tidak bisa ditebak, dan bagian yang
     * melompat-lompat saat dibaca lebih buruk daripada menunggu sebentar.
     * Yang gagal dibiarkan kosong -- satu endpoint mati tidak boleh
     * mengosongkan seluruh dashboard.
     */
    private void muat() {
        status.setText("Memuat…");
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        tglSampai = f.format(new Date());
        tglDari = f.format(new Date(System.currentTimeMillis() - (hari - 1L) * 86400000L));

        insights = null; ringkasHariIni = null; peringatan = null; tugas = null;
        v2 = null;
        gagalInsights = null;
        menunggu = 5;
        api.shopInsights(tglDari, tglSampai, r -> {
            if (r.ok()) insights = r.data();
            else gagalInsights = r.message("Gagal memuat dashboard.");
            siap();
        });
        api.dashboardSummary(r -> { if (r.ok()) ringkasHariIni = r.data(); siap(); });
        api.dashboardAlerts(r -> { if (r.ok()) peringatan = r.data(); siap(); });
        api.pendingTasks(r -> { if (r.ok()) tugas = r.data(); siap(); });
        api.dashboardV2(tglDari, tglSampai, r -> { if (r.ok()) v2 = r.data(); siap(); });
    }

    private void siap() {
        menunggu -= 1;
        if (menunggu > 0) return;
        if (insights == null) {
            status.setText(gagalInsights == null ? "Gagal memuat dashboard." : gagalInsights);
            return;
        }
        gambar(insights);
    }

    private void gambar(JSONObject d) {
        root.removeAllViews();
        root.addView(status);
        status.setText("Periode " + hari + " hari terakhir");
        root.addView(pilihPeriode());

        uangDanLaba();
        belumCairV2();
        hariIni();
        perluPerhatian();
        stokMenipisV2();
        belumLengkap();
        ringkasan(d);
        sorotan(d);
        bagianPemilik(d);
        bacaanData(d);
        penilaianToko(d);
        produk(d);
        bahanBaku(d);
        kesehatanToko(d);
    }

    private View pilihPeriode() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, (int) (8 * dp()), 0, 0);
        int[] pilihan = {7, 30, 90};
        for (int p : pilihan) {
            MaterialButton b = new MaterialButton(this, null,
                    p == hari
                            ? com.google.android.material.R.attr.materialButtonStyle
                            : com.google.android.material.R.attr.materialButtonOutlinedStyle);
            b.setText(p + " hari");
            b.setAllCaps(false);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            lp.rightMargin = (int) (6 * dp());
            b.setLayoutParams(lp);
            b.setOnClickListener(v -> { hari = p; muat(); });
            row.addView(b);
        }
        return row;
    }

    /* ------------------------------------------------------ bagian */

    private void ringkasan(JSONObject d) {
        JSONObject t = d.optJSONObject("totals");
        if (t == null) return;
        root.addView(judul("Ringkasan"));
        root.addView(angkaBesar(rp(t.optDouble("credit", 0)), "pencairan masuk"));
        root.addView(kotak("Aktivitas",
                t.optInt("parcels") + " paket · " + (int) t.optDouble("units", 0) + " pcs"
                        + "\n" + t.optInt("variety") + " jenis produk bergerak"
                        + "\n" + t.optInt("activeShops") + " toko aktif dari " + t.optInt("shops")));
    }

    /** Empat angka yang di web jadi kartu di paling atas. */
    private void hariIni() {
        if (ringkasHariIni == null) return;
        root.addView(judul("Hari ini"));
        root.addView(kotak("Order & omzet",
                ringkasHariIni.optInt("today_orders", 0) + " order hari ini"
                        + "\n" + rp(ringkasHariIni.optDouble("today_revenue", 0)) + " omzet hari ini"
                        + "\n" + ringkasHariIni.optInt("active_shops", 0) + " toko aktif"));
        // Total sepanjang masa ikut, seperti di web: angka hari ini tanpa
        // pembandingnya tidak memberi tahu apakah hari ini ramai atau sepi.
        root.addView(kotak("Sepanjang masa",
                ringkasHariIni.optInt("total_orders", 0) + " order"
                        + "\n" + rp(ringkasHariIni.optDouble("total_revenue", 0)) + " omzet"
                        + "\n" + rp(ringkasHariIni.optDouble("total_fee_charged", 0)) + " fee terpakai"));
    }

    /**
     * Uang yang masuk, ke mana perginya, dan berapa yang BENAR-BENAR tersisa.
     *
     * Bagian "bagian pemilik" di bawah menjawab siapa mendapat berapa dari
     * pencairan. Yang ini menjawab pertanyaan yang berbeda dan lebih penting:
     * setelah bahan baku benar-benar dibeli dan fee dibayar, berapa yang
     * tinggal. Dua angka itu sering dikira sama, dan tidak.
     *
     * SELISIH CADANGAN ditampilkan terang-terangan. Yang disisihkan untuk
     * bahan baku bukan yang dibelanjakan; memakai cadangan sebagai biaya
     * membuat laba terlihat lebih kecil daripada yang sebenarnya, dan itu
     * membuat orang menahan pengeluaran yang sebetulnya mampu.
     */
    private void uangDanLaba() {
        if (v2 == null) return;
        JSONObject u = v2.optJSONObject("uang");
        if (u == null) return;
        JSONObject b = v2.optJSONObject("biaya");
        JSONObject bd = v2.optJSONObject("banding");

        root.addView(judul("Uang " + hari + " hari terakhir"));
        root.addView(angkaBesar(rp(u.optDouble("kredit", 0)),
                u.optInt("pencairan", 0) + " pencairan · " + rp(u.optDouble("perHari", 0)) + " per hari"));

        if (bd != null && bd.optDouble("kredit", 0) > 0) {
            // Angka tanpa pembandingnya tidak memberi tahu apakah bulan ini
            // bagus atau buruk -- ia hanya besar.
            root.addView(kotak("Dibanding periode sebelumnya",
                    "Uang cair " + selisih(u.optDouble("kredit", 0), bd.optDouble("kredit", 0))
                            + "\nPaket " + selisih(v2.optJSONObject("volume") == null ? 0
                                    : v2.optJSONObject("volume").optDouble("paket", 0),
                                    bd.optDouble("paket", 0))));
        }

        StringBuilder ke = new StringBuilder();
        ke.append("Sedekah ").append(rp(u.optDouble("sedekah", 0))).append("\n");
        ke.append("Sub-seller ").append(rp(u.optDouble("subSeller", 0))).append("\n");
        ke.append("Disisihkan untuk bahan baku ").append(rp(u.optDouble("bahanBaku", 0))).append("\n");
        ke.append("Sisa untuk seller ").append(rp(u.optDouble("sellerBersih", 0)));
        root.addView(kotak("Ke mana uang itu pergi", ke.toString()));

        if (b == null) return;
        StringBuilder l = new StringBuilder();
        l.append(rp(b.optDouble("labaBersih", 0)))
         .append("  (").append(Math.round(b.optDouble("rateBersih", 0) * 100))
         .append("% dari yang cair)\n\n");
        l.append("Sudah dikurangi belanja bahan yang SEBENARNYA ")
         .append(rp(b.optDouble("bahanBaku", 0)))
         .append(" dari ").append(b.optInt("pembelianBahan", 0)).append(" pembelian");
        if (b.optDouble("upahPacking", 0) > 0) {
            l.append(", upah packing ").append(rp(b.optDouble("upahPacking", 0)));
        }
        if (b.optDouble("feeAdmin", 0) > 0) {
            l.append(", fee admin ").append(rp(b.optDouble("feeAdmin", 0)));
        }
        l.append(".");
        double selisihCad = b.optDouble("selisihCadangan", 0);
        if (Math.abs(selisihCad) > 1) {
            l.append("\n\nDisisihkan ").append(rp(u.optDouble("bahanBaku", 0)))
             .append(", dibelanjakan ").append(rp(b.optDouble("bahanBaku", 0)))
             .append(" — selisih ").append(rp(Math.abs(selisihCad)))
             .append(selisihCad > 0 ? " belum terpakai." : " lebih dari cadangan.");
        }
        root.addView(kotak("Laba bersih seller", l.toString()));
    }

    /**
     * Paket yang sudah diserahkan ke kurir tapi uangnya belum masuk.
     *
     * Ini piutang yang tidak pernah ditagih siapa pun kalau tidak ada yang
     * melihatnya. Umur tertua disebut karena itu yang menentukan apakah ini
     * jeda pencairan biasa atau ada yang tersangkut.
     */
    private void belumCairV2() {
        if (v2 == null) return;
        JSONObject c = v2.optJSONObject("belumCair");
        if (c == null || c.optInt("paket", 0) <= 0) return;
        LinearLayout box = kotak("Sudah dikirim, belum cair",
                c.optInt("paket", 0) + " paket"
                        + "\nTertua " + c.optInt("umurTertua", 0) + " hari"
                        + " · rata-rata " + Math.round(c.optDouble("umurRata", 0)) + " hari");
        if (c.optInt("umurTertua", 0) >= 14) box.setBackgroundColor(Color.parseColor("#FBF0DC"));
        root.addView(box);
    }

    /**
     * Bahan yang stoknya di bawah ambang, DENGAN angkanya.
     *
     * Peringatan di atas menyebut namanya saja. Nama tanpa angka tidak bisa
     * dipakai memutuskan apa pun -- dan pada data toko ini sebagian stoknya
     * MINUS, yang artinya bukan "menipis" melainkan pembukuannya sudah tidak
     * cocok dengan raknya dan perlu opname.
     */
    private void stokMenipisV2() {
        if (v2 == null) return;
        JSONObject s = v2.optJSONObject("stokMenipis");
        if (s == null || s.optInt("total", 0) <= 0) return;
        JSONArray a = s.optJSONArray("teratas");
        if (a == null || a.length() == 0) return;

        StringBuilder isi = new StringBuilder();
        int minus = 0;
        for (int i = 0; i < a.length(); i++) {
            JSONObject m = a.optJSONObject(i);
            if (m == null) continue;
            double stok = m.optDouble("stok", 0);
            if (stok < 0) minus++;
            isi.append("• ").append(m.optString("nama", "-")).append(": ")
               .append(Math.round(stok)).append(" ").append(m.optString("satuan", ""))
               .append("  (ambang ").append(Math.round(m.optDouble("ambang", 0))).append(")\n");
        }
        if (s.optInt("total", 0) > a.length()) {
            isi.append("dan ").append(s.optInt("total", 0) - a.length()).append(" bahan lagi");
        }
        root.addView(judul("Stok di bawah ambang (" + s.optInt("total", 0) + ")"));
        root.addView(kotak("", isi.toString().trim()));
        if (minus > 0) {
            root.addView(catatan(minus + " di antaranya MINUS — itu bukan menipis, itu "
                    + "pembukuan yang tidak lagi cocok dengan rak. Perlu opname."));
        }
    }

    /** "+38% dari Rp 2.775.391" — arah dan dasarnya sekaligus. */
    private String selisih(double sekarang, double lalu) {
        if (lalu <= 0) return rp(sekarang) + " (tidak ada pembanding)";
        double p = (sekarang - lalu) / lalu * 100;
        String tanda = p >= 0 ? "+" : "−";
        return rp(sekarang) + "  " + tanda + Math.round(Math.abs(p)) + "% dari " + rp(lalu);
    }

    /** Stok menipis, saldo rendah, token toko yang mau habis. */
    private void perluPerhatian() {
        if (peringatan == null) return;
        StringBuilder isi = new StringBuilder();

        JSONArray stok = peringatan.optJSONArray("low_stock");
        if (stok != null && stok.length() > 0) {
            isi.append(stok.length()).append(" bahan baku stoknya menipis: ");
            for (int i = 0; i < Math.min(3, stok.length()); i++) {
                JSONObject s = stok.optJSONObject(i);
                if (s == null) continue;
                if (i > 0) isi.append(", ");
                isi.append(s.optString("name", "-"));
            }
            if (stok.length() > 3) isi.append(", dan ").append(stok.length() - 3).append(" lagi");
            isi.append("\n");
        }

        JSONObject wallet = peringatan.optJSONObject("low_wallet");
        if (wallet != null) {
            isi.append("Saldo wallet rendah: ").append(rp(wallet.optDouble("balance", 0)))
               .append(" (minimum ").append(rp(wallet.optDouble("threshold", 0))).append(")\n");
        }

        JSONArray token = peringatan.optJSONArray("expiring_tokens");
        for (int i = 0; token != null && i < token.length(); i++) {
            JSONObject t = token.optJSONObject(i);
            if (t == null) continue;
            isi.append("Token toko akan kedaluwarsa: ")
               .append(t.optString("shop_name", t.optString("shop_id", "-"))).append("\n");
        }

        if (isi.length() == 0) return;
        root.addView(judul("Perlu perhatian"));
        LinearLayout box = kotak("", isi.toString().trim());
        box.setBackgroundColor(Color.parseColor("#FBF0DC"));
        root.addView(box);
    }

    /** Data yang belum lengkap, sama dengan yang di web muncul di dashboard. */
    private void belumLengkap() {
        if (tugas == null) return;
        int total = tugas.optInt("total", 0);
        if (total <= 0) return;
        StringBuilder isi = new StringBuilder();
        JSONArray daftar = tugas.optJSONArray("tasks");
        for (int i = 0; daftar != null && i < daftar.length(); i++) {
            JSONObject t = daftar.optJSONObject(i);
            if (t == null) continue;
            isi.append("• ").append(t.optString("title", "-"))
               .append(" (").append(t.optInt("count", 0)).append(")\n");
        }
        root.addView(judul("Data belum lengkap (" + total + ")"));
        root.addView(kotak("", isi.length() == 0 ? "-" : isi.toString().trim()));
    }

    /** Toko tersibuk, toko penghasil terbesar, produk yang paling bergerak. */
    private void sorotan(JSONObject d) {
        JSONObject h = d.optJSONObject("highlights");
        if (h == null) return;
        root.addView(judul("Sorotan"));

        JSONObject sibuk = h.optJSONObject("busiestShop");
        if (sibuk != null) {
            root.addView(kotak("Paling sibuk", sibuk.optString("name", "-")
                    + " — " + sibuk.optInt("parcels", 0) + " paket"));
        }
        JSONObject cuan = h.optJSONObject("topEarningShop");
        if (cuan != null) {
            root.addView(kotak("Penghasil terbesar", cuan.optString("name", "-")
                    + " — " + rp(cuan.optDouble("credit", 0))));
        }
        JSONArray produk = h.optJSONArray("topProducts");
        if (produk != null && produk.length() > 0) {
            StringBuilder isi = new StringBuilder();
            for (int i = 0; i < produk.length(); i++) {
                JSONObject p = produk.optJSONObject(i);
                if (p == null) continue;
                isi.append(i + 1).append(". ").append(p.optString("name", "-"))
                   .append(" — ").append(p.optInt("units", 0)).append(" pcs / ")
                   .append(p.optInt("parcels", 0)).append(" paket\n");
            }
            root.addView(kotak("Produk teratas", isi.toString().trim()));
        }
    }

    /** Siapa mendapat berapa: pemilik sendiri, lalu tiap sub-seller. */
    private void bagianPemilik(JSONObject d) {
        JSONObject o = d.optJSONObject("owners");
        if (o == null) return;
        root.addView(judul("Bagian pemilik"));
        JSONObject s = o.optJSONObject("seller");
        if (s != null) {
            root.addView(kotak("Seller", rp(s.optDouble("total", 0))
                    + "\n" + rp(s.optDouble("perDay", 0)) + " per hari"
                    + " · " + rp(s.optDouble("perMonth", 0)) + " per bulan"));
        }
        JSONArray subs = o.optJSONArray("subSellers");
        for (int i = 0; subs != null && i < subs.length(); i++) {
            JSONObject x = subs.optJSONObject(i);
            if (x == null) continue;
            // Yang nol tetap ditampilkan: sub-seller yang tidak kebagian
            // apa-apa pada periode ini adalah informasi, bukan baris kosong.
            root.addView(kotak(x.optString("name", "-"), rp(x.optDouble("total", 0))
                    + "\n" + rp(x.optDouble("perDay", 0)) + " per hari"));
        }
    }

    private void bacaanData(JSONObject d) {
        JSONObject st = d.optJSONObject("statistics");
        if (st == null) return;
        JSONObject span = st.optJSONObject("span");
        JSONObject rate = st.optJSONObject("rate");
        JSONObject cov = st.optJSONObject("coverage");
        if (span == null || rate == null || cov == null) return;

        root.addView(judul("Bacaan data"));

        if (span.optInt("parcels") == 0) {
            root.addView(kotak("Belum ada paket",
                    "Tidak ada paket terscan di periode ini, jadi tidak ada yang bisa dibaca."));
            return;
        }

        String laju = rate.isNull("parcelsPerDay") ? "—" : rate.optDouble("parcelsPerDay") + "";
        String bawah = rate.isNull("parcelsPerDayLow") ? null : rate.optDouble("parcelsPerDayLow") + "";
        String atas = rate.isNull("parcelsPerDayHigh") ? null : rate.optDouble("parcelsPerDayHigh") + "";

        StringBuilder s = new StringBuilder();
        s.append(laju).append(" paket per hari");
        if (bawah != null) s.append("\nkemungkinan ").append(bawah).append("–").append(atas);
        s.append("\n\n").append(span.optInt("parcels")).append(" paket · ")
                .append((int) span.optDouble("units", 0)).append(" pcs dalam ")
                .append(span.optInt("spanDays")).append(" hari berdata");

        // Pembagi yang benar disebut, karena inilah yang membuat angkanya
        // berbeda dari sekadar membagi dengan panjang filter.
        int jendela = span.optInt("windowDays");
        int rentang = span.optInt("spanDays");
        if (jendela > rentang) {
            s.append("\n\nDibagi ").append(rentang).append(" hari yang benar-benar ada datanya, ")
                    .append("bukan ").append(jendela).append(" hari panjang filter. Dibagi filter, ")
                    .append("angkanya jadi ").append(rate.optDouble("parcelsPerWindowDay"))
                    .append(" paket/hari — itu hari kosong yang ikut membagi.");
        }
        double disp = rate.optDouble("dispersion", 0);
        if (disp > 1.5) {
            s.append("\n\nHarian tidak rata (dispersi ").append(disp)
                    .append("), jadi rentang di atas memang lebar.");
        }
        root.addView(kotak("Laju", s.toString()));

        // Kelengkapan: yang menentukan seberapa jauh angka per toko bisa dibaca.
        StringBuilder k = new StringBuilder();
        k.append("Isi paket ").append(persen(cov, "itemsPct")).append("\n");
        k.append("Toko ").append(persen(cov, "shopPct"))
                .append("  (dipakai angka per toko)\n");
        k.append("Marketplace ").append(persen(cov, "marketplacePct")).append("\n");
        k.append("Kurir ").append(persen(cov, "courierPct"));
        root.addView(kotak("Kelengkapan data", k.toString()));

        JSONObject con = st.optJSONObject("concentration");
        if (con != null && !con.isNull("topProductName")) {
            root.addView(kotak("Ketergantungan",
                    "Produk teratas " + con.optString("topProductName") + " "
                            + con.optDouble("topProductSharePct") + "% unit"
                            + "\n" + con.optInt("distinctProducts") + " produk terjual, setara "
                            + con.optDouble("effectiveProducts") + " produk"));
        }
        if (rentang < 28) {
            root.addView(catatan("Data baru " + rentang + " hari — “belum laku” berarti belum "
                    + "terjual, bukan terbukti tidak laku. Margin dan bahan terkunci tidak "
                    + "tergantung lamanya data."));
        }
    }

    private void penilaianToko(JSONObject d) {
        JSONObject sv = d.optJSONObject("shopValue");
        if (sv == null) return;
        JSONArray items = sv.optJSONArray("items");
        if (items == null || items.length() == 0) return;

        root.addView(judul("Toko: mana yang worth it"));
        root.addView(catatan("Diurutkan dari uang yang masuk ke seller. Bukan skor gabungan: "
                + "pencairan terpetakan penuh, sedangkan " + (sv.optInt("totalScans")
                - sv.optInt("unmappedScans")) + " dari " + sv.optInt("totalScans")
                + " paket saja yang punya toko."));

        for (int i = 0; i < items.length(); i++) {
            JSONObject s = items.optJSONObject(i);
            if (s == null) continue;
            StringBuilder isi = new StringBuilder();
            isi.append(rp(s.optDouble("sellerTake", 0)))
                    .append(" · ").append(rp(s.optDouble("sellerPerDay", 0))).append("/hari");
            isi.append("\n").append(s.optInt("parcels")).append(" paket · ")
                    .append((int) s.optDouble("units", 0)).append(" pcs · ")
                    .append(s.optInt("variety")).append(" jenis");
            JSONArray notes = s.optJSONArray("notes");
            for (int n = 0; notes != null && n < notes.length(); n++) {
                isi.append("\n• ").append(notes.optString(n));
            }
            root.addView(kotak("[" + tingkat(s.optString("tier")) + "] "
                    + s.optString("name") + " (" + s.optString("marketplace", "-") + ")",
                    isi.toString()));
        }
    }

    private void produk(JSONObject d) {
        JSONObject ph = d.optJSONObject("productHealth");
        if (ph == null) return;

        JSONArray kuat = ph.optJSONArray("strong");
        if (kuat != null && kuat.length() > 0) {
            root.addView(judul("Produk yang worth it"));
            root.addView(catatan("Diurutkan dari rupiah yang benar-benar disumbang, bukan dari "
                    + "persen marginnya."));
            for (int i = 0; i < Math.min(5, kuat.length()); i++) {
                JSONObject p = kuat.optJSONObject(i);
                if (p == null) continue;
                root.addView(kotak(p.optString("name"),
                        rp(p.optDouble("contribution", 0)) + " disumbang"
                                + "\n" + (int) p.optDouble("soldQty", 0) + " pcs · margin "
                                + Math.round(p.optDouble("netMarginRate", 0) * 1000) / 10.0 + "%"
                                + " · " + p.optInt("shopCount") + " toko"));
            }
        }

        JSONArray lemah = ph.optJSONArray("items");
        if (lemah != null && lemah.length() > 0) {
            root.addView(judul("Produk yang kurang worth it"));
            for (int i = 0; i < Math.min(5, lemah.length()); i++) {
                JSONObject p = lemah.optJSONObject(i);
                if (p == null) continue;
                StringBuilder isi = new StringBuilder();
                JSONArray alasan = p.optJSONArray("reasons");
                for (int n = 0; alasan != null && n < alasan.length(); n++) {
                    isi.append(n > 0 ? "\n" : "").append("• ").append(alasan.optString(n));
                }
                root.addView(kotak(p.optString("name"), isi.toString()));
            }
        }

        JSONArray belum = ph.optJSONArray("unjudged");
        if (belum != null && belum.length() > 0) {
            root.addView(catatan(belum.length() + " produk belum bisa dinilai — belum ada harga "
                    + "publish. Selama kosong, margin dan kemahalan tidak bisa dihitung sama "
                    + "sekali, jadi produk itu tidak masuk daftar di atas — bukan berarti sehat."));
        }
    }

    private void bahanBaku(JSONObject d) {
        JSONObject rs = d.optJSONObject("restock");
        if (rs == null) return;
        root.addView(judul("Bahan baku"));

        double sisa = rs.optDouble("heldVsSpent", 0);
        root.addView(kotak("Jatah vs belanja",
                (sisa >= 0 ? "Sisa " + rp(sisa) : "Belanja lebih besar " + rp(-sisa))
                        + "\nJatah " + rp(rs.optDouble("heldForMaterials", 0))
                        + " · Belanja " + rp(rs.optDouble("spend", 0))));

        JSONObject vp = rs.optJSONObject("vsPublish");
        if (vp != null && !vp.isNull("plannedPct") && !vp.isNull("actualPct")) {
            root.addView(kotak("Porsi dari harga publish",
                    "Rencana (resep) " + vp.optDouble("plannedPct") + "%"
                            + "\nNyata (belanja) " + vp.optDouble("actualPct") + "%"
                            + "\nSelisih " + vp.optDouble("gapPct") + " poin"
                            + "\n\nBelanja stok itu pembelian, bukan pemakaian — sekali beli "
                            + "dipakai berbulan-bulan, jadi angka “nyata” baru bisa dipercaya "
                            + "pada rentang panjang."));
        }
        if (rs.optInt("unpricedPurchases") > 0) {
            root.addView(catatan(rs.optInt("unpricedPurchases") + " dari " + rs.optInt("purchases")
                    + " pembelian belum ada nominalnya, jadi belanja sebenarnya lebih besar."));
        }
    }

    private void kesehatanToko(JSONObject d) {
        JSONArray shops = d.optJSONArray("shops");
        if (shops == null || shops.length() == 0) return;
        root.addView(judul("Kesehatan toko"));
        Object rd = d.opt("rateDays");
        for (int i = 0; i < shops.length(); i++) {
            JSONObject s = shops.optJSONObject(i);
            if (s == null) continue;
            StringBuilder isi = new StringBuilder();
            isi.append(s.optString("status")).append(" · ")
                    .append(rp(s.optDouble("credit", 0)));
            isi.append("\n").append(s.optInt("parcels")).append(" paket");
            if (!s.isNull("parcelsPerDay")) {
                isi.append(" · ").append(s.optDouble("parcelsPerDay")).append(" resi/hari");
                isi.append(" · ").append(s.optDouble("unitsPerDay")).append(" pcs/hari");
            }
            isi.append("\nkirim ").append(s.optInt("activeDays")).append(" hari");
            // Diketuk untuk melihat isinya: resi mana saja, kapan, dan
            // pencairannya -- pertanyaan yang tidak bisa dijawab kartu ringkas.
            final String shopId = s.optString("id", "");
            final String namaToko = s.optString("name", "");
            LinearLayout kartuToko = kotak(namaToko
                    + " (" + s.optString("marketplace", "-") + ")",
                    isi.toString() + "\nketuk untuk lihat isinya");
            kartuToko.setOnClickListener(v -> {
                Intent buka = new Intent(this, ShopDetailActivity.class);
                buka.putExtra("shopId", shopId);
                buka.putExtra("shopName", namaToko);
                buka.putExtra("from", tglDari);
                buka.putExtra("to", tglSampai);
                startActivity(buka);
            });
            root.addView(kartuToko);
        }
        if (rd instanceof Integer) {
            root.addView(catatan("Kolom per hari dibagi " + rd + " hari yang benar-benar ada "
                    + "datanya, bukan panjang filter periode."));
        }
    }

    /* ------------------------------------------------------ bantu */

    private static String tingkat(String t) {
        if ("andalan".equals(t)) return "andalan";
        if ("sehat".equals(t)) return "sehat";
        if ("tipis".equals(t)) return "tipis";
        if ("belumMenghasilkan".equals(t)) return "belum menghasilkan";
        if ("takTerlihat".equals(t)) return "tidak terlihat";
        if ("vakum".equals(t)) return "vakum";
        return t;
    }

    private static String persen(JSONObject cov, String key) {
        return cov.isNull(key) ? "—" : cov.optDouble(key) + "%";
    }

    static String rp(double v) {
        return "Rp " + String.format(new Locale("id", "ID"), "%,.0f", v);
    }

    private float dp() { return getResources().getDisplayMetrics().density; }

    private static int abu() { return Color.parseColor("#6B7178"); }

    private TextView judul(String t) {
        TextView v = new TextView(this);
        v.setTextSize(16);
        v.setTextColor(Color.parseColor("#20242B"));
        v.setPadding(0, (int) (20 * dp()), 0, (int) (4 * dp()));
        v.setText(t);
        return v;
    }

    private TextView catatan(String t) {
        TextView v = new TextView(this);
        v.setTextSize(11);
        v.setTextColor(abu());
        v.setPadding(0, (int) (6 * dp()), 0, 0);
        v.setText(t);
        return v;
    }

    private View angkaBesar(String angka, String label) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(0, (int) (8 * dp()), 0, (int) (4 * dp()));
        TextView a = new TextView(this);
        a.setTextSize(26);
        a.setTextColor(Color.parseColor("#20242B"));
        a.setText(angka);
        box.addView(a);
        TextView l = new TextView(this);
        l.setTextSize(12);
        l.setTextColor(abu());
        l.setText(label);
        box.addView(l);
        return box;
    }

    private LinearLayout kotak(String judul, String isi) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (12 * dp());
        box.setPadding(p, p, p, p);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (8 * dp());
        box.setLayoutParams(lp);
        box.setBackgroundColor(Color.parseColor("#F6F7F8"));

        TextView t = new TextView(this);
        t.setTextSize(14);
        t.setTextColor(Color.parseColor("#20242B"));
        t.setText(judul);
        box.addView(t);

        TextView s = new TextView(this);
        s.setTextSize(12);
        s.setTextColor(abu());
        s.setText(isi);
        box.addView(s);
        return box;
    }
}
