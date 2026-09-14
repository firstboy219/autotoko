package id.autotoko.scanner;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Locale;

/**
 * Daftar Pesanan di APK — meniru pola BigSeller: tab status yang bisa digeser
 * + kartu pesanan (nomor, toko, harga, kurir, status). Data dari endpoint yang
 * sama dengan web ({@code /api/orders?active=1}), jadi APK dan web tak pernah
 * bercerita beda. Detail, cetak AWB, RTS, dan batch packing menyusul (fase
 * berikutnya) dan dibuka dari sini.
 */
public class OrdersActivity extends AppCompatActivity {

    // Alur status internal + labelnya (sama dengan web).
    private static final String[] FLOW = { "masuk", "approved", "produksi", "packing", "siap_kirim", "dikirim" };
    private static String label(String s) {
        switch (s == null ? "" : s) {
            case "masuk": return "Perlu disetujui";
            case "approved": return "Disetujui";
            case "produksi": return "Produksi";
            case "packing": return "Packing";
            case "siap_kirim": return "Siap Kirim";
            case "dikirim": return "Dikirim";
            case "selesai": return "Selesai";
            case "retur": return "Retur";
            case "dibatalkan": return "Dibatalkan";
            default: return s == null || s.isEmpty() ? "-" : s;
        }
    }

    private Api api;
    private LinearLayout tabs, list;
    private TextView status;
    private EditText search;
    private JSONArray all = new JSONArray();
    private String filter = "";      // "" = semua
    private String q = "";

