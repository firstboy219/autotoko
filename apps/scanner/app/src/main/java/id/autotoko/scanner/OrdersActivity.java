package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
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
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

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

        c.setOnClickListener(v -> showDetail(o));
        return c;
    }

    private static String nextStatus(String s) {
        for (int i = 0; i < FLOW.length - 1; i++) if (FLOW[i].equals(s)) return FLOW[i + 1];
        return null;
    }

    private void toast(String m) { android.widget.Toast.makeText(this, m, android.widget.Toast.LENGTH_SHORT).show(); }

    /** Detail pesanan: info + item + aksi (ubah status, Cetak AWB, Kirim RTS). */
    private void showDetail(JSONObject o) {
        final String id = o.optString("id");
        final String stat = o.optString("fulfillmentStatus");
        BottomSheetDialog dlg = new BottomSheetDialog(this);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(18), dp(16), dp(18), dp(20));

        TextView no = new TextView(this);
        no.setText(o.optString("marketplaceOrderId", "-"));
        no.setTextSize(16);
        no.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
        no.setTextColor(getColor(R.color.ink));
        col.addView(no);

        col.addView(kv("Toko", o.optString("shopName", "-")));
        col.addView(kv("Pembeli", o.optString("buyerName", "-")));
        col.addView(kv("Kurir", o.optString("shippingCourier", "-")));
        String amt = o.isNull("totalAmount") ? null : o.optString("totalAmount", null);
        col.addView(kv("Total", amt == null ? "—" : rupiah(amt)));
        LinearLayout srow = new LinearLayout(this);
        srow.setOrientation(LinearLayout.HORIZONTAL);
        srow.setGravity(Gravity.CENTER_VERTICAL);
        srow.setPadding(0, dp(6), 0, dp(2));
        TextView sk = new TextView(this); sk.setText("Status"); sk.setTextSize(12); sk.setTextColor(getColor(R.color.ink2));
        srow.addView(sk, new LinearLayout.LayoutParams(dp(90), ViewGroup.LayoutParams.WRAP_CONTENT));
        srow.addView(badge(stat));
        col.addView(srow);

        // Item
        JSONArray items = o.optJSONArray("items");
        if (items != null && items.length() > 0) {
            TextView ih = new TextView(this); ih.setText("Item"); ih.setTextSize(12); ih.setTextColor(getColor(R.color.ink2));
            ih.setPadding(0, dp(10), 0, dp(2)); col.addView(ih);
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i); if (it == null) continue;
                TextView t = new TextView(this);
                t.setText(it.optInt("qty", 1) + " x " + it.optString("name", it.optString("skuName", "-")));
                t.setTextSize(13); t.setTextColor(getColor(R.color.ink));
                col.addView(t);
            }
        }

        // Aksi
        LinearLayout act = new LinearLayout(this);
        act.setOrientation(LinearLayout.VERTICAL);
        act.setPadding(0, dp(14), 0, 0);
        if ("masuk".equals(stat)) {
            act.addView(btn("Setujui", true, v -> { dlg.dismiss(); ubahStatus(id, "approved"); }));
            act.addView(btn("Tolak", false, v -> { dlg.dismiss(); ubahStatus(id, "dibatalkan"); }));
        } else {
            String nx = nextStatus(stat);
            if (nx != null) act.addView(btn("Lanjut ke " + label(nx), true, v -> { dlg.dismiss(); ubahStatus(id, nx); }));
        }
        act.addView(btn("Cetak AWB / Resi", false, v -> cetakAwb(id)));
        act.addView(btn("Kirim ke marketplace (RTS)", true, v -> konfirmRts(id, o.optString("marketplaceOrderId"), dlg)));
        col.addView(act);

        ScrollView sv = new ScrollView(this);
        sv.addView(col);
        dlg.setContentView(sv);
        dlg.show();
    }

    private LinearLayout kv(String k, String v) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(0, dp(4), 0, dp(4));
        TextView a = new TextView(this); a.setText(k); a.setTextSize(12); a.setTextColor(getColor(R.color.ink2));
        r.addView(a, new LinearLayout.LayoutParams(dp(90), ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView b = new TextView(this); b.setText(v); b.setTextSize(13); b.setTextColor(getColor(R.color.ink));
        r.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return r;
    }

    private MaterialButton btn(String text, boolean filled, View.OnClickListener cl) {
        MaterialButton b = new MaterialButton(this, null, filled
                ? com.google.android.material.R.attr.materialButtonStyle
                : com.google.android.material.R.attr.materialButtonOutlinedStyle);
        b.setText(text);
        b.setAllCaps(false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        b.setLayoutParams(lp);
        b.setOnClickListener(cl);
        return b;
    }

    private void ubahStatus(String id, String status) {
        api.orderUpdateStatus(id, status, r -> {
            toast(r != null && r.ok() ? "Status → " + label(status) : (r == null ? "Gagal" : r.message("Gagal ubah status")));
            muat();
        });
    }

    private void cetakAwb(String id) {
        toast("Mengambil label…");
        api.orderLabel(id, r -> {
            if (r == null || !r.ok() || r.data() == null) { toast(r == null ? "Gagal" : r.message("Gagal ambil label")); return; }
            JSONArray hasil = r.data().optJSONArray("hasil");
            String url = null;
            if (hasil != null) for (int i = 0; i < hasil.length(); i++) {
                JSONObject h = hasil.optJSONObject(i);
                if (h != null && !h.isNull("docUrl") && !h.optString("docUrl").isEmpty()) { url = h.optString("docUrl"); break; }
            }
            if (url == null) { toast("Label belum tersedia (order mungkin belum di-RTS)."); return; }
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch (Exception e) { toast("Tak bisa membuka label."); }
        });
    }

    private void konfirmRts(String id, String no, BottomSheetDialog parent) {
        new MaterialAlertDialogBuilder(this)
                .setTitle("Kirim ke marketplace (RTS)?")
                .setMessage("Order " + no + " akan di-RTS: status di seller center jadi menunggu kurir & AWB dibuat. Tindakan nyata dan sulit dibatalkan.")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Kirim", (di, w) -> {
                    if (parent != null) parent.dismiss();
                    toast("Mengirim…");
                    api.orderShip(id, "DROP_OFF", r -> {
                        boolean ok = r != null && r.ok() && r.data() != null && r.data().optBoolean("ok", false);
                        toast(ok ? "Dikirim (RTS) → Siap Kirim" : (r == null ? "Gagal" : r.message("Gagal RTS")));
                        muat();
                    });
                })
                .show();
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
