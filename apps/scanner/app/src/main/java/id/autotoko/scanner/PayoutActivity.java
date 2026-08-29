package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Daftar batch pencairan, dan pintu untuk memulai yang baru.
 *
 * Alur dan aturannya sama persis dengan web karena memakai endpoint yang sama
 * -- yang dipindahkan ke sini layarnya, bukan logikanya. Penjagaan pencairan
 * ganda, bukti yang dipakai dua kali, dan batas transfer minimum semuanya
 * hidup di server dan tetap berlaku dari sini.
 */
public class PayoutActivity extends AppCompatActivity {

    private Api api;
    private Session session;
    private LinearLayout list;
    private TextView status;
    private MaterialButton newBatch;
    private boolean busy = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        setTitle("Pencairan Dana");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        newBatch = new MaterialButton(this);
        newBatch.setText("Mulai Batch Baru");
        newBatch.setAllCaps(false);
        newBatch.setOnClickListener(v -> mulaiBatch());
        root.addView(newBatch, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // Lima layar pendukung di balik satu tombol, bukan lima tombol
        // berjajar: semuanya jarang dibuka, dan yang sering dipakai di layar
        // ini cuma "mulai batch".
        MaterialButton lainnya = new MaterialButton(this);
        lainnya.setText("Pengaturan & Data Pencairan");
        lainnya.setAllCaps(false);
        lainnya.setOnClickListener(v -> menuLainnya());
        root.addView(lainnya, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // Beberapa batch boleh berjalan bersamaan, sama seperti di web:
        // pencairan tiap marketplace datang di hari berbeda dan tidak harus
        // saling menunggu. Yang direkam selalu masuk ke batch yang dibuka.
        TextView note = new TextView(this);
        note.setTextSize(11);
        note.setTextColor(Color.parseColor("#6B7178"));
        note.setPadding(0, (int) (8 * d), 0, (int) (12 * d));
        note.setText("Boleh ada beberapa batch berjalan sekaligus. Pencairan yang direkam "
                + "masuk ke batch yang sedang dibuka, jadi pastikan membuka batch yang benar.");
        root.addView(note);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(Color.parseColor("#6B7178"));
        root.addView(status);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);
    }

