package id.autotoko.scanner;

import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Halaman Mulai Batch Packing -- bukan popup lagi.
 *
 * Dulu dialog: tak muat filter yang serius. Kini layar sendiri dengan filter
 * (belum discan, per toko, urutkan paling urgent) + centang per order supaya
 * bisa "proses beberapa resi saja". Order yang tak dicentang tidak ikut batch;
 * "Take out" menahannya berikut alasan (tercatat di server).
 */
public class BatchPackingActivity extends AppCompatActivity {

    private Api api;
    private Session session;
    private float d;

    private final List<JSONObject> kandidat = new ArrayList<>();
    private final List<String> shopList = new ArrayList<>();
    private final Set<String> excluded = new HashSet<>();
    private final Map<String, String> takeout = new LinkedHashMap<>();

    private String query = "";
    private String shopFilter = "";
    private boolean onlyUnscanned = false;
    private int sortMode = 0; // 0 urgent, 1 terlama, 2 terbaru

    private LinearLayout root;
    private LinearLayout listBox;
    private TextView countLbl;
    private MaterialButton prosesBtn;

    private int dp(int v) { return (int) (v * d); }
    private void toast(String m) { Toast.makeText(this, m, Toast.LENGTH_SHORT).show(); }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        d = getResources().getDisplayMetrics().density;
        setTitle("Batch Packing");
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

        TextView loading = new TextView(this);
        loading.setText("Memuat order…");
        loading.setTextColor(getColor(R.color.ink2));
        root.addView(loading);

