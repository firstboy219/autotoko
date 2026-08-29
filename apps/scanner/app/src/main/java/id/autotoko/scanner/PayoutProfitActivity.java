package id.autotoko.scanner;

import android.graphics.Color;
import android.os.Bundle;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * Berapa yang benar-benar tinggal di pemiliknya, dan dari mana.
 *
 * Angka yang dipakai adalah bagian yang diterima, bukan omzet: kredit yang cair
 * sudah dipotong marketplace, dan menyebutnya "laba" akan membuat setiap rate
 * di halaman ini terbaca terlalu besar.
 */
public class PayoutProfitActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout root, isi;
    private TextView status;
    private EditText dari, sampai;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Laba Pencairan");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        int pad = (int) (16 * PayoutUi.d(this));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        // Bawaannya bulan berjalan: rentang yang paling sering ditanyakan, dan
        // menampilkan seluruh riwayat sebagai bawaan membuat angkanya tidak
        // bisa dibandingkan dengan apa pun.
        Calendar c = Calendar.getInstance();
        String akhir = tgl(c);
        c.set(Calendar.DAY_OF_MONTH, 1);
        String awal = tgl(c);

        root.addView(PayoutUi.label(this, "Dari tanggal"));
        dari = PayoutUi.isian(this, "2026-08-01", awal, false);
        root.addView(dari);
        root.addView(PayoutUi.label(this, "Sampai tanggal"));
        sampai = PayoutUi.isian(this, "2026-08-31", akhir, false);
        root.addView(sampai);
        root.addView(PayoutUi.tombol(this, "Tampilkan", v -> muat()), PayoutUi.lebar(this));

        status = new TextView(this);
        status.setTextSize(13);
        status.setText("Memuat…");
        root.addView(status);

        isi = new LinearLayout(this);
        isi.setOrientation(LinearLayout.VERTICAL);
        root.addView(isi);

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

    private static String tgl(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d",
                c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    private void muat() {
        status.setText("Memuat…");
        isi.removeAllViews();
        api.payoutProfit(dari.getText().toString().trim(),
                sampai.getText().toString().trim(), r -> {
            if (!r.ok() || r.data() == null) {
                status.setText(r.message("Gagal memuat laba."));
                return;
            }
            gambar(r.data());
        });
    }

    private void gambar(JSONObject d) {
        isi.removeAllViews();
        JSONObject t = d.optJSONObject("totals");
        JSONObject n = d.optJSONObject("counts");
        if (t == null) {
            status.setText("Tidak ada data pada rentang ini.");
            return;
        }
        status.setText(PayoutUi.str(d, "basis", "Bagian yang diterima, dari"));

        double kredit = PayoutUi.num(t, "credit");
        double sellerNet = PayoutUi.num(t, "sellerNet");

        isi.addView(PayoutUi.kotak(this, "Ringkasan",
                "Kredit " + PayoutUi.rp(kredit)
                        + "\nSedekah " + PayoutUi.rp(PayoutUi.num(t, "sedekah"))
                        + "\nKomisi sub-seller " + PayoutUi.rp(PayoutUi.num(t, "subSeller")
                                + PayoutUi.num(t, "subSubSeller"))
                        + "\nBagian seller " + PayoutUi.rp(PayoutUi.num(t, "sellerGross"))
                        + "\n  bahan baku " + PayoutUi.rp(PayoutUi.num(t, "material"))
                        + "\n  seller bersih " + PayoutUi.rp(sellerNet)
                        + "\nRate efektif " + rate(sellerNet, kredit)));

        if (n != null) {
            isi.addView(PayoutUi.catatan(this,
                    n.optInt("mutations", 0) + " mutasi · " + n.optInt("batches", 0) + " batch · "
                            + n.optInt("shops", 0) + " toko · "
                            + n.optInt("subSellers", 0) + " sub-seller"));
        }
        if (d.optBoolean("truncated", false)) {
            isi.addView(PayoutUi.catatan(this,
                    "Sebagian data dipotong karena rentangnya terlalu panjang."));
        }

        rincian("Per Toko", d.optJSONArray("byShop"), "name", "marketplace");
        rincian("Per Sub-seller", d.optJSONArray("bySubSeller"), "name", null);
        rincian("Per Marketplace", d.optJSONArray("byMarketplace"), "marketplace", null);
        rincian("Per Bulan", d.optJSONArray("byMonth"), "month", null);
    }

    private void rincian(String judul, JSONArray rows, String kunciNama, String kunciKet) {
        if (rows == null || rows.length() == 0) return;
        isi.addView(PayoutUi.judul(this, judul));
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            double kredit = PayoutUi.num(r, "credit");
            double bersih = PayoutUi.num(r, "sellerNet");
            String ket = PayoutUi.rp(kredit) + " kredit";
            if (kunciKet != null) {
                ket = PayoutUi.str(r, kunciKet, "-") + " · " + ket;
            }
            String pemilik = PayoutUi.str(r, "owner", null);
            if (pemilik != null) ket = ket + " · " + pemilik;
            isi.addView(PayoutUi.baris(this,
                    PayoutUi.str(r, kunciNama, "-"), ket, PayoutUi.rp(bersih), null));
            isi.addView(PayoutUi.garis(this));
        }
        TextView k = new TextView(this);
        k.setText("Angka di kanan adalah bagian seller bersih.");
        k.setTextSize(11);
        k.setTextColor(Color.parseColor(PayoutUi.INK3));
        isi.addView(k);
    }

    /** Pembagi nol terjadi pada rentang tanpa pencairan sama sekali. */
    private static String rate(double bagian, double kredit) {
        if (kredit <= 0) return "-";
        return PayoutUi.persen(bagian / kredit);
    }
}
