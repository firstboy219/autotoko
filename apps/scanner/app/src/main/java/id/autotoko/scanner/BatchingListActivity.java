package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Halaman Batching List -- bukan popup.
 *
 * Dulu ini dialog: sekali ditutup, orang gudang bingung mencarinya lagi. Kini
 * layar sendiri yang bisa dibuka ulang dari menu "Daftar Batch", jadi status
 * batch dan tombol unduh tidak pernah jadi jalan buntu.
 *
 * Isi: status batch (diproses/selesai/gagal), ringkasan jumlah (total, berhasil,
 * gagal, ditahan), rincian per-order (nomor + berhasil/gagal + alasan), lalu
 * tombol Unduh Resi & Unduh Packing List. Selama masih diproses, layar
 * menyegarkan sendiri tiap 2 detik.
 */
public class BatchingListActivity extends AppCompatActivity {

    private Api api;
    private Session session;
    private String batchId;
    private float d;
    private boolean sudahHancur = false;
    private int polls = 0;
    private static final int MAX_POLLS = 150; // ~5 menit

    private final Handler main = new Handler(Looper.getMainLooper());
    private LinearLayout root;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        d = getResources().getDisplayMetrics().density;
        batchId = getIntent().getStringExtra("batchId");
        setTitle("Batching List");
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