    @Override
    protected void onResume() {
        super.onResume();
        muat();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    /** Lima layar yang di web jadi lima halaman terpisah di menu Pencairan. */
    private void menuLainnya() {
        final String[] judul = {
            "Pengaturan Pencairan",
            "Sub-seller & Toko",
            "Pemetaan Toko",
            "Mutasi Pencairan",
            "Laba Pencairan",
        };
        final Class<?>[] layar = {
            PayoutSettingsActivity.class,
            PayoutPeopleActivity.class,
            PayoutMappingActivity.class,
            PayoutMutationsActivity.class,
            PayoutProfitActivity.class,
        };
        new MaterialAlertDialogBuilder(this)
                .setTitle("Pencairan Dana")
                .setItems(judul, (d, w) -> startActivity(new Intent(this, layar[w])))
                .setNegativeButton("Tutup", null)
                .show();
    }

    private void mulaiBatch() {
        if (busy) return;
        busy = true;
        newBatch.setEnabled(false);
        api.payoutNewBatch(r -> {
            busy = false;
            newBatch.setEnabled(true);
            if (!r.ok() || r.data() == null) {
                Toast.makeText(this, r.message("Gagal memulai batch."), Toast.LENGTH_LONG).show();
                return;
            }
            String id = r.data().optString("id", "");
            if (id.isEmpty()) { muat(); return; }
            buka(id, r.data().optString("code", ""));
        });
    }

    private void buka(String id, String kode) {
        Intent i = new Intent(this, PayoutBatchActivity.class);
        i.putExtra("batchId", id);
        i.putExtra("batchCode", kode);
        startActivity(i);
    }

    private void muat() {
        status.setText("Memuat…");
        list.removeAllViews();
        api.payoutBatches(r -> {
            JSONArray arr = r.dataArray();
            if (!r.ok() || arr == null) {
                status.setText(r.message("Gagal memuat daftar batch."));
                return;
            }
            if (arr.length() == 0) {
                status.setText("Belum ada batch. Mulai batch baru untuk mencatat pencairan tiap toko.");
                return;
            }
            status.setText(arr.length() + " batch");
            for (int i = 0; i < arr.length(); i++) {
                JSONObject b = arr.optJSONObject(i);
                if (b != null) list.addView(baris(b));
            }
        });
    }

    private View baris(JSONObject b) {
        float d = getResources().getDisplayMetrics().density;
        final String id = b.optString("id", "");
        final String kode = b.optString("code", "");
        final String st = b.optString("status", "");

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding((int) (12 * d), (int) (12 * d), (int) (12 * d), (int) (12 * d));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = (int) (8 * d);
        row.setLayoutParams(lp);
        row.setBackgroundColor(Color.parseColor("#F6F7F8"));

        // Langkah keberapa, disebut angka. "siap_distribusi" adalah nama
        // keadaan di basis data, bukan penjelasan bagi yang memakainya.
        TextView judul = new TextView(this);
        judul.setTextSize(15);
        judul.setTextColor(Color.parseColor("#20242B"));
        judul.setText(kode.isEmpty() ? id.substring(0, Math.min(8, id.length())) : "#" + kode);
        row.addView(judul);

        TextView sub = new TextView(this);
        sub.setTextSize(12);
        sub.setTextColor(Color.parseColor("#6B7178"));
        // Daftar batch tanpa kemajuan memaksa membuka satu per satu untuk tahu
        // mana yang tinggal sedikit lagi. Angkanya dibaca dari batch itu
        // sendiri, jadi baris ini tidak pernah bercerita lain dari halamannya.
        TextView maju = new TextView(this);
        maju.setTextSize(11);
        maju.setTextColor(Color.parseColor("#6B7178"));
        api.payoutBatch(id, rr -> {
            if (!rr.ok() || rr.data() == null) return;
            org.json.JSONObject dt = rr.data();
            org.json.JSONArray mut = dt.optJSONArray("mutations");
            org.json.JSONArray dis = dt.optJSONArray("disbursements");
            int nMut = mut == null ? 0 : mut.length();
            int nDis = dis == null ? 0 : dis.length();
            int beres = 0;
            for (int i = 0; i < nDis; i++) {
                org.json.JSONObject x = dis.optJSONObject(i);
                if (x == null) continue;
                String v = x.optString("validationStatus", "");
                if ("cocok_otomatis".equals(v) || "override_manual".equals(v)) beres++;
            }
            StringBuilder t = new StringBuilder();
            t.append(nMut).append(" toko direkam");
            if (nDis > 0) {
                int pct = Math.round(beres * 100f / nDis);
                t.append(" · transfer ").append(beres).append("/").append(nDis)
                        .append(" (").append(pct).append("%)");
            }
            maju.setText(t.toString());
        });
        // Tiga keadaan, bukan dua: batch yang dibuat sebelum fitur fee
        // menyala tidak punya fee sama sekali, dan itu bukan hal yang sama
        // dengan fee yang belum dibayar.
        String fee = b.isNull("adminFeeAmount")
                ? ""
                : (b.isNull("adminFeePaidAt") ? " · fee BELUM" : " · fee sudah");
        sub.setText(labelStatus(st) + fee + " · " + Format.clock(b.optString("createdAt", "")));
        row.addView(sub);
        row.addView(maju);

        row.setOnClickListener(v -> buka(id, kode));
        row.setOnLongClickListener(v -> {
            if ("selesai".equals(st)) {
                Toast.makeText(this, "Batch yang sudah ditutup tidak bisa dibatalkan.",
                        Toast.LENGTH_LONG).show();
                return true;
            }
            new MaterialAlertDialogBuilder(this)
                    .setTitle("Batalkan batch " + (kode.isEmpty() ? "" : "#" + kode) + "?")
                    .setMessage("Seluruh pencairan yang sudah direkam di batch ini ikut terhapus.")
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Batalkan", (dd, w) -> api.payoutDeleteBatch(id, rr -> {
                        Toast.makeText(this,
                                rr.ok() ? "Batch dibatalkan" : rr.message("Gagal membatalkan."),
                                Toast.LENGTH_LONG).show();
                        muat();
                    }))
                    .show();
            return true;
        });
        return row;
    }

    static String labelStatus(String s) {
        if ("berjalan".equals(s)) return "Langkah 1/3 — Rekam pencairan";
        if ("siap_distribusi".equals(s)) return "Langkah 2/3 — Transfer & bukti";
        if ("selesai".equals(s)) return "Langkah 3/3 — Selesai";
        return s;
    }

    /** 1, 2, atau 3 — dipakai penunjuk langkah di halaman batch. */
    static int stepIndex(String s) {
        if ("berjalan".equals(s)) return 1;
        if ("siap_distribusi".equals(s)) return 2;
        if ("selesai".equals(s)) return 3;
        return 0;
    }
}
