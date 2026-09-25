package id.autotoko.scanner;

import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Cek Saldo — saldo bisa ditarik per toko TikTok, sama dengan kartu "Saldo
 * bisa ditarik" di halaman Pencairan Dana web (GET /marketplace-sync/saldo-tiktok).
 *
 * Dibuka dari data tersimpan (cepat, tanpa panggil TikTok); tombol "Perbarui
 * dari TikTok" menghitung ulang dari Finance API. Pengaturan cutoff saldo
 * tetap di web.
 */
public class SaldoActivity extends AppCompatActivity {

    private Api api;
    private float d;
    private LinearLayout root;
    private LinearLayout isi;
    private MaterialButton perbarui;

    private int dp(int v) { return (int) (v * d); }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        d = getResources().getDisplayMetrics().density;
        setTitle("Cek Saldo");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        ScrollView sc = new ScrollView(this);
        sc.setBackgroundColor(getColor(R.color.canvas));
        sc.setFillViewport(true);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = dp(16);
        root.setPadding(p, p, p, dp(24));
        sc.addView(root);
        setContentView(sc);

        if (!Access.boleh("pencairan")) {
            TextView t = new TextView(this);
            t.setText("Akun ini tidak punya akses ke menu Pencairan/Saldo.");
            t.setTextColor(getColor(R.color.ink2));
            root.addView(t);
            return;
        }

        TextView hint = new TextView(this);
        hint.setText("Saldo bisa ditarik per toko TikTok, dihitung dari riwayat penghasilan & penarikan (Finance API). Tekan \"Perbarui dari TikTok\" untuk angka terbaru.");
        hint.setTextSize(12);
        hint.setTextColor(getColor(R.color.ink2));
        root.addView(hint);

        perbarui = new MaterialButton(this);
        perbarui.setText("Perbarui dari TikTok");
        perbarui.setAllCaps(false);
        perbarui.setOnClickListener(v -> muat(true));
        root.addView(perbarui, lp(10));

        isi = new LinearLayout(this);
        isi.setOrientation(LinearLayout.VERTICAL);
        root.addView(isi, lp(8));

        muat(false);
    }

    private void muat(boolean live) {
        isi.removeAllViews();
        isi.addView(teks(live ? "Menghitung dari TikTok… (bisa beberapa detik)" : "Memuat…", 13, R.color.ink2, false));
        perbarui.setEnabled(false);
        api.saldoTiktok(live, r -> {
            perbarui.setEnabled(true);
            isi.removeAllViews();
            if (r == null || !r.ok() || r.data() == null) {
                isi.addView(teks(r == null ? "Gagal memuat saldo." : r.message("Gagal memuat saldo."), 13, R.color.ink2, false));
                return;
            }
            tampil(r.data());
        });
    }

    private void tampil(JSONObject data) {
        // Total semua toko
        LinearLayout tot = kartu("#E6F4EA");
        tot.addView(teks("Total saldo bisa ditarik (semua toko)", 12, R.color.ink2, false));
        TextView angka = teks(rp(data.optDouble("total", 0)), 24, R.color.ink, true);
        angka.setTextColor(Color.parseColor("#1B7F4B"));
        tot.addView(angka);
        String upd = data.isNull("diperbaruiPada") ? null : data.optString("diperbaruiPada", null);
        tot.addView(teks(upd == null ? "Belum pernah diperbarui — tekan \"Perbarui dari TikTok\"." : "Diperbarui " + jam(upd), 11, R.color.ink3, false));
        isi.addView(tot);

        JSONArray toko = data.optJSONArray("toko");
        if (toko == null || toko.length() == 0) {
            isi.addView(teks("Belum ada toko TikTok yang tersambung API.", 13, R.color.ink2, false));
            return;
        }
        for (int i = 0; i < toko.length(); i++) {
            JSONObject t = toko.optJSONObject(i);
            if (t == null) continue;
            LinearLayout k = kartu("#FFFFFF");
            k.addView(teks(t.optString("shopName", "Toko"), 14, R.color.ink, true));

            if (!t.isNull("error") && !t.optString("error", "").isEmpty()) {
                k.addView(teks("Gagal: " + t.optString("error"), 12, R.color.ink2, false));
            } else if (t.optBoolean("belumDicek", false)) {
                k.addView(teks("Belum dicek — tekan \"Perbarui dari TikTok\".", 12, R.color.ink2, false));
            } else if (t.isNull("saldo")) {
                TextView x = teks("Saldo belum bisa dihitung — ada transfer antar-toko; atur saldo cutoff di halaman Pencairan (web).", 12, R.color.ink2, false);
                x.setTextColor(Color.parseColor("#8A5A00"));
                k.addView(x);
            } else {
                TextView s = teks(rp(t.optDouble("saldo", 0)), 20, R.color.ink, true);
                s.setTextColor(Color.parseColor("#1B7F4B"));
                k.addView(s);
            }
            if (t.has("penghasilan")) k.addView(kv("Penghasilan (settle)", rp(t.optDouble("penghasilan", 0))));
            if (t.has("penarikan")) k.addView(kv("Sudah ditarik", rp(t.optDouble("penarikan", 0))));
            double proses = t.optDouble("penarikanDiproses", 0);
            if (proses > 0) k.addView(kv("Sedang diproses TikTok", rp(proses)));
            JSONObject cut = t.optJSONObject("cutoff");
            if (cut != null) k.addView(kv("Cutoff", cut.optString("tanggal", "-") + " · " + rp(cut.optDouble("saldo", 0))));
            String u = t.isNull("diperbaruiPada") ? null : t.optString("diperbaruiPada", null);
            if (u != null) k.addView(teks("Diperbarui " + jam(u), 11, R.color.ink3, false));
            isi.addView(k);
        }
    }

    // ---- helpers ----
    private LinearLayout kartu(String bg) {
        LinearLayout k = new LinearLayout(this);
        k.setOrientation(LinearLayout.VERTICAL);
        k.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor(bg));
        g.setCornerRadius(12 * d);
        g.setStroke(dp(1), Color.parseColor("#E5E7EB"));
        k.setBackground(g);
        k.setLayoutParams(lp(8));
        return k;
    }

    private TextView teks(String s, int size, int colorRes, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(getColor(colorRes));
        if (bold) t.setTypeface(null, Typeface.BOLD);
        return t;
    }

    private LinearLayout kv(String k, String v) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(0, dp(3), 0, dp(3));
        TextView a = teks(k, 12, R.color.ink2, false);
        r.addView(a, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView b = teks(v, 12, R.color.ink, false);
        r.addView(b);
        return r;
    }

    private LinearLayout.LayoutParams lp(int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(topDp);
        return p;
    }

    private static String rp(double v) {
        NumberFormat f = NumberFormat.getInstance(new Locale("id", "ID"));
        f.setMaximumFractionDigits(0);
        return "Rp" + f.format(Math.round(v));
    }

    /** ISO (UTC) → jam lokal Jakarta, "dd/MM HH:mm". */
    private static String jam(String iso) {
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date dt = in.parse(iso.length() >= 19 ? iso.substring(0, 19) : iso);
            SimpleDateFormat out = new SimpleDateFormat("dd/MM HH:mm", Locale.US);
            out.setTimeZone(TimeZone.getTimeZone("Asia/Jakarta"));
            return out.format(dt) + " WIB";
        } catch (Exception e) {
            return iso;
        }
    }
}
