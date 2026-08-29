package id.autotoko.scanner;

import android.graphics.Color;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Semua pencairan yang pernah direkam, lintas batch.
 *
 * Layar batch menjawab "batch ini isinya apa"; yang ini menjawab "toko itu
 * kapan saja pernah cair, dan berapa". Dua pertanyaan berbeda, dan yang kedua
 * tidak bisa dijawab tanpa membuka batch satu per satu.
 */
public class PayoutMutationsActivity extends AppCompatActivity {

    private static final String[] FILTER = {null, "draft", "completed"};
    private static final String[] FILTER_LABEL = {"Semua", "Draft", "Selesai"};

    private Api api;
    private LinearLayout root, daftar;
    private TextView status, ringkas;
    private JSONArray shops;
    private int dipilih = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Mutasi Pencairan");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        int pad = (int) (16 * PayoutUi.d(this));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        LinearLayout tab = new LinearLayout(this);
        tab.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 0; i < FILTER.length; i++) {
            final int idx = i;
            MaterialButton t = new MaterialButton(this);
            t.setText(FILTER_LABEL[i]);
            t.setAllCaps(false);
            t.setTextSize(12);
            t.setOnClickListener(v -> {
                dipilih = idx;
                muat();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lp.rightMargin = (int) (4 * PayoutUi.d(this));
            t.setLayoutParams(lp);
            tab.addView(t);
        }
        root.addView(tab);

        status = new TextView(this);
        status.setTextSize(13);
        status.setText("Memuat…");
        root.addView(status);

        ringkas = new TextView(this);
        ringkas.setTextSize(13);
        ringkas.setTextColor(Color.parseColor(PayoutUi.INK));
        root.addView(ringkas);

        daftar = new LinearLayout(this);
        daftar.setOrientation(LinearLayout.VERTICAL);
        root.addView(daftar);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);

        // Nama toko diambil sekali; mutasi hanya membawa shopId.
        api.payoutShops(r -> {
            shops = r.dataArray();
            muat();
        });
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private void muat() {
        status.setText("Memuat " + FILTER_LABEL[dipilih].toLowerCase() + "…");
        daftar.removeAllViews();
        ringkas.setText("");
        api.payoutMutations(FILTER[dipilih], r -> {
            if (!r.ok() || r.dataArray() == null) {
                status.setText(r.message("Gagal memuat mutasi."));
                return;
            }
            gambar(r.dataArray());
        });
    }

    private void gambar(JSONArray rows) {
        daftar.removeAllViews();
        status.setText(rows.length() + " mutasi");

        double kredit = 0, sedekah = 0, seller = 0, bahan = 0, sub = 0;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject m = rows.optJSONObject(i);
            if (m == null) continue;
            kredit += PayoutUi.num(m, "creditAmount");
            sedekah += PayoutUi.num(m, "sedekahAmount");
            seller += PayoutUi.num(m, "sellerAmount");
            bahan += PayoutUi.num(m, "sellerMaterialAmount");
            sub += PayoutUi.num(m, "subSellerAmount") + PayoutUi.num(m, "subSubSellerAmount");

            String tgl = PayoutUi.str(m, "payoutDate", "-");
            String st = PayoutUi.str(m, "status", "-");
            daftar.addView(PayoutUi.baris(this,
                    namaToko(PayoutUi.str(m, "shopId", null)),
                    PayoutShare.tglPanjang(tgl) + " · " + ("draft".equals(st) ? "Draft" : "Selesai"),
                    PayoutUi.rp(PayoutUi.num(m, "creditAmount")), null));
            daftar.addView(PayoutUi.garis(this));
        }

        ringkas.setText("Kredit " + PayoutUi.rp(kredit)
                + "\nSedekah " + PayoutUi.rp(sedekah)
                + "\nSub-seller " + PayoutUi.rp(sub)
                + "\nSeller " + PayoutUi.rp(seller)
                + "\n  bahan baku " + PayoutUi.rp(bahan)
                + "\n  sisa seller " + PayoutUi.rp(seller - bahan));
    }

    private String namaToko(String id) {
        for (int i = 0; shops != null && i < shops.length(); i++) {
            JSONObject s = shops.optJSONObject(i);
            if (s == null || id == null) continue;
            if (id.equals(PayoutUi.str(s, "id", null))) {
                String n = PayoutUi.str(s, "displayName", null);
                if (n == null) n = PayoutUi.str(s, "shopName", null);
                if (n != null) return n;
            }
        }
        return id == null ? "(tanpa toko)" : id.substring(0, Math.min(8, id.length()));
    }
}
