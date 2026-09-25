package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
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
    private androidx.appcompat.app.AlertDialog dialogVersi;
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
        setContentView(NavBawah.bungkus(this, sv, NavBawah.HOME));
        muat();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    @Override
    public boolean onCreateOptionsMenu(android.view.Menu menu) {
        menu.add(0, 9001, 0, "Akun");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(android.view.MenuItem item) {
        if (item.getItemId() == 9001) { AccountSwitcher.show(this, new Session(this)); return true; }
        return super.onOptionsItemSelected(item);
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
        root.addView(kartuKpi());
        root.addView(gridNavigasi());
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
        LinearLayout kOrder = kotak("Order & omzet",
                ringkasHariIni.optInt("today_orders", 0) + " order hari ini"
                        + "\n" + rp(ringkasHariIni.optDouble("today_revenue", 0)) + " omzet hari ini"
                        + "\n" + ringkasHariIni.optInt("active_shops", 0) + " toko aktif"
                        + "\n\u2192 ketuk untuk lihat komposisi (toko & produk)");
        kOrder.setOnClickListener(v -> bukaKomposisiHariIni());
        root.addView(kOrder);
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

    /** Rincian komposisi order hari ini: per toko + produk & qty. */
    private void bukaKomposisiHariIni() {
        android.widget.Toast.makeText(this, "Memuat komposisi\u2026", android.widget.Toast.LENGTH_SHORT).show();
        api.todayComposition(r -> {
            if (r == null || !r.ok() || r.data() == null) {
                android.widget.Toast.makeText(this, "Gagal memuat komposisi.", android.widget.Toast.LENGTH_SHORT).show();
                return;
            }
            JSONObject d = r.data();
            int pad = (int) (16 * dp());
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setPadding(pad, pad, pad, pad);

            double rev = 0; try { rev = Double.parseDouble(d.optString("totalRevenue", "0")); } catch (Exception ignore) {}
            TextView head = new TextView(this);
            head.setTextSize(15);
            head.setTextColor(Color.parseColor("#20242B"));
            head.setText(d.optInt("totalOrders", 0) + " order \u00b7 " + rp(rev) + " hari ini");
            box.addView(head);

            JSONArray ps = d.optJSONArray("perShop");
            box.addView(seksiKomposisi("Per toko"));
            if (ps == null || ps.length() == 0) box.addView(barisKomposisi("Belum ada order hari ini.", true));
            else for (int i = 0; i < ps.length(); i++) {
                JSONObject sh = ps.optJSONObject(i); if (sh == null) continue;
                double sr = 0; try { sr = Double.parseDouble(sh.optString("revenue", "0")); } catch (Exception ignore) {}
                box.addView(barisKomposisi(sh.optString("shopName", "(tanpa toko)") + "  \u2014  "
                        + sh.optInt("orders", 0) + " order \u00b7 " + rp(sr), false));
            }

            JSONArray pr = d.optJSONArray("products");
            box.addView(seksiKomposisi("Produk dibeli"));
            if (pr == null || pr.length() == 0) box.addView(barisKomposisi("Belum ada produk hari ini.", true));
            else for (int i = 0; i < pr.length(); i++) {
                JSONObject po = pr.optJSONObject(i); if (po == null) continue;
                box.addView(barisKomposisi(po.optInt("qty", 0) + " pcs  \u00b7  "
                        + po.optString("name", "(tanpa nama)") + "  (" + po.optInt("orders", 0) + " order)", false));
            }

            ScrollView sc = new ScrollView(this);
            sc.addView(box);
            new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("Komposisi hari ini")
                    .setView(sc)
                    .setPositiveButton("Tutup", null)
                    .show();
        });
    }

    private TextView seksiKomposisi(String t) {
        TextView tv = new TextView(this);
        tv.setTextSize(13);
        tv.setTypeface(null, android.graphics.Typeface.BOLD);
        tv.setTextColor(Color.parseColor("#20242B"));
        tv.setPadding(0, (int) (14 * dp()), 0, (int) (4 * dp()));
        tv.setText(t);
        return tv;
    }

    private TextView barisKomposisi(String t, boolean redup) {
        TextView tv = new TextView(this);
        tv.setTextSize(13);
        tv.setTextColor(redup ? abu() : Color.parseColor("#3A4048"));
        tv.setPadding(0, (int) (3 * dp()), 0, (int) (3 * dp()));
        tv.setText(t);
        return tv;
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

    // ---- Gaya BigSeller: kartu KPI + grid tile navigasi ----
    private View kartuKpi() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (16 * dp());
        card.setPadding(p, p, p, p);
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{ Color.parseColor("#0E6E55"), Color.parseColor("#0A5642") });
        g.setCornerRadius(16 * dp());
        card.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (10 * dp());
        card.setLayoutParams(lp);

        TextView h = new TextView(this);
        h.setText("Penjualan Hari Ini");
        h.setTextColor(Color.WHITE); h.setTextSize(15);
        h.setTypeface(null, android.graphics.Typeface.BOLD);
        card.addView(h);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rl.topMargin = (int) (10 * dp());
        row.setLayoutParams(rl);
        int orders = ringkasHariIni == null ? 0 : ringkasHariIni.optInt("today_orders", 0);
        double rev = ringkasHariIni == null ? 0 : ringkasHariIni.optDouble("today_revenue", 0);
        row.addView(kpiCol(String.valueOf(orders), "Jumlah pesanan"),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(kpiCol(rp(rev), "Omzet (IDR)"),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        card.addView(row);
        return card;
    }

    private View kpiCol(String big, String label) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        TextView b = new TextView(this);
        b.setText(big); b.setTextColor(Color.WHITE); b.setTextSize(22);
        b.setTypeface(null, android.graphics.Typeface.BOLD);
        c.addView(b);
        TextView l = new TextView(this);
        l.setText(label); l.setTextColor(Color.parseColor("#CFE6DE")); l.setTextSize(12);
        c.addView(l);
        return c;
    }

    @Override protected void onResume() {
        super.onResume();
        paksaCekVersi();
    }

    /**
     * Gate WAJIB UPDATE: setiap dashboard tampil, jika versi terpasang lebih lama
     * dari versi terbaru di server, paksa update (dialog tak bisa ditutup; satu-
     * satunya tombol membuka halaman update). Mengganti pola "ditawarkan" untuk
     * titik masuk ini.
     */
    private void paksaCekVersi() {
        if (dialogVersi != null && dialogVersi.isShowing()) return;
        final int terpasang;
        final String namaT;
        try {
            android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            terpasang = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P
                    ? (int) pi.getLongVersionCode() : pi.versionCode;
            namaT = pi.versionName;
        } catch (Exception e) { return; }
        api.appReleases(r -> {
            if (r == null || !r.ok() || r.data() == null) return;
            org.json.JSONObject c = r.data().optJSONObject("current");
            if (c == null || c.optInt("versionCode", 0) <= terpasang) return;
            if (isFinishing() || isDestroyed()) return;
            if (dialogVersi != null && dialogVersi.isShowing()) return;
            String pesan = "Versi di HP ini: " + namaT + "\nWajib update ke " + c.optString("versionName", "")
                    + " sebelum melanjutkan.";
            String catatan = c.optString("notes", "");
            if (!catatan.isEmpty() && !"null".equals(catatan)) pesan += "\n\n" + catatan;
            dialogVersi = new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("Update Wajib")
                    .setMessage(pesan)
                    .setCancelable(false)
                    .setPositiveButton("Update Sekarang", (d, w) -> startActivity(new Intent(this, UpdateActivity.class)))
                    .show();
        });
    }

    private View gridNavigasi() {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams wl = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        wl.topMargin = (int) (14 * dp());
        wrap.setLayoutParams(wl);
        TextView t = new TextView(this);
        t.setText("Menu"); t.setTextSize(14);
        t.setTypeface(null, android.graphics.Typeface.BOLD);
        t.setTextColor(Color.parseColor("#20242B"));
        t.setPadding(0, 0, 0, (int) (6 * dp()));
        wrap.addView(t);
        // 5.40: Pesanan pindah ke footer; HPP, Pencairan, Stok, Scan Teks,
        // Belum Lengkap, Akun Staff dipensiunkan dari APK (kelola di web).
        java.util.List<String[]> daftar = new java.util.ArrayList<>(java.util.Arrays.asList(new String[][]{
                {"🧾", "Batch Packing", "#0E6E55", "B"},
                {"📷", "Scan Resi", "#6366F1", "S"},
                {"🚫", "Cek Resi Batal", "#DC2626", "X"},
                {"📥", "Bahan Baku", "#14B8A6", "D"},
                {"💳", "Cek Saldo", "#16A34A", "C"},
                {"🕒", "Riwayat", "#64748B", "R"},
                {"🔗", "Integrasi Toko", "#3B82F6", "I"},
                {"⬇️", "Versi Aplikasi", "#059669", "U"},
        }));
        // Menghubungkan toko hanya untuk pemilik (server juga menolak staf).
        if (Access.termuat() && !Access.pemilik()) {
            for (int i = daftar.size() - 1; i >= 0; i--) if ("I".equals(daftar.get(i)[3])) daftar.remove(i);
        }
        String[][] tiles = daftar.toArray(new String[0][]);
        LinearLayout row = null;
        for (int i = 0; i < tiles.length; i++) {
            if (i % 4 == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                rl.topMargin = (int) (4 * dp());
                row.setLayoutParams(rl);
                wrap.addView(row);
            }
            row.addView(tile(tiles[i][0], tiles[i][1], tiles[i][2], tiles[i][3]));
        }
        return wrap;
    }

    private View tile(String emoji, String label, String color, String code) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        col.setPadding(0, (int) (8 * dp()), 0, (int) (8 * dp()));
        col.setClickable(true); col.setFocusable(true);
        TextView box = new TextView(this);
        box.setText(emoji); box.setTextSize(22); box.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor(color)); g.setCornerRadius(14 * dp());
        box.setBackground(g);
        int s = (int) (48 * dp());
        box.setLayoutParams(new LinearLayout.LayoutParams(s, s));
        col.addView(box);
        TextView l = new TextView(this);
        l.setText(label); l.setTextSize(11); l.setGravity(Gravity.CENTER);
        l.setTextColor(Color.parseColor("#20242B"));
        l.setPadding(0, (int) (4 * dp()), 0, 0);
        col.addView(l);
        col.setOnClickListener(v -> bukaMenu(code));
        return col;
    }

    private void bukaMenu(String code) {
        Intent i;
        switch (code) {
            case "B": i = new Intent(this, OrdersActivity.class); i.putExtra("openBatch", true); break;
            case "S": i = new Intent(this, ScanActivity.class); break;
            case "X": i = new Intent(this, ScanActivity.class); i.putExtra("cekMode", true); break;
            case "D": i = new Intent(this, DeliveryActivity.class); break;
            case "C": i = new Intent(this, SaldoActivity.class); break;
            case "R": i = new Intent(this, HistoryActivity.class); break;
            case "I": i = new Intent(this, IntegrasiTokoActivity.class); break;
            case "U": i = new Intent(this, UpdateActivity.class); break;
            default: return;
        }
        startActivity(i);
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
