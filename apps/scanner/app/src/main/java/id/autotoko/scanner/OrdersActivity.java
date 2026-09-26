package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Daftar Pesanan di APK — meniru pola BigSeller: tab status yang bisa digeser
 * + kartu pesanan (nomor, toko, harga, kurir, status). Data dari endpoint yang
 * sama dengan web ({@code /api/orders?active=1}), jadi APK dan web tak pernah
 * bercerita beda. Detail, cetak AWB, RTS, dan batch packing menyusul (fase
 * berikutnya) dan dibuka dari sini.
 */
public class OrdersActivity extends AppCompatActivity {

    // Alur status internal + labelnya. Label ditarik dari backend
    // (GET /api/orders/status-meta) sebagai SUMBER TUNGGAL supaya tak lagi
    // disalin-tangan; switch di bawah hanya fallback bila meta belum termuat
    // (mis. offline / permintaan pertama). Jadi ubah label = cukup deploy
    // backend, tanpa rilis APK baru.
    private static final String[] FLOW = { "masuk", "approved", "packing", "siap_kirim", "dikirim" };
    private static final java.util.Map<String, String> LABEL_META = new java.util.HashMap<>();
    private static String label(String s) {
        String k = s == null ? "" : s;
        String m = LABEL_META.get(k);
        if (m != null && !m.isEmpty()) return m;
        switch (k) {
            case "masuk": return "Menunggu Disetujui";
            case "approved": return "Menunggu Dicetak";
            case "produksi": return "Produksi";
            case "packing": return "Menunggu Dipacking";
            case "siap_kirim": return "Menunggu Dipickup";
            case "dikirim": return "Dalam Pengiriman";
            case "selesai": return "Selesai";
            case "retur": return "Retur";
            case "dibatalkan": return "Dibatalkan";
            default: return k.isEmpty() ? "-" : k;
        }
    }

    private static String mpLabel(String s) {
        switch (s == null ? "" : s) {
            case "UNPAID": return "Belum Bayar";
            case "ON_HOLD": return "Ditahan";
            case "AWAITING_SHIPMENT": return "Menunggu Diproses";
            case "AWAITING_COLLECTION": return "Menunggu Pickup";
            case "PARTIALLY_SHIPPING": return "Sebagian Dikirim";
            case "IN_TRANSIT": return "Dalam Pengiriman";
            case "DELIVERED": return "Terkirim";
            case "COMPLETED": return "Selesai";
            case "CANCELLED": case "CANCELED": return "Dibatalkan";
            default: return s == null ? "" : s;
        }
    }

    private Api api;
    private LinearLayout tabs, list, stats;
    private String maxValueId = "";
    private TextView status;
    private EditText search;
    private JSONArray all = new JSONArray();
    private String filter = FLOW[0]; // tab pertama (tanpa "Semua")
    private java.util.List<String> flowList = new java.util.ArrayList<>(java.util.Arrays.asList(FLOW));
    private androidx.swiperefreshlayout.widget.SwipeRefreshLayout srl;
    private String q = "";
    private boolean autoBatch = false;

    private float d;
    private int packedToday = -1, cancelledToday = -1;
    private int dp(int v) { return (int) (v * d); }

    // --- Pemuat gambar ringan (tanpa Coil/Glide, keduanya belum ada di deps) ---
    // Cache di memori + kolam thread kecil; hasil diset ke ImageView di UI
    // thread. URL sama tidak diunduh dua kali; ImageView diberi tag agar bitmap
    // lama tidak "nyasar" ke sel yang sudah dipakai ulang saat scroll.
    private static final ExecutorService IMG_POOL = Executors.newFixedThreadPool(3);
    private static final LruCache<String, Bitmap> IMG_CACHE =
            new LruCache<String, Bitmap>(6 * 1024 * 1024) {
                @Override protected int sizeOf(String k, Bitmap b) { return b.getByteCount(); }
            };
    private final Handler ui = new Handler(Looper.getMainLooper());

    private void loadThumb(final String url, final ImageView iv) {
        if (url == null || url.isEmpty()) return;
        Bitmap cached = IMG_CACHE.get(url);
        if (cached != null) { pasangThumb(iv, cached); return; }
        final Object tag = new Object();
        iv.setTag(tag);
        IMG_POOL.execute(() -> {
            Bitmap bmp = null;
            try {
                HttpURLConnection cx = (HttpURLConnection) new URL(url).openConnection();
                cx.setConnectTimeout(8000);
                cx.setReadTimeout(8000);
                cx.setInstanceFollowRedirects(true);
                InputStream is = cx.getInputStream();
                BitmapFactory.Options op = new BitmapFactory.Options();
                op.inSampleSize = 2; // thumbnail: hemat memori, tak perlu resolusi penuh
                bmp = BitmapFactory.decodeStream(is, null, op);
                is.close();
                cx.disconnect();
            } catch (Exception ignore) { /* biarkan placeholder */ }
            final Bitmap out = bmp;
            if (out != null) IMG_CACHE.put(url, out);
            ui.post(() -> { if (out != null && iv.getTag() == tag) pasangThumb(iv, out); });
        });
    }

    private void pasangThumb(ImageView iv, Bitmap bmp) {
        iv.setPadding(0, 0, 0, 0);
        iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
        iv.clearColorFilter();
        iv.setImageBitmap(bmp);
    }

    /** ImageView thumbnail bulat-sudut + placeholder keranjang saat gambar belum ada. */
    private ImageView thumb(int sizeDp) {
        ImageView iv = new ImageView(this);
        int s = dp(sizeDp);
        iv.setLayoutParams(new LinearLayout.LayoutParams(s, s));
        iv.setBackground(pill(getColor(R.color.canvas), getColor(R.color.line)));
        iv.setClipToOutline(true);
        int pad = dp(sizeDp / 4);
        iv.setPadding(pad, pad, pad, pad);
        iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
        iv.setImageResource(android.R.drawable.ic_menu_gallery);
        iv.setColorFilter(getColor(R.color.ink3));
        return iv;
    }

