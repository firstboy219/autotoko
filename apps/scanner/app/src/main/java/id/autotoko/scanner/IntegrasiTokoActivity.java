package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
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
 * Integrasi Toko: toko marketplace yang terhubung + tombol menghubungkan toko
 * baru. Endpoint sama dengan halaman Toko di web (/api/shops*).
 *
 * Menghubungkan = OAuth di halaman marketplace, jadi dibuka di browser;
 * setelah seller menyetujui, marketplace mengembalikan ke web AutoToko dan
 * layar ini memuat ulang saat seller kembali ke aplikasi. Memutus koneksi
 * sengaja TIDAK ada di sini -- itu menghentikan sinkron order toko tsb, dan
 * tetap dilakukan dari web.
 */
public class IntegrasiTokoActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout list;
    private TextView status;
    private androidx.swiperefreshlayout.widget.SwipeRefreshLayout srl;
    private float d;

    private int dp(int v) { return (int) (v * d); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Integrasi Toko");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        d = getResources().getDisplayMetrics().density;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackgroundColor(getColor(R.color.canvas));

        LinearLayout tombol = new LinearLayout(this);
        tombol.setOrientation(LinearLayout.HORIZONTAL);
        tombol.setPadding(dp(12), dp(12), dp(12), 0);
        tombol.addView(tombolHubung("+ Hubungkan TikTok", "tiktok"),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        View jeda = new View(this);
        tombol.addView(jeda, new LinearLayout.LayoutParams(dp(8), 1));
        tombol.addView(tombolHubung("+ Hubungkan Shopee", "shopee"),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        col.addView(tombol);

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
        setContentView(col);
    }

    @Override public boolean onSupportNavigateUp() { finish(); return true; }

    // Dimuat di onResume: kembali dari browser OAuth = daftar langsung segar.
    @Override protected void onResume() { super.onResume(); muat(); }

    private MaterialButton tombolHubung(String teks, String mp) {
        MaterialButton b = new MaterialButton(this);
        b.setText(teks);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setOnClickListener(v -> hubungkan(mp, null));
        return b;
    }

    private void hubungkan(String mp, String placeholderId) {
        Toast.makeText(this, "Membuka halaman izin " + mp + "…", Toast.LENGTH_SHORT).show();
        api.shopConnectUrl(mp, placeholderId, r -> {
            String url = r != null && r.ok() && r.data() != null ? r.data().optString("authUrl", "") : "";
            if (url.isEmpty()) {
                Toast.makeText(this, r == null ? "Gagal." : r.message("Gagal membuat tautan koneksi."), Toast.LENGTH_LONG).show();
                return;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception e) {
                Toast.makeText(this, "Tidak ada browser untuk membuka tautan.", Toast.LENGTH_LONG).show();
            }
        });
    }

    private void muat() {
        status.setText("Memuat toko…");
        api.shops(r -> {
            srl.setRefreshing(false);
            if (r == null || !r.ok() || r.dataArray() == null) {
                status.setText(r == null ? "Gagal memuat." : r.message("Gagal memuat toko."));
                return;
            }
            gambar(r.dataArray());
        });
    }

    private void gambar(JSONArray shops) {
        list.removeAllViews();
        int aktif = 0;
        for (String mp : new String[]{"tiktok", "shopee", "tokopedia", "lazada", "manual"}) {
            boolean judulSudah = false;
            for (int i = 0; i < shops.length(); i++) {
                JSONObject s = shops.optJSONObject(i);
                if (s == null) continue;
                String m = s.optString("marketplace", "manual");
                boolean cocok = mp.equals(m) || ("manual".equals(mp)
                        && !m.equals("tiktok") && !m.equals("shopee") && !m.equals("tokopedia") && !m.equals("lazada"));
                if (!cocok) continue;
                if ("deleted".equals(s.optString("shopStatus"))) continue;
                if (!judulSudah) { list.addView(judul(namaMp(mp))); judulSudah = true; }
                if ("active".equals(s.optString("shopStatus")) && !s.isNull("connectedAt")) aktif++;
                list.addView(kartuToko(s));
            }
        }
        status.setText(shops.length() == 0 ? "Belum ada toko. Hubungkan toko pertama Anda."
                : aktif + " toko terhubung aktif · tarik ke bawah untuk muat ulang");
    }

    private View kartuToko(JSONObject s) {
        String nama = s.isNull("displayName") || s.optString("displayName").isEmpty()
                ? s.optString("shopName", "-") : s.optString("displayName");
        String st = s.optString("shopStatus", "");
        boolean placeholder = s.isNull("connectedAt");
        String label; int fg, bg;
        if (placeholder) { label = "Belum terhubung"; fg = R.color.attention; bg = R.color.attention_bg; }
        else if ("active".equals(st)) { label = "Terhubung"; fg = R.color.ok; bg = R.color.ok_bg; }
        else if ("expired".equals(st)) { label = "Token kedaluwarsa"; fg = R.color.warn; bg = R.color.warn_bg; }
        else if ("disconnected".equals(st)) { label = "Terputus"; fg = R.color.warn; bg = R.color.warn_bg; }
        else { label = st.isEmpty() ? "-" : st; fg = R.color.ink2; bg = R.color.canvas; }

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

        LinearLayout atas = new LinearLayout(this);
        atas.setOrientation(LinearLayout.HORIZONTAL);
        TextView t = new TextView(this);
        t.setTextSize(14);
        t.setTypeface(null, Typeface.BOLD);
        t.setTextColor(getColor(R.color.ink));
        t.setText(nama);
        atas.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView chip = new TextView(this);
        chip.setText(label);
        chip.setTextSize(11);
        chip.setTextColor(getColor(fg));
        GradientDrawable cg = new GradientDrawable();
        cg.setColor(getColor(bg));
        cg.setCornerRadius(dp(10));
        chip.setBackground(cg);
        chip.setPadding(dp(8), dp(2), dp(8), dp(2));
        atas.addView(chip);
        box.addView(atas);

        StringBuilder isi = new StringBuilder();
        if (!placeholder) {
            isi.append("Sinkron terakhir: ").append(waktu(s.optString("lastSyncAt", "")));
            if (s.optBoolean("autoRenew", false)) isi.append("\nToken diperpanjang otomatis");
            else isi.append("\nToken berlaku s/d ").append(waktu(s.optString("accessTokenExpireAt", "")));
        } else {
            isi.append("Toko dibuat manual, belum ditautkan ke akun marketplace.");
        }
        TextView sub = new TextView(this);
        sub.setTextSize(12);
        sub.setTextColor(getColor(R.color.ink2));
        sub.setPadding(0, dp(4), 0, 0);
        sub.setText(isi);
        box.addView(sub);

        final String id = s.optString("id", "");
        final String mp = s.optString("marketplace", "");
        if (placeholder && ("tiktok".equals(mp) || "shopee".equals(mp))) {
            MaterialButton b = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            b.setText("Selesaikan koneksi");
            b.setAllCaps(false);
            b.setOnClickListener(v -> hubungkan(mp, id));
            box.addView(b);
        } else if (!placeholder && !"active".equals(st) && ("tiktok".equals(mp) || "shopee".equals(mp))) {
            MaterialButton b = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            b.setText("Hubungkan ulang");
            b.setAllCaps(false);
            b.setOnClickListener(v -> hubungkan(mp, null));
            box.addView(b);
        } else if (!placeholder) {
            MaterialButton b = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            b.setText("Perbarui token");
            b.setAllCaps(false);
            b.setOnClickListener(v -> {
                b.setEnabled(false);
                api.shopRefresh(id, r -> {
                    b.setEnabled(true);
                    Toast.makeText(this, r != null && r.ok() ? "Token diperbarui."
                            : (r == null ? "Gagal." : r.message("Gagal memperbarui token.")), Toast.LENGTH_SHORT).show();
                    if (r != null && r.ok()) muat();
                });
            });
            box.addView(b);
        }
        return box;
    }

    private static String namaMp(String mp) {
        switch (mp) {
            case "tiktok": return "TikTok Shop";
            case "shopee": return "Shopee";
            case "tokopedia": return "Tokopedia";
            case "lazada": return "Lazada";
            default: return "Lainnya / manual";
        }
    }

    private static String waktu(String iso) {
        if (iso == null || iso.length() < 19 || "null".equals(iso)) return "-";
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date dt = in.parse(iso.substring(0, 19));
            SimpleDateFormat out = new SimpleDateFormat("dd/MM HH:mm", Locale.US);
            out.setTimeZone(TimeZone.getTimeZone("Asia/Jakarta"));
            return out.format(dt) + " WIB";
        } catch (Exception e) { return "-"; }
    }

    private TextView judul(String t) {
        TextView v = new TextView(this);
        v.setTextSize(15);
        v.setTypeface(null, Typeface.BOLD);
        v.setTextColor(getColor(R.color.ink));
        v.setPadding(dp(4), dp(16), 0, dp(4));
        v.setText(t);
        return v;
    }
}
