package id.autotoko.scanner;

import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Promotion: daftar activity promo TikTok per toko (GET /promotion/activities).
 *
 * Hanya MEMBACA. Membuat/mengubah promo adalah aksi ke marketplace yang
 * dampaknya ke harga jual, jadi tetap dilakukan dari web yang menampilkan
 * produk & harganya lengkap.
 */
public class PromotionActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout list, tabs;
    private TextView status;
    private androidx.swiperefreshlayout.widget.SwipeRefreshLayout srl;
    private JSONArray data = new JSONArray();
    private String filter = "ONGOING";
    private float d;

    private static final String[][] FILTER = {
            {"ONGOING", "Berlangsung"}, {"NOT_START", "Akan datang"},
            {"EXPIRED", "Berakhir"}, {"", "Semua"},
    };

    private int dp(int v) { return (int) (v * d); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Promotion");
        d = getResources().getDisplayMetrics().density;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackgroundColor(getColor(R.color.canvas));

        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabs.setPadding(dp(8), dp(8), dp(8), 0);
        hs.addView(tabs);
        col.addView(hs);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(getColor(R.color.ink2));
        status.setPadding(dp(16), dp(8), dp(16), dp(4));
        col.addView(status);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(12), 0, dp(12), dp(16));
        ScrollView sv = new ScrollView(this);
        sv.addView(list);
        srl = new androidx.swiperefreshlayout.widget.SwipeRefreshLayout(this);
        srl.addView(sv, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        srl.setOnRefreshListener(this::muat);
        col.addView(srl, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(NavBawah.bungkus(this, col, NavBawah.PROMO));
        buatTab();
        muat();
    }

    private void buatTab() {
        tabs.removeAllViews();
        for (String[] f : FILTER) {
            boolean on = f[0].equals(filter);
            TextView t = new TextView(this);
            t.setText(f[1] + (data.length() > 0 ? " " + hitung(f[0]) : ""));
            t.setTextSize(13);
            t.setTypeface(null, on ? Typeface.BOLD : Typeface.NORMAL);
            t.setTextColor(on ? getColor(R.color.on_brand) : getColor(R.color.ink2));
            GradientDrawable g = new GradientDrawable();
            g.setColor(on ? getColor(R.color.brand) : getColor(R.color.surface));
            g.setStroke(Math.max(1, dp(1)), getColor(R.color.line));
            g.setCornerRadius(dp(18));
            t.setBackground(g);
            t.setPadding(dp(14), dp(8), dp(14), dp(8));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            p.setMargins(dp(4), 0, dp(4), 0);
            final String kode = f[0];
            t.setOnClickListener(v -> { filter = kode; buatTab(); gambar(); });
            tabs.addView(t, p);
        }
    }

    private int hitung(String st) {
        int n = 0;
        for (int i = 0; i < data.length(); i++) {
            JSONObject s = data.optJSONObject(i);
            JSONArray acts = s == null ? null : s.optJSONArray("activities");
            for (int k = 0; acts != null && k < acts.length(); k++) {
                JSONObject a = acts.optJSONObject(k);
                if (a != null && cocok(a, st)) n++;
            }
        }
        return n;
    }

    private static boolean cocok(JSONObject a, String st) {
        if (st.isEmpty()) return true;
        String s = a.optString("status", "").toUpperCase(Locale.ROOT);
        if ("EXPIRED".equals(st)) return s.equals("EXPIRED") || s.equals("DEACTIVATED") || s.equals("NOT_EFFECT");
        return s.equals(st);
    }

    private void muat() {
        status.setText("Memuat promo dari TikTok…");
        api.promoActivities(r -> {
            srl.setRefreshing(false);
            if (r == null || !r.ok() || r.dataArray() == null) {
                if (r != null && r.code == 403) status.setText("Promotion hanya untuk pemilik toko.");
                else status.setText(r == null ? "Gagal memuat." : r.message("Gagal memuat promo."));
                return;
            }
            data = r.dataArray();
            buatTab();
            gambar();
        });
    }

    private void gambar() {
        list.removeAllViews();
        int tampil = 0, gagal = 0;
        for (int i = 0; i < data.length(); i++) {
            JSONObject s = data.optJSONObject(i);
            if (s == null) continue;
            String toko = s.optString("shopName", "-");
            String err = s.isNull("error") ? "" : s.optString("error", "");
            if (!err.isEmpty()) {
                gagal++;
                list.addView(kartu(toko, "Gagal memuat: " + err, getColor(R.color.warn)));
                continue;
            }
            JSONArray acts = s.optJSONArray("activities");
            for (int k = 0; acts != null && k < acts.length(); k++) {
                JSONObject a = acts.optJSONObject(k);
                if (a == null || !cocok(a, filter)) continue;
                list.addView(kartuPromo(toko, a));
                tampil++;
            }
        }
        status.setText(tampil == 0 ? "Tidak ada promo di filter ini." : tampil + " promo"
                + (gagal > 0 ? " · " + gagal + " toko gagal dimuat" : "")
                + " · kelola/buat promo dari web");
    }

    private View kartuPromo(String toko, JSONObject a) {
        String st = a.optString("status", "");
        String periode = tgl(a.optLong("begin_time", 0)) + " – " + tgl(a.optLong("end_time", 0));
        String isi = toko + "\n" + jenis(a.optString("activity_type", "")) + " · " + periode;
        LinearLayout k = kartu(a.optString("title", "(tanpa judul)"), isi, 0);
        TextView chip = new TextView(this);
        chip.setText(labelStatus(st));
        chip.setTextSize(11);
        boolean jalan = "ONGOING".equalsIgnoreCase(st);
        chip.setTextColor(getColor(jalan ? R.color.ok : R.color.ink2));
        GradientDrawable g = new GradientDrawable();
        g.setColor(getColor(jalan ? R.color.ok_bg : R.color.canvas));
        g.setCornerRadius(dp(10));
        chip.setBackground(g);
        chip.setPadding(dp(8), dp(2), dp(8), dp(2));
        LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cl.topMargin = dp(6);
        k.addView(chip, cl);
        return k;
    }

    private static String labelStatus(String s) {
        switch (s.toUpperCase(Locale.ROOT)) {
            case "ONGOING": return "Berlangsung";
            case "NOT_START": return "Akan datang";
            case "EXPIRED": return "Berakhir";
            case "DEACTIVATED": return "Dinonaktifkan";
            case "NOT_EFFECT": return "Tidak berlaku";
            case "DRAFT": return "Draf";
            default: return s.isEmpty() ? "-" : s;
        }
    }

    private static String jenis(String t) {
        switch (t.toUpperCase(Locale.ROOT)) {
            case "FIXED_PRICE": return "Harga tetap";
            case "DIRECT_DISCOUNT": return "Diskon langsung";
            case "FLASHSALE": return "Flash sale";
            case "BUY_MORE_SAVE_MORE": return "Beli banyak lebih hemat";
            default: return t.isEmpty() ? "Promo" : t;
        }
    }

    private static String tgl(long detik) {
        if (detik <= 0) return "?";
        SimpleDateFormat f = new SimpleDateFormat("dd/MM/yy HH:mm", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Jakarta"));
        return f.format(new Date(detik * 1000L));
    }

    private LinearLayout kartu(String judul, String isi, int warnaIsi) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable g = new GradientDrawable();
        g.setColor(getColor(R.color.surface));
        g.setCornerRadius(dp(12));
        g.setStroke(Math.max(1, dp(1)), getColor(R.color.line));
        box.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        box.setLayoutParams(lp);
        TextView t = new TextView(this);
        t.setTextSize(14);
        t.setTypeface(null, Typeface.BOLD);
        t.setTextColor(getColor(R.color.ink));
        t.setText(judul);
        box.addView(t);
        TextView s = new TextView(this);
        s.setTextSize(12);
        s.setTextColor(warnaIsi != 0 ? warnaIsi : getColor(R.color.ink2));
        s.setPadding(0, dp(3), 0, 0);
        s.setText(isi);
        box.addView(s);
        return box;
    }
}
