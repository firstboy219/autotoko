package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Satu toko: apa saja transaksinya, kapan discan, dan pencairannya.
 *
 * Sama seperti modal detail toko di web, dan dari endpoint yang sama. Yang
 * ditanyakan di layar ini bukan "toko ini sehat atau tidak" -- itu sudah
 * dijawab kartu di dashboard -- melainkan "isinya apa", jadi yang ditampilkan
 * adalah baris demi baris, bukan ringkasan lagi.
 */
public class ShopDetailActivity extends AppCompatActivity {

    /** Resi ditampilkan sebanyak ini saja; sisanya disebut jumlahnya. */
    private static final int MAKS_RESI = 120;

    private Api api;
    private LinearLayout root;
    private TextView status;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        Intent in = getIntent();
        final String shopId = in.getStringExtra("shopId");
        final String nama = in.getStringExtra("shopName");
        final String from = in.getStringExtra("from");
        final String to = in.getStringExtra("to");

        setTitle(nama == null || nama.isEmpty() ? "Detail Toko" : nama);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        int pad = (int) (16 * PayoutUi.d(this));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(Color.parseColor(PayoutUi.INK2));
        status.setText("Memuat…");
        root.addView(status);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);

        if (shopId == null || shopId.isEmpty()) {
            status.setText("Toko tidak dikenali.");
            return;
        }
        api.shopDetail(shopId, from, to, r -> {
            if (!r.ok() || r.data() == null) {
                status.setText(r.message("Gagal memuat detail toko."));
                return;
            }
            gambar(r.data());
        });
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private void gambar(JSONObject d) {
        root.removeAllViews();
        root.addView(status);

        JSONObject shop = d.optJSONObject("shop");
        JSONObject range = d.optJSONObject("range");
        status.setText((shop == null ? "" : PayoutUi.str(shop, "marketplace", "-"))
                + (shop != null && !shop.isNull("categoryName")
                        ? " · " + PayoutUi.str(shop, "categoryName", "") : "")
                + (range == null ? "" : "\n" + PayoutUi.str(range, "from", "")
                        + " s/d " + PayoutUi.str(range, "to", "")));

        JSONObject t = d.optJSONObject("totals");
        if (t != null) {
            StringBuilder isi = new StringBuilder();
            isi.append(t.optInt("parcels")).append(" paket · ")
               .append((int) PayoutUi.num(t, "units")).append(" pcs\n");
            isi.append("Kredit ").append(PayoutUi.rp(PayoutUi.num(t, "credit"))).append("\n");
            isi.append("Bagian seller ").append(PayoutUi.rp(PayoutUi.num(t, "seller")));
            double sub = PayoutUi.num(t, "subSeller");
            if (sub > 0) isi.append("\nBagian sub-seller ").append(PayoutUi.rp(sub));
            int belum = t.optInt("unconfirmedItems", 0);
            if (belum > 0) isi.append("\n").append(belum).append(" paket isinya belum dipastikan");
            root.addView(PayoutUi.kotak(this, "Ringkasan", isi.toString()));
        }

        // Resi yang belum dipetakan ke toko mana pun ikut disebut: tanpa itu,
        // angka di atas terbaca sebagai seluruh kejadian pada periode ini,
        // padahal ada yang belum masuk hitungan toko mana pun.
        int unmapped = d.optInt("unmappedInWindow", 0);
        if (unmapped > 0) {
            root.addView(PayoutUi.catatan(this, unmapped + " resi pada periode ini belum "
                    + "dipetakan ke toko mana pun, jadi belum masuk hitungan di atas."));
        }

        JSONArray payouts = d.optJSONArray("payouts");
        if (payouts != null && payouts.length() > 0) {
            root.addView(PayoutUi.judul(this, "Pencairan per Tanggal"));
            for (int i = 0; i < payouts.length(); i++) {
                JSONObject p = payouts.optJSONObject(i);
                if (p == null) continue;
                String ket = PayoutUi.rp(PayoutUi.num(p, "seller")) + " bagian seller";
                double sub = PayoutUi.num(p, "subSeller");
                if (sub > 0) ket += " · " + PayoutUi.rp(sub) + " sub-seller";
                root.addView(PayoutUi.baris(this,
                        PayoutShare.tglPanjang(PayoutUi.str(p, "payoutDate", "")),
                        ket, PayoutUi.rp(PayoutUi.num(p, "credit")), null));
                root.addView(PayoutUi.garis(this));
            }
        }

        JSONArray scans = d.optJSONArray("scans");
        if (scans == null || scans.length() == 0) {
            root.addView(PayoutUi.catatan(this, "Belum ada resi tercatat pada periode ini."));
            return;
        }
        root.addView(PayoutUi.judul(this, "Resi (" + scans.length() + ")"));
        int tampil = Math.min(scans.length(), MAKS_RESI);
        for (int i = 0; i < tampil; i++) {
            JSONObject s = scans.optJSONObject(i);
            if (s == null) continue;

            StringBuilder ket = new StringBuilder();
            ket.append(jam(PayoutUi.str(s, "scannedAt", "")));
            String kurir = PayoutUi.str(s, "courier", null);
            if (kurir != null) {
                ket.append(" · ").append(kurir);
                // Tebakan yang belum dibenarkan orang ditandai, bukan
                // ditampilkan seolah sudah pasti.
                if (!s.optBoolean("courierConfirmed", false)) ket.append(" (tebakan)");
            }
            if (s.optBoolean("cod", false)) ket.append(" · COD");

            StringBuilder isi = new StringBuilder();
            JSONArray items = s.optJSONArray("items");
            if (items != null && items.length() > 0) {
                for (int k = 0; k < items.length(); k++) {
                    JSONObject it = items.optJSONObject(k);
                    if (it == null) continue;
                    if (isi.length() > 0) isi.append(", ");
                    String n = PayoutUi.str(it, "name", null);
                    if (n == null) n = PayoutUi.str(it, "rawName", "(tanpa nama)");
                    isi.append(n);
                    double q = PayoutUi.num(it, "qty");
                    if (q > 1) isi.append(" ×").append((int) q);
                }
            }
            if (!s.optBoolean("itemsConfirmed", true)) {
                isi.append(isi.length() > 0 ? " · " : "").append("isi belum dipastikan");
            }

            LinearLayout kartu = new LinearLayout(this);
            kartu.setOrientation(LinearLayout.VERTICAL);
            int p = (int) (8 * PayoutUi.d(this));
            kartu.setPadding(0, p, 0, p);

            TextView resi = new TextView(this);
            resi.setText(PayoutUi.str(s, "resi", "(tanpa resi)"));
            resi.setTextSize(14);
            resi.setTextColor(Color.parseColor(PayoutUi.INK));
            kartu.addView(resi);

            TextView meta = new TextView(this);
            meta.setText(ket.toString());
            meta.setTextSize(11);
            meta.setTextColor(Color.parseColor(PayoutUi.INK2));
            kartu.addView(meta);

            if (isi.length() > 0) {
                TextView isiView = new TextView(this);
                isiView.setText(isi.toString());
                isiView.setTextSize(12);
                isiView.setTextColor(Color.parseColor(PayoutUi.INK));
                kartu.addView(isiView);
            }

            root.addView(kartu);
            root.addView(PayoutUi.garis(this));
        }
        if (scans.length() > tampil) {
            root.addView(PayoutUi.catatan(this,
                    (scans.length() - tampil) + " resi lainnya tidak ditampilkan di sini."));
        }
    }

    /** "2026-08-29T11:44:58.31" jadi "29 Agu 11:44". */
    private static String jam(String iso) {
        if (iso == null || iso.length() < 16) return "-";
        String tgl = PayoutShare.tglPanjang(iso.substring(0, 10));
        // Cap waktu dari endpoint ini tanpa zona; ditampilkan apa adanya
        // daripada digeser dengan tebakan zona yang belum tentu benar.
        return tgl.replaceAll(" \\d{4}$", "") + " " + iso.substring(11, 16);
    }
}
