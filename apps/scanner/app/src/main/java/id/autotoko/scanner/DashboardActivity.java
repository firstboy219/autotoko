package id.autotoko.scanner;

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

    private void muat() {
        status.setText("Memuat…");
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        String to = f.format(new Date());
        String from = f.format(new Date(System.currentTimeMillis() - (hari - 1L) * 86400000L));
        api.shopInsights(from, to, r -> {
            if (!r.ok() || r.data() == null) {
                status.setText(r.message("Gagal memuat dashboard."));
                return;
            }
            gambar(r.data());
        });
    }

    private void gambar(JSONObject d) {
        root.removeAllViews();
        root.addView(status);
        status.setText("Periode " + hari + " hari terakhir");
        root.addView(pilihPeriode());

        ringkasan(d);
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
            root.addView(kotak(s.optString("name") + " (" + s.optString("marketplace", "-") + ")",
                    isi.toString()));
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
