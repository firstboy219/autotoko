package id.autotoko.scanner;

import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Packing List: pesanan yang MASIH harus dikerjakan gudang.
 *
 * Sumbernya sama dengan Daftar Pesanan ({@code /api/orders?active=1}); yang
 * berbeda hanya saringannya. Sebuah pesanan keluar dari daftar ini begitu
 * resinya sudah jalan (Dalam Pengiriman / Terkirim / Selesai) atau pesanannya
 * dibatalkan -- jadi daftarnya berkurang sendiri seiring paket berangkat,
 * tanpa ada yang perlu dicentang. Belum Bayar juga tidak ikut: itu belum
 * boleh dipacking.
 *
 * Paling atas rekap produk (berapa pcs tiap barang yang harus diambil dari
 * rak), karena itu yang dibawa orang packing berkeliling; rincian per pesanan
 * di bawahnya, dikelompokkan per tahap.
 */
public class PackingListActivity extends AppCompatActivity {

    private static final String[] TAHAP = { "masuk", "approved", "produksi", "packing", "siap_kirim" };

    private Api api;
    private LinearLayout list;
    private TextView status;
    private androidx.swiperefreshlayout.widget.SwipeRefreshLayout srl;
    private float d;
    private boolean pernahMuat = false;

    private int dp(int v) { return (int) (v * d); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Packing List");
        d = getResources().getDisplayMetrics().density;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackgroundColor(getColor(R.color.canvas));

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(getColor(R.color.ink2));
        status.setPadding(dp(16), dp(10), dp(16), dp(4));
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

        setContentView(NavBawah.bungkus(this, col, NavBawah.PACKING));
        muat();
    }

    @Override protected void onResume() { super.onResume(); if (pernahMuat) muat(); }

    private static boolean outstanding(JSONObject o) {
        String fs = o.optString("fulfillmentStatus", "");
        boolean tahapOk = false;
        for (String t : TAHAP) if (t.equals(fs)) { tahapOk = true; break; }
        if (!tahapOk) return false;
        String mp = o.optString("status", "").toUpperCase(Locale.ROOT);
        switch (mp) {
            case "UNPAID": case "CANCELLED": case "CANCELED": case "IN_TRANSIT":
            case "DELIVERED": case "COMPLETED":
                return false;
            default:
                return true;
        }
    }

    private void muat() {
        status.setText("Memuat packing list…");
        api.orders(true, r -> {
            srl.setRefreshing(false);
            pernahMuat = true;
            if (r == null || !r.ok() || r.dataArray() == null) {
                status.setText(r == null ? "Gagal memuat." : r.message("Gagal memuat pesanan."));
                return;
            }
            gambar(r.dataArray());
        });
    }