        if (batchId == null || batchId.isEmpty()) {
            TextView t = new TextView(this);
            t.setText("Batch tidak diketahui.");
            t.setTextColor(getColor(R.color.ink2));
            root.addView(t);
            return;
        }
        muat();
    }

    @Override public boolean onSupportNavigateUp() { finish(); return true; }

    @Override protected void onDestroy() {
        super.onDestroy();
        sudahHancur = true;
        main.removeCallbacksAndMessages(null);
    }

    private void muat() {
        api.batchPackingStatus(batchId, r -> {
            if (sudahHancur) return;
            if (r == null || !r.ok() || r.data() == null) {
                render(null, r == null ? "Gagal memuat batch." : r.message("Gagal memuat batch"));
                return;
            }
            render(r.data(), null);
        });
    }

    private void render(JSONObject d0, String err) {
        if (sudahHancur) return;
        root.removeAllViews();

        if (err != null) {
            root.addView(judul("Batching List"));
            TextView e = new TextView(this);
            e.setText(err); e.setTextColor(getColor(R.color.attention));
            e.setPadding(0, dp(8), 0, dp(12)); root.addView(e);
            root.addView(tombol("Coba lagi", false, v -> muat()));
            return;
        }

        String st = d0.optString("status", "");
        String note = d0.optString("note", "");
        String createdAt = d0.optString("createdAt", "");
        JSONObject res = d0.optJSONObject("result");
        String errMsg = d0.isNull("errorMessage") ? "" : d0.optString("errorMessage", "");
        final String resiUrl = d0.isNull("resiPdfUrl") ? "" : d0.optString("resiPdfUrl", "");
        final String packUrl = d0.isNull("packingListPdfUrl") ? "" : d0.optString("packingListPdfUrl", "");

        root.addView(judul("Batching List"));

        LinearLayout kartu = new LinearLayout(this);
        kartu.setOrientation(LinearLayout.VERTICAL);
        kartu.setBackground(pill(getColor(R.color.surface), getColor(R.color.line)));
        kartu.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams klp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        klp.topMargin = dp(4); kartu.setLayoutParams(klp);

        kartu.addView(badge(st));
        if (!note.isEmpty() && !"null".equals(note)) {
            TextView tn = new TextView(this);
            tn.setText(note); tn.setTextSize(14); tn.setTextColor(getColor(R.color.ink));
            tn.setPadding(0, dp(8), 0, 0); kartu.addView(tn);
        }
        String waktu = formatWaktu(createdAt);
        if (!waktu.isEmpty()) {
            TextView tw = new TextView(this);
            tw.setText("Dibuat " + waktu); tw.setTextSize(12); tw.setTextColor(getColor(R.color.ink3));
            tw.setPadding(0, dp(4), 0, 0); kartu.addView(tw);
        }
        root.addView(kartu);

        if ("processing".equals(st)) {
            TextView pr = new TextView(this);
            pr.setText("Sedang membuat resi & packing list di server... (" + (polls + 1) + ")");
            pr.setTextSize(13); pr.setTextColor(getColor(R.color.ink2));
            pr.setPadding(0, dp(12), 0, 0); root.addView(pr);
            root.addView(tombol("Segarkan", false, v -> muat()));
            if (polls++ < MAX_POLLS) main.postDelayed(this::muat, 2000);
            else {
                TextView h = new TextView(this);
                h.setText("Masih diproses lama. Buka lagi nanti dari Daftar Batch.");
                h.setTextSize(12); h.setTextColor(getColor(R.color.ink3));
                h.setPadding(0, dp(8), 0, 0); root.addView(h);
            }
            return;
        }
        polls = 0;

        if ("error".equals(st)) {
            TextView e = new TextView(this);
            e.setText("Gagal memproses batch: " + (errMsg.isEmpty() ? "penyebab tidak diketahui" : errMsg));
            e.setTextColor(getColor(R.color.attention)); e.setPadding(0, dp(12), 0, dp(8));
            root.addView(e);
        }

        int total = res != null ? res.optInt("total", 0) : 0;
        int ok = res != null ? res.optInt("ok", 0) : 0;
        int ditahan = res != null ? res.optInt("ditahan", 0) : 0;
        int gagal = Math.max(0, total - ok);
        if (res != null) {
            LinearLayout stat = new LinearLayout(this);
            stat.setOrientation(LinearLayout.HORIZONTAL);
            stat.setPadding(0, dp(14), 0, dp(2));
            stat.addView(kotakAngka(String.valueOf(total), "Total"));
            stat.addView(kotakAngka(String.valueOf(ok), "Berhasil"));
            if (gagal > 0) stat.addView(kotakAngka(String.valueOf(gagal), "Gagal"));
            if (ditahan > 0) stat.addView(kotakAngka(String.valueOf(ditahan), "Ditahan"));
            root.addView(stat);
        }

        if (!resiUrl.isEmpty()) root.addView(tombol("Unduh Resi", true, v -> bukaUrl(session.baseUrl() + resiUrl)));
        if (!packUrl.isEmpty()) root.addView(tombol("Unduh Packing List", false, v -> bukaUrl(session.baseUrl() + packUrl)));
        if (resiUrl.isEmpty() && packUrl.isEmpty() && !"error".equals(st)) {
            TextView t = new TextView(this);
            t.setText("Tidak ada PDF dihasilkan (mungkin semua order gagal/ditahan).");
            t.setTextColor(getColor(R.color.ink3)); t.setTextSize(12);
            t.setPadding(0, dp(10), 0, 0); root.addView(t);
        }

        JSONArray hasil = res != null ? res.optJSONArray("hasil") : null;
        if (hasil != null && hasil.length() > 0) {
            TextView h = new TextView(this);
            h.setText("Rincian per order"); h.setTextSize(13); h.setTypeface(null, Typeface.BOLD);
            h.setTextColor(getColor(R.color.ink)); h.setPadding(0, dp(18), 0, dp(6));
            root.addView(h);
            for (int i = 0; i < hasil.length(); i++) {
                JSONObject o = hasil.optJSONObject(i); if (o == null) continue;
                root.addView(barisOrder(o));
            }
        }

        root.addView(tombol("Segarkan", false, v -> muat()));
    }

    private View barisOrder(JSONObject o) {
        boolean ok = o.optBoolean("ok", false);
        String no = o.isNull("orderNo") ? null : o.optString("orderNo", "");
        if (no == null || no.isEmpty()) no = o.optString("orderId", "-");
        String error = o.isNull("error") ? "" : o.optString("error", "");

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setBackground(pill(getColor(R.color.surface), getColor(R.color.line)));
        row.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8); row.setLayoutParams(lp);

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView t1 = new TextView(this);
        t1.setText(no); t1.setTextSize(14); t1.setTypeface(null, Typeface.BOLD);
        t1.setTextColor(getColor(R.color.ink));
        LinearLayout.LayoutParams t1lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        t1.setLayoutParams(t1lp);
        head.addView(t1);
        head.addView(chip(ok ? "Berhasil" : "Gagal", ok));
        row.addView(head);

        if (!ok && !error.isEmpty()) {
            TextView te = new TextView(this);
            te.setText(error); te.setTextSize(12); te.setTextColor(getColor(R.color.ink2));
            te.setPadding(0, dp(4), 0, 0); row.addView(te);
        }
        return row;
    }

    private TextView judul(String s) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextSize(20); t.setTypeface(null, Typeface.BOLD);
        t.setTextColor(getColor(R.color.ink)); t.setPadding(0, 0, 0, dp(10));
        return t;
    }

    private TextView badge(String status) {
        String label; int fg; int bg;
        switch (status) {
            case "done": label = "Selesai"; fg = getColor(R.color.ok); bg = getColor(R.color.ok_bg); break;
            case "processing": label = "Sedang diproses"; fg = getColor(R.color.warn); bg = getColor(R.color.warn_bg); break;
            case "error": label = "Gagal"; fg = getColor(R.color.attention); bg = getColor(R.color.attention_bg); break;
            case "cancelled": label = "Dibatalkan"; fg = getColor(R.color.ink3); bg = getColor(R.color.line); break;
            default: label = status.isEmpty() ? "-" : status; fg = getColor(R.color.ink2); bg = getColor(R.color.line); break;
        }
        TextView t = new TextView(this);
        t.setText(label); t.setTextSize(12); t.setTypeface(null, Typeface.BOLD); t.setTextColor(fg);
        GradientDrawable g = new GradientDrawable(); g.setColor(bg); g.setCornerRadius(dp(20));
        t.setBackground(g);
        t.setPadding(dp(12), dp(5), dp(12), dp(5));
        t.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return t;
    }

    private TextView chip(String s, boolean good) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextSize(11); t.setTypeface(null, Typeface.BOLD);
        t.setTextColor(good ? getColor(R.color.ok) : getColor(R.color.attention));
        GradientDrawable g = new GradientDrawable();
        g.setColor(good ? getColor(R.color.ok_bg) : getColor(R.color.attention_bg));
        g.setCornerRadius(dp(20)); t.setBackground(g);
        t.setPadding(dp(10), dp(3), dp(10), dp(3));
        return t;
    }

    private View kotakAngka(String angka, String label) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setGravity(Gravity.CENTER);
        c.setBackground(pill(getColor(R.color.surface), getColor(R.color.line)));
        c.setPadding(dp(10), dp(12), dp(10), dp(12));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.rightMargin = dp(8); c.setLayoutParams(lp);
        TextView a = new TextView(this);
        a.setText(angka); a.setTextSize(22); a.setTypeface(null, Typeface.BOLD);
        a.setTextColor(getColor(R.color.ink)); a.setGravity(Gravity.CENTER);
        TextView l = new TextView(this);
        l.setText(label); l.setTextSize(11); l.setTextColor(getColor(R.color.ink2)); l.setGravity(Gravity.CENTER);
        c.addView(a); c.addView(l);
        return c;
    }

    private MaterialButton tombol(String text, boolean filled, View.OnClickListener cl) {
        MaterialButton b = new MaterialButton(this, null, filled
                ? com.google.android.material.R.attr.materialButtonStyle
                : com.google.android.material.R.attr.materialButtonOutlinedStyle);
        b.setText(text); b.setAllCaps(false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10); b.setLayoutParams(lp);
        b.setOnClickListener(cl);
        return b;
    }

    private GradientDrawable pill(int fill, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill); g.setCornerRadius(dp(14)); g.setStroke(dp(1), stroke);
        return g;
    }

    private String formatWaktu(String iso) {
        if (iso == null || iso.isEmpty() || "null".equals(iso)) return "";
        String[] pola = { "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'",
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX" };
        for (String p : pola) {
            try {
                SimpleDateFormat in = new SimpleDateFormat(p, Locale.US);
                in.setTimeZone(TimeZone.getTimeZone("UTC"));
                Date dt = in.parse(iso);
                SimpleDateFormat out = new SimpleDateFormat("d MMM yyyy, HH:mm", new Locale("id"));
                out.setTimeZone(TimeZone.getDefault());
                return out.format(dt);
            } catch (Exception ignored) {}
        }
        return "";
    }

    private void bukaUrl(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (Exception e) { Toast.makeText(this, "Tidak bisa membuka PDF.", Toast.LENGTH_SHORT).show(); }
    }

    private int dp(int v) { return (int) (v * d); }
}