    private float d;
    private int dp(int v) { return (int) (v * d); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Daftar Pesanan");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        d = getResources().getDisplayMetrics().density;

        LinearLayout rootCol = new LinearLayout(this);
        rootCol.setOrientation(LinearLayout.VERTICAL);
        rootCol.setBackgroundColor(getColor(R.color.canvas));

        // Pencarian
        search = new EditText(this);
        search.setHint("Cari nomor pesanan / pembeli…");
        search.setSingleLine(true);
        search.setTextSize(14);
        search.setBackground(pill(getColor(R.color.surface), getColor(R.color.line)));
        search.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.setMargins(dp(12), dp(12), dp(12), dp(8));
        search.setLayoutParams(sp);
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int c, int n) {}
            public void onTextChanged(CharSequence s, int a, int c, int n) {}
            public void afterTextChanged(Editable e) { q = e.toString().trim().toLowerCase(Locale.ROOT); render(); }
        });
        rootCol.addView(search);

        // Tab status (geser mendatar)
        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabs.setPadding(dp(8), 0, dp(8), dp(6));
        hs.addView(tabs);
        rootCol.addView(hs);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(getColor(R.color.ink2));
        status.setPadding(dp(16), dp(8), dp(16), dp(8));
        rootCol.addView(status);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(12), 0, dp(12), dp(16));
        ScrollView sv = new ScrollView(this);
        sv.addView(list);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        sv.setLayoutParams(lp);
        rootCol.addView(sv);

        setContentView(rootCol);
        muat();
    }

    @Override public boolean onSupportNavigateUp() { finish(); return true; }
    @Override protected void onResume() { super.onResume(); if (all.length() > 0) muat(); }

    private void muat() {
        status.setText("Memuat pesanan…");
        api.orders(true, r -> {
            if (r == null || !r.ok() || r.dataArray() == null) {
                status.setText(r == null ? "Gagal memuat." : r.message("Gagal memuat pesanan."));
                return;
            }
            all = r.dataArray();
            buildTabs();
            render();
        });
    }

    private void buildTabs() {
        tabs.removeAllViews();
        addTab("Semua", "");
        for (String s : FLOW) addTab(label(s), s);
    }

    private void addTab(String text, String value) {
        int n = 0;
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o == null) continue;
            if (value.isEmpty() || value.equals(o.optString("fulfillmentStatus"))) n++;
        }
        boolean active = filter.equals(value);
        TextView t = new TextView(this);
        t.setText(n > 0 ? text + " " + n : text);
        t.setTextSize(13);
        t.setTypeface(null, active ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        t.setTextColor(active ? getColor(R.color.on_brand) : getColor(R.color.ink2));
        t.setBackground(pill(active ? getColor(R.color.brand) : getColor(R.color.surface), getColor(R.color.line)));
        t.setPadding(dp(14), dp(8), dp(14), dp(8));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(dp(4), dp(4), dp(4), dp(4));
        t.setLayoutParams(p);
        t.setOnClickListener(v -> { filter = value; buildTabs(); render(); });
        tabs.addView(t);
    }

    private void render() {
        list.removeAllViews();
        int shown = 0;
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o == null) continue;
            if (!filter.isEmpty() && !filter.equals(o.optString("fulfillmentStatus"))) continue;
            if (!q.isEmpty()) {
                String hay = (o.optString("marketplaceOrderId") + " " + o.optString("buyerName")).toLowerCase(Locale.ROOT);
                if (!hay.contains(q)) continue;
            }
            list.addView(card(o));
            shown++;
        }
        status.setText(shown == 0 ? "Tidak ada pesanan." : shown + " pesanan");
    }

    private View card(JSONObject o) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackground(pill(getColor(R.color.surface), getColor(R.color.line)));
        c.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        c.setLayoutParams(lp);

        // Baris 1: nomor pesanan + toko
        LinearLayout r1 = new LinearLayout(this);
        r1.setOrientation(LinearLayout.HORIZONTAL);
        TextView no = new TextView(this);
        no.setText(o.optString("marketplaceOrderId", "-"));
        no.setTextSize(14);
        no.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
        no.setTextColor(getColor(R.color.ink));
        r1.addView(no, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView toko = new TextView(this);
        toko.setText(o.optString("shopName", ""));
        toko.setTextSize(12);
        toko.setTextColor(getColor(R.color.ink2));
        r1.addView(toko);
        c.addView(r1);

        // Baris 2: harga + badge status
        LinearLayout r2 = new LinearLayout(this);
        r2.setOrientation(LinearLayout.HORIZONTAL);
        r2.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams r2lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        r2lp.topMargin = dp(6);
        r2.setLayoutParams(r2lp);
        TextView harga = new TextView(this);
        String amt = o.isNull("totalAmount") ? null : o.optString("totalAmount", null);
        harga.setText(amt == null ? "—" : rupiah(amt));
        harga.setTextSize(15);
        harga.setTypeface(null, android.graphics.Typeface.BOLD);
        harga.setTextColor(getColor(R.color.ink));
        r2.addView(harga, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r2.addView(badge(o.optString("fulfillmentStatus")));
        c.addView(r2);

        // Baris 3: kurir + pembeli
        TextView r3 = new TextView(this);
        String kurir = o.optString("shippingCourier", "");
        String buyer = o.optString("buyerName", "");
        StringBuilder sb = new StringBuilder();
        if (!kurir.isEmpty()) sb.append(kurir);
        if (!buyer.isEmpty()) { if (sb.length() > 0) sb.append("  ·  "); sb.append(buyer); }
        r3.setText(sb.toString());
        r3.setTextSize(12);
        r3.setTextColor(getColor(R.color.ink3));
        LinearLayout.LayoutParams r3lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        r3lp.topMargin = dp(6);
        r3.setLayoutParams(r3lp);
        c.addView(r3);

        // Fase berikutnya: buka detail (status, cetak AWB, RTS).
        c.setOnClickListener(v ->
                android.widget.Toast.makeText(this, "Detail pesanan menyusul (fase berikutnya)", android.widget.Toast.LENGTH_SHORT).show());
        return c;
    }

    private TextView badge(String stat) {
        TextView t = new TextView(this);
        t.setText(label(stat));
        t.setTextSize(11);
        t.setPadding(dp(8), dp(3), dp(8), dp(3));
        int bg, fg;
        switch (stat == null ? "" : stat) {
            case "selesai": bg = getColor(R.color.ok_bg); fg = getColor(R.color.ok); break;
            case "dikirim": case "siap_kirim": bg = getColor(R.color.brand_tint); fg = getColor(R.color.brand_dark); break;
            case "dibatalkan": case "retur": bg = getColor(R.color.warn_bg); fg = getColor(R.color.warn); break;
            case "masuk": bg = getColor(R.color.attention_bg); fg = getColor(R.color.attention); break;
            default: bg = getColor(R.color.brand_tint); fg = getColor(R.color.brand_dark); break;
        }
        GradientDrawable g = new GradientDrawable();
        g.setColor(bg);
        g.setCornerRadius(dp(999));
        t.setBackground(g);
        t.setTextColor(fg);
        return t;
    }

    private GradientDrawable pill(int fill, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(14));
        g.setStroke(dp(1), stroke);
        return g;
    }

    private static String rupiah(String amt) {
        try {
            double v = Double.parseDouble(amt);
            return "Rp " + String.format(Locale.US, "%,d", Math.round(v)).replace(',', '.');
        } catch (Exception e) { return "Rp " + amt; }
    }
}