    private void gambar(JSONArray all) {
        list.removeAllViews();
        Map<String, List<JSONObject>> perTahap = new LinkedHashMap<>();
        for (String t : TAHAP) perTahap.put(t, new ArrayList<>());
        Map<String, int[]> produk = new LinkedHashMap<>(); // nama -> {pcs, order}
        int nOrder = 0, nPcs = 0;
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o == null || !outstanding(o)) continue;
            perTahap.get(o.optString("fulfillmentStatus")).add(o);
            nOrder++;
            JSONArray items = o.optJSONArray("items");
            for (int k = 0; items != null && k < items.length(); k++) {
                JSONObject it = items.optJSONObject(k);
                if (it == null) continue;
                int q = Math.max(1, it.optInt("qty", 1));
                String nm = namaItem(it);
                int[] v = produk.get(nm);
                if (v == null) { v = new int[2]; produk.put(nm, v); }
                v[0] += q; v[1] += 1;
                nPcs += q;
            }
        }
        if (nOrder == 0) {
            status.setText("Tidak ada yang perlu dipacking.");
            list.addView(kartu("Semua beres", "Tidak ada pesanan outstanding. Pesanan yang resinya "
                    + "sudah dikirim atau dibatalkan otomatis hilang dari daftar ini.", false));
            return;
        }
        status.setText(nOrder + " pesanan · " + nPcs + " pcs outstanding · tarik ke bawah untuk muat ulang");

        // Rekap produk: urut pcs terbanyak dulu.
        List<Map.Entry<String, int[]>> urut = new ArrayList<>(produk.entrySet());
        Collections.sort(urut, (x, y) -> y.getValue()[0] - x.getValue()[0]);
        list.addView(judul("Rekap produk (" + urut.size() + " jenis)"));
        LinearLayout rekap = kotak();
        for (Map.Entry<String, int[]> e : urut) {
            rekap.addView(baris(e.getValue()[0] + " pcs", e.getKey(), e.getValue()[1] + " order"));
        }
        list.addView(rekap);

        for (String t : TAHAP) {
            List<JSONObject> os = perTahap.get(t);
            if (os == null || os.isEmpty()) continue;
            list.addView(judul(labelTahap(t) + " (" + os.size() + ")"));
            for (JSONObject o : os) list.addView(kartuOrder(o));
        }
    }

    private static String namaItem(JSONObject it) {
        String mn = it.isNull("masterName") ? "" : it.optString("masterName", "");
        if (!mn.isEmpty()) return mn;
        String n = it.optString("name", it.optString("skuName", it.optString("sellerSku", "")));
        return n == null || n.isEmpty() ? "(tanpa nama)" : n;
    }

    private static String labelTahap(String s) {
        switch (s) {
            case "masuk": return "Menunggu Diproses";
            case "approved": return "Menunggu Dicetak";
            case "produksi": return "Produksi";
            case "packing": return "Menunggu Dipacking";
            case "siap_kirim": return "Menunggu Dipickup";
            default: return s;
        }
    }

    private View kartuOrder(JSONObject o) {
        StringBuilder isi = new StringBuilder();
        JSONArray items = o.optJSONArray("items");
        for (int k = 0; items != null && k < items.length(); k++) {
            JSONObject it = items.optJSONObject(k);
            if (it == null) continue;
            if (isi.length() > 0) isi.append("\n");
            isi.append(Math.max(1, it.optInt("qty", 1))).append(" x ").append(namaItem(it));
        }
        String resi = o.optString("trackingNumber", "");
        String head = o.optString("marketplaceOrderId", "-") + "  ·  " + o.optString("shopName", "-");
        String kaki = (resi.isEmpty() || "null".equals(resi) ? "Resi belum ada" : "Resi " + resi)
                + (o.optBoolean("scanned", false) ? "  ·  sudah discan" : "");
        LinearLayout k = kartu(head, isi.length() == 0 ? "-" : isi.toString(), false);
        TextView f = new TextView(this);
        f.setTextSize(11);
        f.setTextColor(getColor(R.color.ink3));
        f.setPadding(0, dp(4), 0, 0);
        f.setText(kaki);
        k.addView(f);
        return k;
    }

    /* ---- bantu tampilan ---- */

    private TextView judul(String t) {
        TextView v = new TextView(this);
        v.setTextSize(15);
        v.setTypeface(null, Typeface.BOLD);
        v.setTextColor(getColor(R.color.ink));
        v.setPadding(dp(4), dp(16), 0, dp(6));
        v.setText(t);
        return v;
    }

    private LinearLayout kotak() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(8), dp(12), dp(8));
        GradientDrawable g = new GradientDrawable();
        g.setColor(getColor(R.color.surface));
        g.setCornerRadius(dp(12));
        g.setStroke(Math.max(1, dp(1)), getColor(R.color.line));
        box.setBackground(g);
        return box;
    }

    private LinearLayout kartu(String judul, String isi, boolean tebal) {
        LinearLayout box = kotak();
        box.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        box.setLayoutParams(lp);
        TextView t = new TextView(this);
        t.setTextSize(13);
        t.setTypeface(null, Typeface.BOLD);
        t.setTextColor(getColor(R.color.ink));
        t.setText(judul);
        box.addView(t);
        TextView s = new TextView(this);
        s.setTextSize(13);
        s.setTextColor(getColor(R.color.ink2));
        s.setPadding(0, dp(4), 0, 0);
        s.setText(isi);
        box.addView(s);
        return box;
    }

    private View baris(String kiri, String tengah, String kanan) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(0, dp(5), 0, dp(5));
        TextView a = new TextView(this);
        a.setTextSize(14);
        a.setTypeface(null, Typeface.BOLD);
        a.setTextColor(getColor(R.color.brand));
        a.setText(kiri);
        r.addView(a, new LinearLayout.LayoutParams(dp(64), ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView b = new TextView(this);
        b.setTextSize(13);
        b.setTextColor(getColor(R.color.ink));
        b.setText(tengah);
        r.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView c = new TextView(this);
        c.setTextSize(11);
        c.setTextColor(getColor(R.color.ink3));
        c.setPadding(dp(8), 0, 0, 0);
        c.setText(kanan);
        r.addView(c);
        return r;
    }
}