    private static String firstItemName(JSONObject o) {
        JSONArray items = o.optJSONArray("items");
        if (items == null || items.length() == 0) return null;
        JSONObject it = items.optJSONObject(0);
        if (it == null) return null;
        String mn = it.isNull("masterName") ? "" : it.optString("masterName", "");
        String n = !mn.isEmpty() ? mn : it.optString("name", it.optString("skuName", it.optString("sellerSku", "")));
        return n == null || n.isEmpty() ? null : n;
    }

    private static int itemCount(JSONObject o) {
        JSONArray items = o.optJSONArray("items");
        return items == null ? 0 : items.length();
    }

    private static String firstThumbUrl(JSONObject o) {
        JSONArray items = o.optJSONArray("items");
        if (items == null) return null;
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            String u = it.optString("skuImage", "");
            if (!u.isEmpty()) return u;
        }
        return null;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        autoBatch = getIntent().getBooleanExtra("openBatch", false);
        setTitle("Daftar Pesanan");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        d = getResources().getDisplayMetrics().density;

        LinearLayout rootCol = new LinearLayout(this);
        rootCol.setOrientation(LinearLayout.VERTICAL);
        rootCol.setBackgroundColor(getColor(R.color.canvas));

        // Pencarian
        search = new EditText(this);
        search.setHint("Cari resi / nomor pesanan / pembeli…");
        search.setSingleLine(true);
        search.setTextSize(14);
        search.setBackground(pill(getColor(R.color.surface), getColor(R.color.line)));
        search.setPadding(dp(14), dp(12), dp(14), dp(12));
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int c, int n) {}
            public void onTextChanged(CharSequence s, int a, int c, int n) {}
            public void afterTextChanged(Editable e) { q = e.toString().trim().toLowerCase(Locale.ROOT); render(); }
        });
        // Baris pencarian + tombol Batch (Daftar Batch) di kanan, samping kolom cari.
        LinearLayout searchRow = new LinearLayout(this);
        searchRow.setOrientation(LinearLayout.HORIZONTAL);
        searchRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams srp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        srp.setMargins(dp(12), dp(12), dp(12), dp(8));
        searchRow.setLayoutParams(srp);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        searchRow.addView(search, slp);
        MaterialButton batchBtn = new MaterialButton(this, null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle);
        batchBtn.setText("Batch");
        batchBtn.setAllCaps(false);
        batchBtn.setTextSize(13);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        blp.setMargins(dp(8), 0, 0, 0);
        batchBtn.setLayoutParams(blp);
        batchBtn.setOnClickListener(v -> showBatches());
        searchRow.addView(batchBtn);
        rootCol.addView(searchRow);

        // Kartu ringkas (poin 2): kirim hari ini / urgent / aging terlama & terbaru.
        HorizontalScrollView statsWrap = new HorizontalScrollView(this);
        statsWrap.setHorizontalScrollBarEnabled(false);
        stats = new LinearLayout(this);
        stats.setOrientation(LinearLayout.HORIZONTAL);
        stats.setPadding(dp(12), 0, dp(12), dp(4));
        statsWrap.addView(stats);
        rootCol.addView(statsWrap);

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

        // Geser ke bawah = muat ulang; geser kiri/kanan = pindah tab. // tab Semua dihapus
        srl = new androidx.swiperefreshlayout.widget.SwipeRefreshLayout(this);
        srl.addView(sv, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        srl.setLayoutParams(lp);
        srl.setOnRefreshListener(this::muat);
        final android.view.GestureDetector gd = new android.view.GestureDetector(this,
                new android.view.GestureDetector.SimpleOnGestureListener() {
                    @Override public boolean onFling(android.view.MotionEvent e1, android.view.MotionEvent e2, float vx, float vy) {
                        if (e1 == null || e2 == null) return false;
                        float ddx = e2.getX() - e1.getX(), ddy = e2.getY() - e1.getY();
                        if (Math.abs(ddx) > Math.abs(ddy) * 1.5f && Math.abs(ddx) > dp(60) && Math.abs(vx) > 400) {
                            pindahTab(ddx < 0 ? 1 : -1);
                            return true;
                        }
                        return false;
                    }
                });
        sv.setOnTouchListener((v, ev) -> { gd.onTouchEvent(ev); return false; });
        rootCol.addView(srl);

        setContentView(NavBawah.bungkus(this, rootCol, NavBawah.PESANAN));
        muat();
    }

    @Override public boolean onSupportNavigateUp() { finish(); return true; }
    @Override protected void onResume() { super.onResume(); if (all.length() > 0) muat(); }

    @Override public boolean onCreateOptionsMenu(Menu m) {
        m.add(0, 1, 0, "Batch Packing").setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        m.add(0, 2, 1, "Otomasi Order").setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        m.add(0, 3, 2, "Daftar Batch").setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        m.add(0, 4, 3, "Cek Resi / Pembatalan").setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        return true;
    }
    @Override public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 1) { showBatch(); return true; }
        if (item.getItemId() == 2) { showOtomasi(); return true; }
        if (item.getItemId() == 3) { showBatches(); return true; }
        if (item.getItemId() == 4) { startActivity(new Intent(this, CekResiActivity.class)); return true; }
        return super.onOptionsItemSelected(item);
    }

    private void muat() {
        status.setText("Memuat pesanan…");
        // Tarik label status dari sumber tunggal backend (fallback ke switch lokal).
        api.orderStatusMeta(mr -> {
            if (mr == null || !mr.ok() || mr.data() == null) return;
            org.json.JSONObject lbl = mr.data().optJSONObject("label");
            if (lbl == null) return;
            java.util.Iterator<String> it = lbl.keys();
            while (it.hasNext()) { String k = it.next(); LABEL_META.put(k, lbl.optString(k, "")); }
            // urutan tahap dari server (status-meta.flow) -> tab mengikuti config admin.
            org.json.JSONArray fl = mr.data().optJSONArray("flow");
            if (fl != null && fl.length() > 0) {
                java.util.List<String> nf = new java.util.ArrayList<>();
                for (int i = 0; i < fl.length(); i++) { String s = fl.optString(i, ""); if (!s.isEmpty()) nf.add(s); }
                if (!nf.isEmpty()) { flowList = nf; if (!flowList.contains(filter)) filter = flowList.get(0); }
            }
            if (all.length() > 0) { buildTabs(); render(); }
        });
        // Ringkasan hari ini (resi discan packing & order batal) dari data marketplace.
        api.orderBoardSummary(br -> {
            if (br != null && br.ok() && br.data() != null) {
                packedToday = br.data().optInt("packedToday", 0);
                cancelledToday = br.data().optInt("cancelledToday", 0);
                renderStats();
            }
        });
        api.orders(true, r -> {
            if (srl != null) srl.setRefreshing(false);
            if (r == null || !r.ok() || r.dataArray() == null) {
                status.setText(r == null ? "Gagal memuat." : r.message("Gagal memuat pesanan."));
                return;
            }
            all = r.dataArray();
            maxValueId = hitungMaxValue();
            buildTabs();
            render();
            renderStats();
            if (autoBatch) { autoBatch = false; showBatch(); }
        });
    }

    private void pindahTab(int dir) {
        int idx = 0;
        for (int i = 0; i < flowList.size(); i++) if (flowList.get(i).equals(filter)) { idx = i; break; }
        int ni = idx + dir;
        if (ni < 0 || ni >= flowList.size()) return;
        filter = flowList.get(ni);
        buildTabs();
        render();
    }

    private void buildTabs() {
        tabs.removeAllViews();
        for (String s : flowList) addTab(label(s), s);
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
                String hay = (o.optString("marketplaceOrderId") + " " + o.optString("buyerName") + " " + o.optString("trackingNumber")).toLowerCase(Locale.ROOT);
                if (!hay.contains(q)) continue;
            }
            list.addView(card(o));
            shown++;
        }
        status.setText(shown == 0 ? "Tidak ada pesanan." : shown + " pesanan");
    }

    // ---- Turunan untuk kartu ringkas & chip (poin 2/3) ----
    private static long timeMs(String iso) {
        // Backend selalu ISO UTC (…Z). Ambil 19 char pertama & parse sbg UTC —
        // hindari java.time (butuh API 26) demi minSdk 21.
        if (iso == null || iso.length() < 19) return 0L;
        try {
            java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
            f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return f.parse(iso.substring(0, 19)).getTime();
        } catch (Exception e) { return 0L; }
    }
    private static String agingFromMs(long age) {
        long h = age / 3600000L;
        if (h < 1) return "baru";
        if (h < 24) return h + " jam";
        return (h / 24) + " hari";
    }
    private static String aging(long createdMs) {
        if (createdMs <= 0) return "";
        long age = System.currentTimeMillis() - createdMs;
        if (age < 0) return "";
        return agingFromMs(age);
    }
    private static long startTodayJak() {
        long JAK = 7L * 3600000L;
        long day = (System.currentTimeMillis() + JAK) / 86400000L;
        return day * 86400000L - JAK;
    }
    private static boolean aktifOrder(JSONObject o) {
        String st = o.optString("fulfillmentStatus");
        return !st.equals("dikirim") && !st.equals("selesai") && !st.equals("dibatalkan");
    }
    private static long createdMsOf(JSONObject o) {
        return timeMs(o.optString("createdAtMarketplace", o.optString("createdAt", "")));
    }
    private String hitungMaxValue() {
        double maxv = -1; String id = "";
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i); if (o == null) continue;
            if (o.isNull("totalAmount") || !aktifOrder(o)) continue;
            double v = o.optDouble("totalAmount", -1);
            if (v > maxv) { maxv = v; id = o.optString("id"); }
        }
        return id;
    }

    private TextView chip(String text, int bg, int fg) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(11);
        t.setTextColor(fg);
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setColor(bg);
        g.setCornerRadius(dp(10));
        t.setBackground(g);
        t.setPadding(dp(8), dp(3), dp(8), dp(3));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(6);
        t.setLayoutParams(lp);
        return t;
    }

    private View statCard(String title, String val, String color, final Runnable onClick) {
        LinearLayout b = new LinearLayout(this);
        b.setOrientation(LinearLayout.VERTICAL);
        b.setBackground(pill(getColor(R.color.surface), getColor(R.color.line)));
        b.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(124), ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(8);
        b.setLayoutParams(lp);
        TextView v = new TextView(this);
        v.setText(val); v.setTextSize(20);
        v.setTypeface(null, android.graphics.Typeface.BOLD);
        v.setTextColor(android.graphics.Color.parseColor(color));
        TextView t = new TextView(this);
        t.setText(title); t.setTextSize(11); t.setTextColor(getColor(R.color.ink2));
        b.addView(v); b.addView(t);
        b.setOnClickListener(x -> onClick.run());
        return b;
    }

    private void renderStats() {
        if (stats == null) return;
        stats.removeAllViews();
        long now = System.currentTimeMillis();
        long endToday = startTodayJak() + 86400000L;
        int shipToday = 0, urgent = 0; long oldest = 0, newest = 0; boolean any = false;
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i); if (o == null || !aktifOrder(o)) continue;
            long dl = o.optLong("shipDeadlineMs", 0);
            if (dl > 0 && dl < endToday) shipToday++;
            if (dl > 0 && dl < now + 3L * 3600000L) urgent++;
            long cm = createdMsOf(o);
            if (cm > 0) { long age = now - cm; if (!any) { oldest = age; newest = age; any = true; } else { oldest = Math.max(oldest, age); newest = Math.min(newest, age); } }
        }
        stats.addView(statCard("Kirim hari ini", String.valueOf(shipToday), "#256FB0", () -> showStatList("kirim_hari_ini")));
        stats.addView(statCard("Urgent (≤3 jam/lewat)", String.valueOf(urgent), "#B3261E", () -> showStatList("urgent")));
        stats.addView(statCard("Order terlama", any ? agingFromMs(oldest) : "–", "#B36A00", () -> showStatList("terlama")));
        stats.addView(statCard("Order terbaru", any ? agingFromMs(newest) : "–", "#1B7F4B", () -> showStatList("terbaru")));
        stats.addView(statCard("Discan packing hari ini", packedToday < 0 ? "…" : String.valueOf(packedToday), "#0E6E55", () -> {}));
        stats.addView(statCard("Batal hari ini", cancelledToday < 0 ? "…" : String.valueOf(cancelledToday), "#B3261E", () -> {}));
    }

    private String judulStat(String kind) {
        switch (kind) {
            case "kirim_hari_ini": return "Harus dikirim hari ini";
            case "urgent": return "Urgent — lewat/≤3 jam lagi";
            case "terlama": return "Order terlama (aktif)";
            default: return "Order terbaru (aktif)";
        }
    }

    private void showStatList(final String kind) {
        long now = System.currentTimeMillis();
        long endToday = startTodayJak() + 86400000L;
        final java.util.ArrayList<JSONObject> sel = new java.util.ArrayList<>();
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i); if (o == null || !aktifOrder(o)) continue;
            long dl = o.optLong("shipDeadlineMs", 0);
            boolean ok;
            if (kind.equals("kirim_hari_ini")) ok = dl > 0 && dl < endToday;
            else if (kind.equals("urgent")) ok = dl > 0 && dl < now + 3L * 3600000L;
            else ok = createdMsOf(o) > 0;
            if (ok) sel.add(o);
        }
        if (kind.equals("terlama")) java.util.Collections.sort(sel, (a, b) -> Long.compare(createdMsOf(a), createdMsOf(b)));
        else if (kind.equals("terbaru")) java.util.Collections.sort(sel, (a, b) -> Long.compare(createdMsOf(b), createdMsOf(a)));
        else java.util.Collections.sort(sel, (a, b) -> Long.compare(a.optLong("shipDeadlineMs", Long.MAX_VALUE), b.optLong("shipDeadlineMs", Long.MAX_VALUE)));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16); box.setPadding(pad, pad, pad, pad);
        if (sel.isEmpty()) {
            TextView e = new TextView(this); e.setText("Tidak ada order pada kategori ini."); e.setTextColor(getColor(R.color.ink3));
            box.addView(e);
        }
        for (final JSONObject o : sel) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(0, dp(6), 0, dp(6));
            TextView t1 = new TextView(this);
            t1.setText(o.optString("marketplaceOrderId", "-"));
            t1.setTextSize(13); t1.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
            t1.setTextColor(getColor(R.color.ink));
            TextView t2 = new TextView(this);
            String amt = o.isNull("totalAmount") ? "—" : rupiah(o.optString("totalAmount", ""));
            t2.setText(o.optString("shippingCourier", "") + "  ·  " + amt + "  ·  umur " + aging(createdMsOf(o))
                    + (o.optBoolean("isCod", false) ? "  ·  COD" : ""));
            t2.setTextSize(12); t2.setTextColor(getColor(R.color.ink2));
            row.addView(t1); row.addView(t2);
            String resi = o.optString("trackingNumber", "");
            if (!resi.isEmpty()) {
                TextView t3 = new TextView(this);
                t3.setText("Resi: " + resi);
                t3.setTextSize(12);
                t3.setTypeface(android.graphics.Typeface.MONOSPACE);
                t3.setTextColor(getColor(R.color.ink2));
                row.addView(t3);
            }
            row.setOnClickListener(v -> showDetail(o));
            box.addView(row);
        }
        ScrollView sc = new ScrollView(this); sc.addView(box);
        new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle(judulStat(kind) + " (" + sel.size() + ")")
                .setView(sc).setPositiveButton("Tutup", null).show();
    }

    // ---- Daftar & Edit Batch (poin 1) ----
    private void showBatches() {
        toast("Memuat batch\u2026");
        api.batches(r -> {
            if (r == null || !r.ok() || r.dataArray() == null) { toast(r == null ? "Gagal" : r.message("Gagal memuat batch")); return; }
            JSONArray arr = r.dataArray();
            LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL);
            int pad = dp(16); box.setPadding(pad, pad, pad, pad);
            TextView hint = new TextView(this); hint.setText("Ketuk batch untuk lihat status & unduh PDF. Tekan lama untuk kelola anggota."); hint.setTextSize(12); hint.setTextColor(getColor(R.color.ink3)); box.addView(hint);
            if (arr.length() == 0) {
                TextView e = new TextView(this); e.setText("Belum ada batch. Buat lewat menu Batch Packing."); e.setTextColor(getColor(R.color.ink3));
                box.addView(e);
            }
            for (int i = 0; i < arr.length(); i++) {
                JSONObject b = arr.optJSONObject(i); if (b == null) continue;
                final String id = b.optString("id");
                LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.VERTICAL);
                row.setBackground(pill(getColor(R.color.surface), getColor(R.color.line)));
                row.setPadding(dp(12), dp(10), dp(12), dp(10));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                lp.topMargin = dp(8); row.setLayoutParams(lp);
                TextView t1 = new TextView(this); t1.setText(b.optString("note", "(tanpa catatan)")); t1.setTextSize(14);
                t1.setTypeface(null, android.graphics.Typeface.BOLD); t1.setTextColor(getColor(R.color.ink));
                TextView t2 = new TextView(this); t2.setText(b.optInt("orderCount", 0) + " order  \u00b7  " + b.optString("status", "")); t2.setTextSize(12); t2.setTextColor(getColor(R.color.ink2));
                row.addView(t1); row.addView(t2);
                row.setOnClickListener(v -> startActivity(new Intent(this, BatchingListActivity.class).putExtra("batchId", id)));
                row.setOnLongClickListener(v -> { showBatchDetail(id); return true; });
                box.addView(row);
            }
            ScrollView sc = new ScrollView(this); sc.addView(box);
            new androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Daftar Batch").setView(sc).setPositiveButton("Tutup", null).show();
        });
    }

    private void showBatchDetail(final String id) {
        api.batchDetail(id, r -> {
            if (r == null || !r.ok() || r.data() == null) { toast(r == null ? "Gagal" : r.message("Gagal memuat batch")); return; }
            JSONObject b = r.data();
            JSONArray ord = b.optJSONArray("orders");
            LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL);
            int pad = dp(16); box.setPadding(pad, pad, pad, pad);
            TextView lbl = new TextView(this); lbl.setText("Catatan batch"); lbl.setTextSize(12); lbl.setTextColor(getColor(R.color.ink2));
            final EditText note = new EditText(this); note.setText(b.optString("note", "")); note.setTextSize(14); note.setSingleLine(true);
            box.addView(lbl); box.addView(note);
            TextView h = new TextView(this); h.setText("\nAnggota (centang = lepas dari batch):"); h.setTextSize(12); h.setTextColor(getColor(R.color.ink2)); box.addView(h);
            final java.util.LinkedHashMap<String, CheckBox> cbs = new java.util.LinkedHashMap<>();
            if (ord != null) for (int i = 0; i < ord.length(); i++) {
                JSONObject o = ord.optJSONObject(i); if (o == null) continue;
                final String oid = o.optString("id");
                CheckBox cb = new CheckBox(this);
                cb.setText(o.optString("marketplaceOrderId", "-") + "  \u00b7  " + o.optString("shippingCourier", "") + "  \u00b7  " + label(o.optString("fulfillmentStatus")));
                cb.setTextSize(13);
                cbs.put(oid, cb); box.addView(cb);
            }
            ScrollView sc = new ScrollView(this); sc.addView(box);
            new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Edit Batch")
                .setView(sc)
                .setPositiveButton("Simpan", (d, w) -> {
                    JSONArray rem = new JSONArray();
                    for (Map.Entry<String, CheckBox> e : cbs.entrySet()) if (e.getValue().isChecked()) rem.put(e.getKey());
                    JSONObject body = new JSONObject();
                    try { body.put("note", note.getText().toString().trim()); body.put("removeOrderIds", rem); } catch (Exception ig) {}
                    api.batchEdit(id, body, rr -> {
                        if (rr == null || !rr.ok()) { toast(rr == null ? "Gagal" : rr.message("Gagal simpan")); return; }
                        toast("Batch diperbarui."); muat();
                    });
                })
                .setNeutralButton("Batalkan batch", (d, w) -> konfirmCancelBatch(id))
                .setNegativeButton("Tutup", null)
                .show();
        });
    }

    private void konfirmCancelBatch(final String id) {
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Batalkan batch?")
            .setMessage("Semua order dilepas dari batch & batch ditandai dibatalkan. TIDAK menarik balik RTS yang sudah terjadi di marketplace.")
            .setPositiveButton("Ya, batalkan", (d, w) -> api.batchCancel(id, r -> {
                if (r == null || !r.ok()) { toast(r == null ? "Gagal" : r.message("Gagal batalkan")); return; }
                toast("Batch dibatalkan."); muat();
            }))
            .setNegativeButton("Batal", null)
            .show();
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

        // Kepala: thumbnail produk + kolom teks. Gambar produk membuat pesanan
        // langsung dikenali, seperti BigSeller tapi lebih rapi.
        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        ImageView tv = thumb(48);
        LinearLayout.LayoutParams tvlp = (LinearLayout.LayoutParams) tv.getLayoutParams();
        tvlp.rightMargin = dp(12);
        tvlp.topMargin = dp(2);
        tv.setLayoutParams(tvlp);
        loadThumb(firstThumbUrl(o), tv);
        head.addView(tv);

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        head.addView(body, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // Nama produk sebagai judul (varian pertama + "+N lainnya" bila banyak).
        String pn = firstItemName(o);
        if (pn != null) {
            int extra = itemCount(o) - 1;
            TextView pname = new TextView(this);
            pname.setText(extra > 0 ? pn + "  +" + extra + " lainnya" : pn);
            pname.setTextSize(13);
            pname.setTypeface(null, android.graphics.Typeface.BOLD);
            pname.setTextColor(getColor(R.color.ink));
            pname.setMaxLines(2);
            pname.setEllipsize(android.text.TextUtils.TruncateAt.END);
            body.addView(pname);
        }

        // Baris 1: nomor pesanan + toko
        LinearLayout r1 = new LinearLayout(this);
        r1.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams r1lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        if (pn != null) r1lp.topMargin = dp(2);
        r1.setLayoutParams(r1lp);
        TextView no = new TextView(this);
        no.setText(o.optString("marketplaceOrderId", "-"));
        no.setTextSize(pn != null ? 12 : 14);
        no.setTypeface(android.graphics.Typeface.MONOSPACE,
                pn != null ? android.graphics.Typeface.NORMAL : android.graphics.Typeface.BOLD);
        no.setTextColor(getColor(pn != null ? R.color.ink2 : R.color.ink));
        r1.addView(no, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView toko = new TextView(this);
        toko.setText(o.optString("shopName", ""));
        toko.setTextSize(12);
        toko.setTextColor(getColor(R.color.ink2));
        r1.addView(toko);
        body.addView(r1);

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
        body.addView(r2);

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
        body.addView(r3);

        // Chip info per order (poin 3.1 prioritas / 3.4 COD / 3.5 aging / 4 status scan).
        LinearLayout chips = new LinearLayout(this);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        long dl = o.optLong("shipDeadlineMs", 0);
        long now = System.currentTimeMillis();
        long endToday = startTodayJak() + 86400000L;
        if (dl > 0 && dl < now) chips.addView(chip("⚠ lewat tenggat", android.graphics.Color.parseColor("#FDE7E7"), android.graphics.Color.parseColor("#B3261E")));
        else if (dl > 0 && dl < endToday) chips.addView(chip("kirim duluan", android.graphics.Color.parseColor("#FFF3E0"), android.graphics.Color.parseColor("#B36A00")));
        if (o.optBoolean("isCod", false)) chips.addView(chip("COD", android.graphics.Color.parseColor("#FFF3E0"), android.graphics.Color.parseColor("#8A5A00")));
        // umur order (dari create-date marketplace) di-HIGHLIGHT: warna makin
        // pekat makin tua (>=3 hari merah, >=1 hari oranye).
        long cmAge = createdMsOf(o);
        String ag = cmAge > 0 ? aging(cmAge) : "";
        if (!ag.isEmpty()) {
            long hariUmur = (System.currentTimeMillis() - cmAge) / 86400000L;
            int agBg = hariUmur >= 3 ? 0xFFFDE7E7 : hariUmur >= 1 ? 0xFFFFF3E0 : 0xFFEEF1F4;
            int agFg = hariUmur >= 3 ? 0xFFB3261E : hariUmur >= 1 ? 0xFFB36A00 : getColor(R.color.ink2);
            chips.addView(chip("⏱ umur " + ag, agBg, agFg));
        }
        // chip est-pencairan (estimasi dari detail order marketplace)
        String est = o.isNull("estPencairan") ? "" : o.optString("estPencairan", "");
        if (!est.isEmpty()) chips.addView(chip("≈ " + rupiah(est), android.graphics.Color.parseColor("#E6F4EA"), android.graphics.Color.parseColor("#1B7F4B")));
        String mp = o.optString("status", "");
        if (!mp.isEmpty()) chips.addView(chip("MP: " + mpLabel(mp), android.graphics.Color.parseColor("#EEF1F4"), getColor(R.color.ink2)));
        if (o.optBoolean("scanned", false)) chips.addView(chip("✓ discan", android.graphics.Color.parseColor("#E6F4EA"), android.graphics.Color.parseColor("#1B7F4B")));
        else chips.addView(chip("belum discan", android.graphics.Color.parseColor("#EEF1F4"), getColor(R.color.ink3)));
        if (o.optString("id").equals(maxValueId)) chips.addView(chip("★ nilai tertinggi", android.graphics.Color.parseColor("#E8F0FE"), android.graphics.Color.parseColor("#256FB0")));
        HorizontalScrollView chScroll = new HorizontalScrollView(this);
        chScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout.LayoutParams chlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        chlp.topMargin = dp(8);
        chScroll.setLayoutParams(chlp);
        chScroll.addView(chips);
        body.addView(chScroll);

        c.addView(head);
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
        col.addView(kv("Nomor Resi", o.optString("trackingNumber", "-")));
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
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setPadding(0, dp(4), 0, dp(4));
                ImageView iv = thumb(40);
                ((LinearLayout.LayoutParams) iv.getLayoutParams()).rightMargin = dp(10);
                loadThumb(it.optString("skuImage", ""), iv);
                row.addView(iv);
                TextView t = new TextView(this);
                String nm = it.optString("name", it.optString("skuName", "-"));
                t.setText(it.optInt("qty", 1) + " x " + nm);
                t.setTextSize(13); t.setTextColor(getColor(R.color.ink));
                row.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                col.addView(row);
            }
        }

        // Aksi
        LinearLayout act = new LinearLayout(this);
        act.setOrientation(LinearLayout.VERTICAL);
        act.setPadding(0, dp(14), 0, 0);
        if ("masuk".equals(stat)) {
            // "Proses" (RTS ke marketplace) ada di blok bawah (kirim ke marketplace /
            // jadwalkan jemput utk instant). Di sini cukup opsi Tolak.
            act.addView(btn("Tolak", false, v -> { dlg.dismiss(); ubahStatus(id, "dibatalkan"); }));
        } else {
            String nx = nextStatus(stat);
            if (nx != null) act.addView(btn("Lanjut ke " + label(nx), true, v -> { dlg.dismiss(); ubahStatus(id, nx); }));
        }
        // Cetak Resi: tombol sembunyi saat "menunggu disetujui" (masuk). Bila AWB
        // sudah di-cache di server -> buka file server; kalau belum -> ambil dari TikTok.
        if (!"masuk".equals(stat)) {
            final String awbUrl = o.isNull("awbUrl") ? "" : o.optString("awbUrl", "");
            if (!awbUrl.isEmpty()) {
                final String full = new Session(this).baseUrl() + awbUrl;
                act.addView(btn("Cetak / Unduh Resi", false, v -> {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(full))); }
                    catch (Exception e) { toast("Tak bisa membuka resi."); }
                }));
            } else {
                act.addView(btn("Ambil Resi dari TikTok", false, v -> cetakAwb(id)));
            }
        }
        if (isSameday(o.optString("shippingCourier", ""))) {
            act.addView(btn("Jadwalkan jemput & proses", true, v -> konfirmJemput(id, o.optString("marketplaceOrderId"), dlg)));
        } else {
            act.addView(btn("Proses (kirim ke marketplace)", true, v -> konfirmRts(id, o.optString("marketplaceOrderId"), dlg)));
        }
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

    private void cetakAwb(String id) { cetakAwb(id, false); }
    private void cetakAwb(String id, boolean force) {
        toast("Mengambil label…");
        api.orderLabel(id, force, r -> {
            if (r != null && r.ok() && r.data() != null && r.data().optBoolean("alreadyPrinted", false)) {
                final String awb = r.data().optString("awbUrl", "");
                new MaterialAlertDialogBuilder(this)
                        .setTitle("Resi sudah dicetak")
                        .setMessage("Resi ini SUDAH pernah dicetak. Cetak ulang? (untuk hindari resi ganda)")
                        .setNegativeButton("Batal", (dd, w) -> {
                            if (!awb.isEmpty()) { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(new Session(this).baseUrl() + awb))); } catch (Exception e) {} }
                        })
                        .setPositiveButton("Cetak ulang", (dd, w) -> cetakAwb(id, true))
                        .show();
                return;
            }
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
                .setTitle("Proses ke marketplace (RTS)?")
                .setMessage("Order " + no + " akan di-RTS: status di seller center jadi menunggu kurir & AWB dibuat. Tindakan nyata dan sulit dibatalkan.")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Kirim", (di, w) -> {
                    if (parent != null) parent.dismiss();
                    toast("Mengirim…");
                    api.orderShip(id, "DROP_OFF", r -> {
                        boolean ok = r != null && r.ok() && r.data() != null && r.data().optBoolean("ok", false);
                        toast(ok ? "Diproses (RTS) → Menunggu Dicetak" : (r == null ? "Gagal" : r.message("Gagal RTS")));
                        muat();
                    });
                })
                .show();
    }

    private boolean isSameday(String kurir) {
        if (kurir == null) return false;
        String c = kurir.toLowerCase(java.util.Locale.ROOT);
        String[] keys = {"instant","sameday","same day","same-day","gojek","gosend","grab","grabexpress","grab express","gokilat","borzo","lalamove","spx instant","spx sameday"};
        for (String k : keys) if (c.contains(k)) return true;
        return false;
    }

    private String fmtSlot(long startSec, long endSec) {
        java.util.Locale id = new java.util.Locale("id");
        java.text.SimpleDateFormat f1 = new java.text.SimpleDateFormat("dd MMM HH:mm", id);
        java.text.SimpleDateFormat f2 = new java.text.SimpleDateFormat("HH:mm", id);
        return f1.format(new java.util.Date(startSec * 1000)) + " \u2013 " + f2.format(new java.util.Date(endSec * 1000));
    }

    /** Order sameday/instant: ambil slot jemput -> pilih -> ship pickup. */
    private void konfirmJemput(String id, String no, com.google.android.material.bottomsheet.BottomSheetDialog parent) {
        toast("Mengambil jadwal jemput\u2026");
        api.orderSlotJemput(id, r -> {
            if (r == null || !r.ok() || r.data() == null) { toast(r == null ? "Gagal ambil jadwal" : r.message("Gagal ambil jadwal jemput")); return; }
            org.json.JSONObject d = r.data();
            org.json.JSONArray slots = d.optJSONArray("slots");
            boolean bisa = d.optBoolean("bisaJemput", true);
            if (!bisa || slots == null || slots.length() == 0) {
                new com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                        .setTitle("Tak ada slot jemput")
                        .setMessage("Order ini tak punya slot jemput tersedia. Proses sebagai drop-off biasa?")
                        .setNegativeButton("Batal", null)
                        .setPositiveButton("Proses drop-off", (di, w) -> konfirmRts(id, no, parent))
                        .show();
                return;
            }
            final java.util.List<Long> starts = new java.util.ArrayList<>();
            final java.util.List<Long> ends = new java.util.ArrayList<>();
            final java.util.List<String> labels = new java.util.ArrayList<>();
            for (int i = 0; i < slots.length(); i++) {
                org.json.JSONObject s = slots.optJSONObject(i);
                if (s == null) continue;
                long st = s.optLong("startTime", 0), en = s.optLong("endTime", 0);
                if (st <= 0 || en <= 0) continue;
                boolean tersedia = s.optBoolean("tersedia", true);
                starts.add(st); ends.add(en);
                labels.add(fmtSlot(st, en) + (tersedia ? "" : " (penuh)"));
            }
            if (labels.isEmpty()) { toast("Tak ada slot valid"); return; }
            final int[] pick = { 0 };
            new com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                    .setTitle("Pilih jadwal jemput \u2014 " + no)
                    .setSingleChoiceItems(labels.toArray(new String[0]), 0, (di, w) -> pick[0] = w)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Jadwalkan & proses", (di, w) -> {
                        long st = starts.get(pick[0]), en = ends.get(pick[0]);
                        if (parent != null) parent.dismiss();
                        toast("Menjadwalkan jemput\u2026");
                        api.orderShipPickup(id, st, en, r2 -> {
                            boolean ok = r2 != null && r2.ok() && r2.data() != null && r2.data().optBoolean("ok", false);
                            toast(ok ? "Jemput terjadwal \u2192 diproses" : (r2 == null ? "Gagal" : r2.message("Gagal jadwal jemput")));
                            muat();
                        });
                    })
                    .show();
        });
    }

    // ---- Otomasi Order ----
    private void showOtomasi() {
        api.orderSettings(r -> {
            boolean auto = r != null && r.ok() && r.data() != null && r.data().optBoolean("autoSiapKirim", false);
            StringBuilder kur = new StringBuilder();
            if (r != null && r.ok() && r.data() != null) {
                JSONArray ic = r.data().optJSONArray("instantCouriers");
                if (ic != null) for (int i = 0; i < ic.length(); i++) { if (i > 0) kur.append(", "); kur.append(ic.optString(i)); }
            }
            LinearLayout col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL);
            col.setPadding(dp(20), dp(8), dp(20), dp(8));
            Switch sw = new Switch(this);
            sw.setText("Otomatis setujui / proses order baru");
            sw.setChecked(auto);
            col.addView(sw);
            TextView note = new TextView(this);
            note.setText("Order baru (Menunggu Disetujui) langsung dinaikkan ke Menunggu Dicetak, jadi tim tinggal cetak resi. Kecuali kurir instant/sameday di bawah. Hanya-maju: tahap yang sudah lebih jauh tak ditarik mundur.");
            note.setTextSize(12); note.setTextColor(getColor(R.color.ink3)); note.setPadding(0, dp(4), 0, dp(10));
            col.addView(note);
            TextView lbl = new TextView(this); lbl.setText("Kecualikan kurir (pisahkan koma)");
            lbl.setTextSize(12); lbl.setTextColor(getColor(R.color.ink2)); col.addView(lbl);
            EditText et = new EditText(this); et.setText(kur.toString()); et.setSingleLine(true); et.setTextSize(14);
            col.addView(et);
            String docType = r != null && r.ok() && r.data() != null ? r.data().optString("docType", "SHIPPING_LABEL_AND_PACKING_SLIP") : "SHIPPING_LABEL_AND_PACKING_SLIP";
            String docSize = r != null && r.ok() && r.data() != null ? r.data().optString("docSize", "A6") : "A6";
            final String[] dtVals = {"SHIPPING_LABEL_AND_PACKING_SLIP", "SHIPPING_LABEL", "PACKING_SLIP"};
            final String[] dtLabels = {"Resi + Packing Slip (daftar produk)", "Resi saja", "Packing Slip saja"};
            TextView dtLbl = new TextView(this); dtLbl.setText("Dokumen resi"); dtLbl.setTextSize(12); dtLbl.setTextColor(getColor(R.color.ink2)); dtLbl.setPadding(0, dp(10), 0, 0); col.addView(dtLbl);
            final android.widget.Spinner dtSp = new android.widget.Spinner(this);
            dtSp.setAdapter(new android.widget.ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, dtLabels));
            int dtIdx = 0; for (int i = 0; i < dtVals.length; i++) if (dtVals[i].equals(docType)) dtIdx = i;
            dtSp.setSelection(dtIdx); col.addView(dtSp);
            final String[] dsVals = {"A6", "A5"};
            TextView dsLbl = new TextView(this); dsLbl.setText("Ukuran"); dsLbl.setTextSize(12); dsLbl.setTextColor(getColor(R.color.ink2)); dsLbl.setPadding(0, dp(8), 0, 0); col.addView(dsLbl);
            final android.widget.Spinner dsSp = new android.widget.Spinner(this);
            dsSp.setAdapter(new android.widget.ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, dsVals));
            dsSp.setSelection("A5".equals(docSize) ? 1 : 0); col.addView(dsSp);
            new MaterialAlertDialogBuilder(this)
                    .setTitle("Otomasi Order").setView(col)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan", (di, w) -> {
                        JSONArray arr = new JSONArray();
                        for (String s : et.getText().toString().split(",")) { String t = s.trim(); if (!t.isEmpty()) arr.put(t); }
                        api.orderSettingsSave(sw.isChecked(), arr, dtVals[dtSp.getSelectedItemPosition()], dsVals[dsSp.getSelectedItemPosition()], rr -> toast(rr != null && rr.ok() ? "Pengaturan disimpan" : "Gagal menyimpan"));
                    }).show();
        });
    }

    // ---- Batch Packing ----
    private void showBatch() {
        startActivity(new Intent(this, BatchPackingActivity.class));
    }

    private void konfirmBatch(JSONArray ids, JSONArray takeouts) {
        new MaterialAlertDialogBuilder(this)
                .setTitle("Proses " + ids.length() + " order?")
                .setMessage("Order akan di-RTS ke marketplace + AWB dibuat (diproses di server), lalu status jadi Packing. Tindakan nyata. Submit?")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Submit", (di, w) -> {
                    toast("Memulai batch…");
                    api.orderBatchPackingStart(ids, takeouts, "DROP_OFF", r -> {
                        if (r == null || !r.ok() || r.data() == null) { toast(r == null ? "Gagal" : r.message("Gagal batch")); muat(); return; }
                        String batchId = r.data().optString("batchId", "");
                        muat();
                        if (!batchId.isEmpty()) startActivity(new Intent(OrdersActivity.this, BatchingListActivity.class).putExtra("batchId", batchId));
                        else toast("Batch dimulai.");
                    });
                }).show();
    }


    private void bukaUrl(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (Exception e) { toast("Tak bisa membuka PDF."); }
    }

    /** Tulis PDF base64 (dari backend) ke file lalu buka. Label & packing list
     *  dibuat di backend agar ketajaman barcode terjaga. */
    private void bukaBase64Pdf(String b64, String name) {
        if (b64 == null || b64.isEmpty()) return;
        try {
            byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            File f = new File(getExternalFilesDir(null), name);
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(bytes); fos.close();
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".berkas", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/pdf");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(i);
        } catch (Exception e) { toast("Gagal buka " + name); }
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