        api.orders(true, r -> {
            if (r == null || !r.ok() || r.dataArray() == null) {
                loading.setText(r == null ? "Gagal memuat order." : r.message("Gagal memuat order."));
                return;
            }
            JSONArray all = r.dataArray();
            kandidat.clear();
            Set<String> shops = new HashSet<>();
            for (int i = 0; i < all.length(); i++) {
                JSONObject o = all.optJSONObject(i);
                if (o == null) continue;
                if ("dikirim".equals(o.optString("fulfillmentStatus"))) continue;
                if ("manual".equals(o.optString("sumber", "api"))) continue; // manual tak bisa RTS
                kandidat.add(o);
                String sn = o.optString("shopName", "");
                if (!sn.isEmpty()) shops.add(sn);
            }
            shopList.clear();
            shopList.addAll(shops);
            java.util.Collections.sort(shopList);
            buildUi();
        });
    }

    private void buildUi() {
        root.removeAllViews();
        if (kandidat.isEmpty()) {
            TextView e = new TextView(this);
            e.setText("Tidak ada order untuk dikirim.");
            e.setTextColor(getColor(R.color.ink2));
            root.addView(e);
            return;
        }

        // --- baris cari ---
        EditText cari = new EditText(this);
        cari.setHint("Cari resi / order / pembeli…");
        cari.setSingleLine(true);
        cari.setTextSize(14);
        root.addView(cari, lp());
        cari.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(Editable e) { query = e.toString().trim().toLowerCase(Locale.US); renderList(); }
        });

        // --- toko + urutan ---
        LinearLayout barisFilter = new LinearLayout(this);
        barisFilter.setOrientation(LinearLayout.HORIZONTAL);
        List<String> tokoOpt = new ArrayList<>();
        tokoOpt.add("Semua toko");
        tokoOpt.addAll(shopList);
        Spinner spToko = spinner(tokoOpt);
        spToko.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                shopFilter = pos == 0 ? "" : tokoOpt.get(pos);
                renderList();
            }
            public void onNothingSelected(AdapterView<?> p) {}
        });
        Spinner spUrut = spinner(java.util.Arrays.asList("Paling urgent", "Terlama", "Terbaru"));
        spUrut.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { sortMode = pos; renderList(); }
            public void onNothingSelected(AdapterView<?> p) {}
        });
        LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        half.rightMargin = dp(6);
        spToko.setLayoutParams(half);
        spUrut.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        barisFilter.addView(spToko);
        barisFilter.addView(spUrut);
        root.addView(barisFilter, lp());

        // --- belum discan + pilih semua/kosongkan ---
        LinearLayout barisAksi = new LinearLayout(this);
        barisAksi.setOrientation(LinearLayout.HORIZONTAL);
        barisAksi.setGravity(Gravity.CENTER_VERTICAL);
        CheckBox cbUnscanned = new CheckBox(this);
        cbUnscanned.setText("Hanya yang belum discan");
        cbUnscanned.setTextSize(13);
        cbUnscanned.setOnCheckedChangeListener((v, c) -> { onlyUnscanned = c; renderList(); });
        barisAksi.addView(cbUnscanned, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        MaterialButton pilihSemua = flatBtn("Pilih semua");
        pilihSemua.setOnClickListener(v -> { excluded.clear(); renderList(); });
        MaterialButton kosong = flatBtn("Kosongkan");
        kosong.setOnClickListener(v -> { for (JSONObject o : visible()) excluded.add(o.optString("id")); renderList(); });
        barisAksi.addView(pilihSemua);
        barisAksi.addView(kosong);
        root.addView(barisAksi, lp());

        countLbl = new TextView(this);
        countLbl.setTextSize(13);
        countLbl.setTextColor(getColor(R.color.ink2));
        root.addView(countLbl, lp());

        listBox = new LinearLayout(this);
        listBox.setOrientation(LinearLayout.VERTICAL);
        root.addView(listBox, lp());

        prosesBtn = new MaterialButton(this);
        prosesBtn.setAllCaps(false);
        prosesBtn.setOnClickListener(v -> proses());
        root.addView(prosesBtn, lp());

        renderList();
    }

    /** Kandidat setelah filter (belum sort). */
    private List<JSONObject> filtered() {
        List<JSONObject> out = new ArrayList<>();
        for (JSONObject o : kandidat) {
            if (onlyUnscanned && isScanned(o)) continue;
            if (!shopFilter.isEmpty() && !shopFilter.equals(o.optString("shopName", ""))) continue;
            if (!query.isEmpty()) {
                String hay = (o.optString("marketplaceOrderId", "") + " " + o.optString("buyerName", "")
                        + " " + o.optString("trackingNumber", "")).toLowerCase(Locale.US);
                if (!hay.contains(query)) continue;
            }
            out.add(o);
        }
        return out;
    }

    private List<JSONObject> visible() {
        List<JSONObject> out = filtered();
        java.util.Collections.sort(out, (a, b) -> {
            if (sortMode == 0) return Long.compare(deadline(a), deadline(b));
            long ca = created(a), cb = created(b);
            return sortMode == 1 ? Long.compare(ca, cb) : Long.compare(cb, ca);
        });
        return out;
    }

    private void renderList() {
        if (listBox == null) return;
        listBox.removeAllViews();
        List<JSONObject> vis = visible();
        int included = 0;
        long now = System.currentTimeMillis();
        for (JSONObject o : vis) {
            final String id = o.optString("id");
            final boolean excl = excluded.contains(id);
            final boolean out = takeout.containsKey(id);
            if (!excl && !out) included++;

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(0, dp(8), 0, dp(8));

            LinearLayout top = new LinearLayout(this);
            top.setOrientation(LinearLayout.HORIZONTAL);
            top.setGravity(Gravity.CENTER_VERTICAL);
            CheckBox cb = new CheckBox(this);
            cb.setChecked(!excl);
            top.addView(cb);

            TextView t = new TextView(this);
            long dl = o.optLong("shipDeadlineMs", 0);
            boolean urgent = dl > 0 && dl < now + 3 * 3600000L;
            String line2 = o.optString("shopName", "");
            line2 += (urgent ? "  ·  URGENT" : "");
            line2 += isScanned(o) ? "  ·  sudah discan" : "  ·  belum discan";
            t.setText(o.optString("marketplaceOrderId", "-") + "  ·  " + o.optString("buyerName", "")
                    + "\n" + line2);
            t.setTextSize(13);
            t.setTextColor(getColor(excl || out ? R.color.ink3 : R.color.ink));
            top.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            final MaterialButton tob = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            tob.setAllCaps(false);
            tob.setText(out ? "Batalkan" : "Take out");
            tob.setVisibility(excl ? View.GONE : View.VISIBLE);
            top.addView(tob);
            row.addView(top);

            final EditText rsn = new EditText(this);
            rsn.setHint("Alasan takeout…");
            rsn.setSingleLine(true);
            rsn.setTextSize(13);
            rsn.setPadding(dp(36), 0, 0, 0);
            rsn.setVisibility(out && !excl ? View.VISIBLE : View.GONE);
            if (out) rsn.setText(takeout.get(id));
            row.addView(rsn);

            cb.setOnCheckedChangeListener((bv, checked) -> {
                if (checked) excluded.remove(id); else { excluded.add(id); takeout.remove(id); }
                renderList();
            });
            tob.setOnClickListener(v -> {
                if (takeout.containsKey(id)) takeout.remove(id); else takeout.put(id, "");
                renderList();
            });
            rsn.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
                public void onTextChanged(CharSequence s, int a, int b, int c) {}
                public void afterTextChanged(Editable e) { if (takeout.containsKey(id)) takeout.put(id, e.toString().trim()); }
            });
            listBox.addView(row);
        }
        if (vis.isEmpty()) {
            TextView none = new TextView(this);
            none.setText("Tak ada order yang cocok dengan filter.");
            none.setTextColor(getColor(R.color.ink3));
            none.setPadding(0, dp(12), 0, dp(12));
            listBox.addView(none);
        }
        countLbl.setText(vis.size() + " order tampil · " + included + " akan diproses"
                + (takeout.isEmpty() ? "" : "  ·  " + takeout.size() + " di-takeout"));
        prosesBtn.setText("Proses " + included + " order");
        prosesBtn.setEnabled(included > 0);
    }

    private void proses() {
        final JSONArray ids = new JSONArray();
        final JSONArray tk = new JSONArray();
        for (JSONObject o : visible()) {
            String id = o.optString("id");
            if (excluded.contains(id)) continue;
            if (takeout.containsKey(id)) {
                try { JSONObject j = new JSONObject(); j.put("orderId", id); j.put("reason", takeout.get(id)); tk.put(j); } catch (Exception ig) {}
            } else {
                ids.put(id);
            }
        }
        if (ids.length() == 0) { toast("Tidak ada order terpilih."); return; }
        new MaterialAlertDialogBuilder(this)
                .setTitle("Proses " + ids.length() + " order?")
                .setMessage("Order akan di-RTS ke marketplace + AWB dibuat (diproses di server), lalu status jadi Packing. Tindakan nyata. Submit?")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Submit", (di, w) -> {
                    toast("Memulai batch…");
                    api.orderBatchPackingStart(ids, tk, "DROP_OFF", r -> {
                        if (r == null || !r.ok() || r.data() == null) { toast(r == null ? "Gagal" : r.message("Gagal batch")); return; }
                        String batchId = r.data().optString("batchId", "");
                        if (!batchId.isEmpty()) {
                            startActivity(new Intent(this, BatchingListActivity.class).putExtra("batchId", batchId));
                            finish();
                        } else {
                            toast("Batch dimulai.");
                            finish();
                        }
                    });
                }).show();
    }

    // ---- helpers ----
    private boolean isScanned(JSONObject o) {
        return o.optBoolean("scanned", false) || o.optBoolean("terscan", false);
    }
    private long deadline(JSONObject o) {
        long dl = o.optLong("shipDeadlineMs", 0);
        return dl > 0 ? dl : Long.MAX_VALUE;
    }
    private long created(JSONObject o) {
        String s = o.optString("createdAtMarketplace", "");
        if (s.isEmpty()) s = o.optString("createdAt", "");
        return parseIso(s);
    }
    private static long parseIso(String s) {
        if (s == null) return 0;
        try {
            if (s.length() >= 19) {
                SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
                f.setTimeZone(TimeZone.getTimeZone("UTC"));
                return f.parse(s.substring(0, 19)).getTime();
            }
            if (s.length() >= 10) {
                SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                f.setTimeZone(TimeZone.getTimeZone("UTC"));
                return f.parse(s.substring(0, 10)).getTime();
            }
        } catch (Exception ignored) {}
        return 0;
    }
    private Spinner spinner(List<String> items) {
        Spinner sp = new Spinner(this);
        ArrayAdapter<String> ad = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, items);
        ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        sp.setAdapter(ad);
        return sp;
    }
    private MaterialButton flatBtn(String text) {
        MaterialButton b = new MaterialButton(this, null, com.google.android.material.R.attr.borderlessButtonStyle);
        b.setAllCaps(false);
        b.setText(text);
        b.setTextSize(12);
        return b;
    }
    private LinearLayout.LayoutParams lp() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(8);
        return p;
    }
}
