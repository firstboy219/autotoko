package id.autotoko.scanner;

import android.graphics.Color;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Rantai kepemilikan tiap toko dan rate yang benar-benar berlaku untuknya.
 *
 * Hanya untuk dibaca; pengubahannya ada di layar Sub-seller & Toko. Skenario
 * A/B/C tidak disimpan di mana pun -- server menurunkannya per toko: ada
 * sub-sub-seller jadi C, ada sub-seller jadi B, tidak keduanya jadi A. Ia tetap
 * ditampilkan karena itu yang menentukan rate mana yang dipakai.
 */
public class PayoutMappingActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout root;
    private TextView status;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Pemetaan Toko");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        int pad = (int) (16 * PayoutUi.d(this));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        status = new TextView(this);
        status.setTextSize(13);
        status.setText("Memuat…");
        root.addView(status);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);

        api.payoutMapping(r -> {
            if (!r.ok() || r.dataArray() == null) {
                status.setText(r.message("Gagal memuat pemetaan."));
                return;
            }
            gambar(r.dataArray());
        });
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private void gambar(JSONArray rows) {
        root.removeAllViews();
        status.setText(rows.length() + " toko");
        root.addView(status);

        for (int i = 0; i < rows.length(); i++) {
            JSONObject m = rows.optJSONObject(i);
            if (m == null) continue;

            LinearLayout kartu = new LinearLayout(this);
            kartu.setOrientation(LinearLayout.VERTICAL);
            int p = (int) (12 * PayoutUi.d(this));
            kartu.setPadding(0, p, 0, p);

            TextView nama = new TextView(this);
            nama.setText(PayoutUi.str(m, "shopName", "(tanpa nama)"));
            nama.setTextSize(15);
            nama.setTextColor(Color.parseColor(PayoutUi.INK));
            nama.setTypeface(nama.getTypeface(), android.graphics.Typeface.BOLD);
            kartu.addView(nama);

            String sub = PayoutUi.str(m, "subSellerName", null);
            String sub2 = PayoutUi.str(m, "subSubSellerName", null);
            String rantai = sub == null
                    ? "Seller sendiri"
                    : (sub2 == null ? "Seller → " + sub : "Seller → " + sub + " → " + sub2);

            StringBuilder isi = new StringBuilder();
            isi.append("Marketplace: ").append(PayoutUi.str(m, "marketplace", "-")).append("\n");
            isi.append("Skenario: ").append(PayoutUi.str(m, "scenario", "-")).append("\n");
            isi.append("Rantai: ").append(rantai).append("\n");

            // Rate yang berlaku, bukan rate bawaan: toko bisa punya override
            // sendiri, dan angka yang ditampilkan harus yang benar-benar dipakai
            // saat menghitung.
            if (!m.isNull("effectiveSubSellerRate")) {
                isi.append("Rate sub-seller: ")
                   .append(PayoutUi.persen(PayoutUi.num(m, "effectiveSubSellerRate"))).append("\n");
            }
            if (!m.isNull("effectiveSubSubSellerRate")) {
                isi.append("Rate sub-sub-seller: ")
                   .append(PayoutUi.persen(PayoutUi.num(m, "effectiveSubSubSellerRate")))
                   .append("\n");
            }
            isi.append("Rekening aktif: ")
               .append(PayoutUi.str(m, "activeAccount", "(belum diisi)")).append("\n");
            isi.append("Ditambahkan oleh: ").append(PayoutUi.str(m, "addedByName", "-"));

            TextView t = new TextView(this);
            t.setText(isi.toString());
            t.setTextSize(12);
            t.setTextColor(Color.parseColor(PayoutUi.INK2));
            kartu.addView(t);

            root.addView(kartu);
            root.addView(PayoutUi.garis(this));
        }
    }
}
