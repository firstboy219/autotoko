package id.autotoko.scanner;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.ListView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Recent scans, with a way to undo one that was recorded by mistake. */
public class HistoryActivity extends AppCompatActivity {

    private ListView list;
    private TextView empty, header;
    private Api api;

    /** Which list is on screen: packing scans, or raw-material parcels. */
    private boolean showingDeliveries = false;
    private com.google.android.material.button.MaterialButton tabScans, tabDeliveries;

    private final List<String> ids = new ArrayList<>();
    /** One line of plain text per row, kept for the delete confirmation. */
    private final List<String> labels = new ArrayList<>();
    private final List<Row> rows = new ArrayList<>();

    /** What one scan looks like on screen. */
    private static final class Row {
        String resi;
        String meta;
        String trailing;
        /** Null when the scan was entered by hand rather than photographed. */
        String photoUrl;
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_history);
        api = new Api(new Session(this));

        list = findViewById(R.id.list);
        empty = findViewById(R.id.empty);
        header = findViewById(R.id.header);
        findViewById(R.id.back).setOnClickListener(v -> finish());

        tabScans = findViewById(R.id.tabScans);
        tabDeliveries = findViewById(R.id.tabDeliveries);
        tabScans.setOnClickListener(v -> switchTo(false));
        tabDeliveries.setOnClickListener(v -> switchTo(true));

        // A tap, not only a long press. Delete existed here from the start and
        // was reported missing, which is the same thing when the only way to
        // reach it is a gesture nothing on screen mentions.
        list.setOnItemClickListener((AdapterView<?> p, View v, int pos, long id) ->
                rowActions(pos));
        // Same chooser as a tap. Two gestures that do different things on one
        // list is how a packer deletes a parcel they meant to correct.
        list.setOnItemLongClickListener((AdapterView<?> p, View v, int pos, long id) -> {
            rowActions(pos);
            return true;
        });

        switchTo(false);
    }

    private void switchTo(boolean deliveries) {
        showingDeliveries = deliveries;
        // Selected state carried by the button style rather than a colour set
        // here, so it follows the theme like everything else on this screen.
        tabScans.setAlpha(deliveries ? 0.55f : 1f);
        tabDeliveries.setAlpha(deliveries ? 1f : 0.55f);
        if (deliveries) loadDeliveries(); else load();
    }

    /**
     * Parcels of raw materials, as this phone reported them.
     *
     * Shown beside the packing scans rather than on a screen of their own:
     * they are the same act — point the camera at a waybill and commit
     * something — and a packer looking for "the one I just did" should not
     * have to know which of two places to look.
     */
    private void loadDeliveries() {
        header.setText("Memuat…");
        api.purchases(r -> {
            ids.clear();
            labels.clear();
            rows.clear();
            if (!r.ok() || r.dataArray() == null) {
                header.setText("Bahan Datang");
                empty.setText(r.message("Gagal memuat daftar bahan datang."));
                empty.setVisibility(View.VISIBLE);
                list.setAdapter(new RowAdapter());
                return;
            }
            JSONArray arr = r.dataArray();
            int shown = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                ids.add(o.optString("id"));

                Row row = new Row();
                String resi = clean(o.optString("resi", ""));
                row.resi = resi.isEmpty() ? "Tanpa resi" : resi;

                StringBuilder meta = new StringBuilder(clean(o.optString("purchasedAt", "")));
                String supplier = clean(o.optString("supplierName", ""));
                if (!supplier.isEmpty()) meta.append("  ·  ").append(supplier);
                if (!"delivery_scan".equals(o.optString("source"))) {
                    meta.append("  ·  input manual");
                }
                row.meta = meta.toString();

                StringBuilder tail = new StringBuilder();
                int items = o.optInt("itemCount", 0);
                if (items > 0) tail.append(items).append(" bahan");
                if (o.optBoolean("isCod", false)) {
                    if (tail.length() > 0) tail.append("\n");
                    tail.append("COD");
                }
                row.trailing = tail.toString();

                rows.add(row);
                labels.add(row.resi + "\n" + row.meta);
                shown++;
            }
            header.setText("Bahan Datang (" + shown + ")");
            list.setAdapter(new RowAdapter());
            empty.setText("Belum ada laporan bahan datang.");
            empty.setVisibility(rows.isEmpty() ? View.VISIBLE : View.GONE);
        });
    }

    private void load() {
        header.setText("Memuat…");
        api.history(r -> {
            if (!r.ok() || r.data() == null) {
                header.setText("Riwayat Scan");
                empty.setText(r.message("Gagal memuat riwayat."));
                empty.setVisibility(View.VISIBLE);
                return;
            }
            ids.clear();
            labels.clear();
            rows.clear();
            JSONArray arr = r.data().optJSONArray("rows");
            int total = r.data().optInt("total", 0);
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o == null) continue;
                    ids.add(o.optString("id"));

                    Row row = new Row();
                    row.resi = o.optString("resi");
                    String pu = o.optString("photoUrl", "");
                    row.photoUrl = pu.isEmpty() || "null".equals(pu) ? null : pu;

                    StringBuilder meta = new StringBuilder(Format.clock(o.optString("scannedAt", null)));
                    String courier = clean(o.optString("courier", ""));
                    String device = clean(o.optString("deviceLabel", ""));
                    if (!courier.isEmpty()) meta.append("  ·  ").append(courier);
                    if (!device.isEmpty()) meta.append("  ·  ").append(device);

                    // Which shop it came from, or that nobody has said.
                    // Without this there was no way to see which rows needed
                    // the edit — so the edit went unused.
                    String shop = clean(o.optString("mappedShopName", ""));
                    String courierOf = clean(o.optString("courierConfirmed", ""));
                    if (!shop.isEmpty()) {
                        meta.append("  ·  ").append(shop);
                        if (!courierOf.isEmpty()) meta.append(" / ").append(courierOf);
                    } else {
                        meta.append("  ·  belum dipetakan");
                    }
                    row.meta = meta.toString();

                    // The trailing column answers "is this one finished with?"
                    // — mapped contents, and whether it reached an order.
                    int items = o.optInt("itemCount", 0);
                    String order = clean(o.optString("marketplaceOrderId", ""));
                    StringBuilder tail = new StringBuilder();
                    if (items > 0) tail.append(items).append(" item");
                    if (!order.isEmpty()) {
                        if (tail.length() > 0) tail.append("\n");
                        tail.append("order ✓");
                    }
                    row.trailing = tail.toString();

                    rows.add(row);
                    labels.add(row.resi + "\n" + row.meta);
                }
            }
            header.setText("Scan Resi (" + total + ")");
            list.setAdapter(new RowAdapter());
            empty.setText("Belum ada resi yang discan.");
            empty.setVisibility(rows.isEmpty() ? View.VISIBLE : View.GONE);
        });
    }

    /** Null and the literal string "null" both mean absent here. */
    private static String clean(String v) {
        return v == null || "null".equals(v) ? "" : v.trim();
    }

    private final class RowAdapter extends ArrayAdapter<Row> {
        RowAdapter() {
            super(HistoryActivity.this, R.layout.row_history, rows);
        }

        @Override public View getView(int position, View convertView, android.view.ViewGroup parent) {
            View v = convertView != null
                    ? convertView
                    : getLayoutInflater().inflate(R.layout.row_history, parent, false);
            Row row = rows.get(position);
            ((TextView) v.findViewById(R.id.rowResi)).setText(row.resi);
            ((TextView) v.findViewById(R.id.rowMeta)).setText(row.meta);
            TextView tail = v.findViewById(R.id.rowTrailing);
            tail.setText(row.trailing);
            tail.setVisibility(row.trailing.isEmpty() ? View.GONE : View.VISIBLE);
            return v;
        }
    }

    /**
     * What a tap can mean now that it can mean more than one thing.
     *
     * Origin editing is only offered for packing scans: a raw-material parcel
     * has no shop or courier of the seller's to map, and offering the choice
     * anyway would be a dead end dressed as a feature.
     */
    private void rowActions(int pos) {
        if (pos < 0 || pos >= ids.size()) return;
        if (showingDeliveries) {
            final String pid = ids.get(pos);
            new MaterialAlertDialogBuilder(this)
                    .setTitle(rows.get(pos).resi)
                    .setItems(new String[]{
                                    "Ubah bahan baku & jumlah",
                                    "Hapus laporan ini"},
                            (d, which) -> {
                                if (which == 0) editDelivery(pid);
                                else confirmDelete(pos);
                            })
                    .setNegativeButton("Batal", null)
                    .show();
            return;
        }
        final String id = ids.get(pos);
        new MaterialAlertDialogBuilder(this)
                .setTitle(rows.get(pos).resi)
                .setItems(new String[]{
                                "Lihat foto resi",
                                "Ubah isi paket (produk & jumlah)",
                                "Ubah asal paket (toko & kurir)",
                                "Hapus scan ini"},
                        (d, which) -> {
                            if (which == 0) showPhoto(pos);
                            else if (which == 1) editItems(id, pos);
                            else if (which == 2) editMapping(id, pos);
                            else confirmDelete(pos);
                        })
                .setNegativeButton("Batal", null)
                .show();
    }

    /**
     * Re-map a parcel after the fact.
     *
     * The lists and the current answer come from the server together, so the
     * sheet opens showing what was chosen rather than a blank picker that
     * quietly discards the previous decision if the packer taps Save.
     */
    /**
     * Re-map what was in the parcel, after the fact.
     *
     * Each recorded line becomes a product picker and a count. Saving walks the
     * changes one call at a time rather than replacing the lot: the server
     * reverses and re-applies the stock a line consumed on every change, so a
     * wholesale delete-and-recreate would churn the ledger for lines nobody
     * touched.
     */
    /**
     * Re-map a delivery's materials after the fact.
     *
     * Sends every line, changed or not: the server reverses the whole purchase
     * and re-applies it, so a partial payload would silently drop the lines it
     * left out along with the stock they added.
     */
    private void editDelivery(String purchaseId) {
        api.purchase(purchaseId, r -> {
            if (!r.ok() || r.data() == null) {
                Toast.makeText(this, r.message("Gagal memuat laporan."), Toast.LENGTH_LONG).show();
                return;
            }
            final JSONArray lines = r.data().optJSONArray("items");
            if (lines == null || lines.length() == 0) {
                Toast.makeText(this, "Laporan ini tidak punya baris bahan.", Toast.LENGTH_LONG).show();
                return;
            }

            api.materials(mr -> {
                if (!mr.ok() || mr.dataArray() == null) {
                    Toast.makeText(this, mr.message("Master bahan baku gagal dimuat."),
                            Toast.LENGTH_LONG).show();
                    return;
                }
                final List<String[]> mats = new ArrayList<>();   // {id, name, unit}
                final List<String> matNames = new ArrayList<>();
                JSONArray ma = mr.dataArray();
                for (int i = 0; i < ma.length(); i++) {
                    JSONObject o = ma.optJSONObject(i);
                    if (o == null) continue;
                    String unit = o.optString("unit", "");
                    if ("null".equals(unit)) unit = "";
                    mats.add(new String[]{o.optString("id"), o.optString("name"), unit});
                    matNames.add(o.optString("name") + (unit.isEmpty() ? "" : "  (" + unit + ")"));
                }

                float d = getResources().getDisplayMetrics().density;
                int pad = (int) (20 * d);
                LinearLayout root = new LinearLayout(this);
                root.setOrientation(LinearLayout.VERTICAL);
                root.setPadding(pad, pad, pad, pad);

                final List<Picker> pickers = new ArrayList<>();
                final List<EditText> pcsFields = new ArrayList<>();
                final List<EditText> contentFields = new ArrayList<>();

                for (int i = 0; i < lines.length(); i++) {
                    JSONObject it = lines.optJSONObject(i);
                    if (it == null) continue;

                    TextView label = new TextView(this);
                    label.setText("Bahan " + (i + 1));
                    label.setTextSize(11);
                    label.setPadding(0, (int) (14 * d), 0, (int) (2 * d));
                    root.addView(label);

                    Picker p = Picker.create(this, matNames, "Pilih bahan baku", "— pilih bahan —");
                    String currentId = it.optString("materialId", "");
                    for (int k = 0; k < mats.size(); k++) {
                        if (mats.get(k)[0].equals(currentId)) { p.select(k); break; }
                    }
                    root.addView(p.view(), new LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT));
                    pickers.add(p);

                    LinearLayout qtyRow = new LinearLayout(this);
                    qtyRow.setOrientation(LinearLayout.HORIZONTAL);

                    EditText pcs = new EditText(this);
                    pcs.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
                    pcs.setHint("jumlah pcs");
                    pcs.setText(it.optString("qtyPcs", "1"));
                    pcs.setSelectAllOnFocus(true);
                    qtyRow.addView(pcs, new LinearLayout.LayoutParams(0,
                            ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                    pcsFields.add(pcs);

                    EditText content = new EditText(this);
                    content.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
                    content.setHint("isi per pcs");
                    // What was typed, not what it became: someone who entered
                    // "1 kg" should see 1 when they come back, not 1000.
                    String entered = it.optString("enteredContent", "");
                    content.setText(entered.isEmpty() || "null".equals(entered)
                            ? it.optString("contentPerPcs", "1") : entered);
                    content.setSelectAllOnFocus(true);
                    qtyRow.addView(content, new LinearLayout.LayoutParams(0,
                            ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                    contentFields.add(content);

                    root.addView(qtyRow);
                }

                TextView note = new TextView(this);
                note.setTextSize(11);
                note.setPadding(0, (int) (14 * d), 0, 0);
                note.setText("Isi per pcs dihitung dalam satuan bahan di master. "
                        + "Menyimpan akan menyesuaikan stok di menu BOM.");
                root.addView(note);

                ScrollView sv = new ScrollView(this);
                sv.addView(root);

                androidx.appcompat.app.AlertDialog dlg = new MaterialAlertDialogBuilder(this)
                        .setTitle("Ubah bahan datang")
                        .setView(sv)
                        .setPositiveButton("Simpan", (dd, w) -> {
                            JSONArray out = new JSONArray();
                            for (int i = 0; i < pickers.size(); i++) {
                                int mi = pickers.get(i).selectedIndex();
                                if (mi < 0 || mi >= mats.size()) continue;
                                try {
                                    JSONObject o = new JSONObject();
                                    o.put("materialId", mats.get(mi)[0]);
                                    o.put("qtyPcs", parseOr(pcsFields.get(i), 1));
                                    o.put("contentPerPcs", parseOr(contentFields.get(i), 1));
                                    o.put("contentUnit", mats.get(mi)[2]);
                                    out.put(o);
                                } catch (Exception ignored) {}
                            }
                            if (out.length() == 0) {
                                Toast.makeText(this, "Pilih bahannya dulu.", Toast.LENGTH_LONG).show();
                                return;
                            }
                            api.updatePurchase(purchaseId, out, rr -> {
                                if (rr.ok()) {
                                    Toast.makeText(this, "Tersimpan, stok disesuaikan.",
                                            Toast.LENGTH_LONG).show();
                                    switchTo(true);
                                } else {
                                    Toast.makeText(this, rr.message("Gagal menyimpan."),
                                            Toast.LENGTH_LONG).show();
                                }
                            });
                        })
                        .setNegativeButton("Batal", null)
                        .create();
                if (dlg.getWindow() != null) {
                    dlg.getWindow().setSoftInputMode(
                            android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
                }
                dlg.show();
            });
        });
    }

    /** Blank or nonsense means the number it had; zero would erase the line. */
    private static double parseOr(EditText f, double fallback) {
        try {
            double v = Double.parseDouble(f.getText().toString().trim());
            return v > 0 ? v : fallback;
        } catch (Exception e) {
            return fallback;
        }
    }

    /** The label as photographed, full screen and zoomable. */
    private void showPhoto(int pos) {
        if (pos < 0 || pos >= rows.size()) return;
        Row row = rows.get(pos);
        if (row.photoUrl == null) {
            Toast.makeText(this, "Scan ini tidak ada fotonya.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(this, PhotoActivity.class);
        i.putExtra(PhotoActivity.EXTRA_URL, row.photoUrl);
        i.putExtra(PhotoActivity.EXTRA_TITLE, row.resi);
        startActivity(i);
    }

    private void editItems(String scanId, int pos) {
        api.scanItems(scanId, r -> {
            if (!r.ok() || r.dataArray() == null) {
                Toast.makeText(this, r.message("Gagal memuat isi paket."), Toast.LENGTH_LONG).show();
                return;
            }
            final JSONArray items = r.dataArray();
            if (items.length() == 0) {
                Toast.makeText(this,
                        "Paket ini belum punya isi. Tambahkan lewat web.",
                        Toast.LENGTH_LONG).show();
                return;
            }

            api.products(pr -> {
                if (!pr.ok() || pr.dataArray() == null) {
                    Toast.makeText(this, pr.message("Master produk gagal dimuat."),
                            Toast.LENGTH_LONG).show();
                    return;
                }
                final List<String[]> products = new ArrayList<>();  // {id, name}
                JSONArray pa = pr.dataArray();
                for (int i = 0; i < pa.length(); i++) {
                    JSONObject o = pa.optJSONObject(i);
                    if (o != null) products.add(new String[]{o.optString("id"), o.optString("name")});
                }

                float d = getResources().getDisplayMetrics().density;
                int pad = (int) (20 * d);
                LinearLayout root = new LinearLayout(this);
                root.setOrientation(LinearLayout.VERTICAL);
                root.setPadding(pad, pad, pad, pad);

                final List<String> itemIds = new ArrayList<>();
                final List<Spinner> pickers = new ArrayList<>();
                final List<EditText> qtys = new ArrayList<>();
                final List<String> originalProduct = new ArrayList<>();
                final List<String> originalQty = new ArrayList<>();

                List<String> names = new ArrayList<>();
                for (String[] p : products) names.add(p[1]);

                for (int i = 0; i < items.length(); i++) {
                    JSONObject it = items.optJSONObject(i);
                    if (it == null) continue;
                    itemIds.add(it.optString("id"));

                    TextView raw = new TextView(this);
                    String rawName = it.optString("rawName", "");
                    raw.setText(rawName.isEmpty() || "null".equals(rawName)
                            ? "Ditambahkan manual" : "Di resi: " + rawName);
                    raw.setTextSize(11);
                    raw.setPadding(0, (int) (12 * d), 0, (int) (2 * d));
                    root.addView(raw);

                    Spinner sp = new Spinner(this);
                    sp.setAdapter(new ArrayAdapter<>(this,
                            android.R.layout.simple_spinner_dropdown_item, names));
                    String current = it.optString("masterProductId", "");
                    int sel = -1;
                    for (int k = 0; k < products.size(); k++) {
                        if (products.get(k)[0].equals(current)) { sel = k; break; }
                    }
                    if (sel >= 0) sp.setSelection(sel);
                    root.addView(sp);
                    pickers.add(sp);
                    originalProduct.add(current);

                    EditText q = new EditText(this);
                    q.setInputType(InputType.TYPE_CLASS_NUMBER);
                    String qv = it.optString("qty", "1");
                    q.setText(qv);
                    q.setHint("Jumlah");
                    q.setSelectAllOnFocus(true);
                    root.addView(q, new LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT));
                    qtys.add(q);
                    originalQty.add(qv);
                }

                TextView note = new TextView(this);
                note.setTextSize(11);
                note.setPadding(0, (int) (14 * d), 0, 0);
                note.setText("Mengubah isi paket ikut menyesuaikan stok bahan baku "
                        + "yang terpakai untuk paket ini.");
                root.addView(note);

                ScrollView sv = new ScrollView(this);
                sv.addView(root);

                androidx.appcompat.app.AlertDialog dlg = new MaterialAlertDialogBuilder(this)
                        .setTitle("Isi paket")
                        .setView(sv)
                        // Alongside Save rather than buried: the reason to open
                        // the photo is to answer a question this sheet is
                        // asking, so it has to be reachable without abandoning
                        // the edit. The sheet stays open behind it.
                        .setNeutralButton("Lihat foto", (dd, w) -> showPhoto(pos))
                        .setPositiveButton("Simpan", (dd, w) -> {
                            int changed = 0;
                            for (int i = 0; i < itemIds.size(); i++) {
                                int pi = pickers.get(i).getSelectedItemPosition();
                                String newProduct = pi >= 0 && pi < products.size()
                                        ? products.get(pi)[0] : null;
                                String newQty = qtys.get(i).getText().toString().trim();

                                boolean productMoved = newProduct != null
                                        && !newProduct.equals(originalProduct.get(i));
                                boolean qtyMoved = !newQty.isEmpty()
                                        && !newQty.equals(originalQty.get(i));
                                if (!productMoved && !qtyMoved) continue;

                                Double qv = null;
                                try { qv = Double.parseDouble(newQty); } catch (Exception ignored) {}
                                if (qv != null && qv <= 0) continue;

                                changed++;
                                api.updateScanItem(scanId, itemIds.get(i),
                                        productMoved ? newProduct : null,
                                        qtyMoved ? qv : null,
                                        rr -> {
                                            if (!rr.ok()) {
                                                Toast.makeText(this,
                                                        rr.message("Sebagian baris gagal disimpan."),
                                                        Toast.LENGTH_LONG).show();
                                            }
                                        });
                            }
                            Toast.makeText(this,
                                    changed == 0 ? "Tidak ada perubahan."
                                            : changed + " baris disimpan, stok disesuaikan.",
                                    Toast.LENGTH_LONG).show();
                        })
                        .setNegativeButton("Batal", null)
                        .create();
                if (dlg.getWindow() != null) {
                    dlg.getWindow().setSoftInputMode(
                            android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
                }
                dlg.show();
            });
        });
    }

    private void editMapping(String scanId, int pos) {
        api.mappingOptions(r -> {
            if (!r.ok() || r.data() == null) {
                Toast.makeText(this, r.message("Gagal memuat daftar toko."),
                        Toast.LENGTH_LONG).show();
                return;
            }
            final List<String[]> shops = new ArrayList<>();
            JSONArray sa = r.data().optJSONArray("shops");
            if (sa != null) {
                for (int i = 0; i < sa.length(); i++) {
                    JSONObject o = sa.optJSONObject(i);
                    if (o != null) {
                        shops.add(new String[]{o.optString("id"), o.optString("name"),
                                o.optString("marketplace")});
                    }
                }
            }
            final List<String> couriers = new ArrayList<>();
            JSONArray ca = r.data().optJSONArray("couriers");
            if (ca != null) for (int i = 0; i < ca.length(); i++) couriers.add(ca.optString(i));

            float d = getResources().getDisplayMetrics().density;
            int pad = (int) (20 * d);
            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setPadding(pad, pad, pad, pad);

            TextView l1 = new TextView(this);
            l1.setText("Toko");
            l1.setTextSize(11);
            root.addView(l1);

            List<String> shopNames = new ArrayList<>();
            shopNames.add("— pilih toko —");
            for (String[] sh : shops) shopNames.add(sh[1] + "  (" + sh[2] + ")");
            final Spinner shopSpinner = new Spinner(this);
            shopSpinner.setAdapter(new ArrayAdapter<>(this,
                    android.R.layout.simple_spinner_dropdown_item, shopNames));
            root.addView(shopSpinner);

            TextView l2 = new TextView(this);
            l2.setText("Kurir");
            l2.setTextSize(11);
            l2.setPadding(0, (int) (12 * d), 0, 0);
            root.addView(l2);

            List<String> courierNames = new ArrayList<>();
            courierNames.add("— pilih kurir —");
            courierNames.addAll(couriers);
            final Spinner courierSpinner = new Spinner(this);
            courierSpinner.setAdapter(new ArrayAdapter<>(this,
                    android.R.layout.simple_spinner_dropdown_item, courierNames));
            root.addView(courierSpinner);

            new MaterialAlertDialogBuilder(this)
                    .setTitle("Asal paket")
                    .setView(root)
                    .setNeutralButton("Lihat foto", (dd, w) -> showPhoto(pos))
                    .setPositiveButton("Simpan", (dlg, w) -> {
                        int si = shopSpinner.getSelectedItemPosition();
                        int ci = courierSpinner.getSelectedItemPosition();
                        if (ci <= 0) {
                            Toast.makeText(this, "Pilih kurirnya.", Toast.LENGTH_SHORT).show();
                            return;
                        }
                        String shopId = si > 0 ? shops.get(si - 1)[0] : null;
                        String mp = si > 0 ? shops.get(si - 1)[2] : null;
                        api.confirmMapping(scanId, shopId, mp, courierNames.get(ci), rr -> {
                            if (rr.ok()) {
                                Toast.makeText(this, "Asal paket disimpan.",
                                        Toast.LENGTH_SHORT).show();
                                switchTo(false);
                            } else {
                                Toast.makeText(this, rr.message("Gagal menyimpan."),
                                        Toast.LENGTH_LONG).show();
                            }
                        });
                    })
                    .setNegativeButton("Batal", null)
                    .show();
        });
    }

    private void confirmDelete(int pos) {
        if (pos < 0 || pos >= ids.size()) return;
        final String id = ids.get(pos);

        // Say what deleting actually undoes. Both of these move stock, in
        // opposite directions, and "are you sure?" over a resi number tells
        // nobody which way the shelf is about to move.
        String what = showingDeliveries
                ? "Stok bahan baku yang ditambahkan laporan ini akan dikurangi "
                        + "kembali, dan barisnya hilang dari Pembelian Stok."
                : "Bahan baku yang terpakai untuk isi paket ini akan "
                        + "dikembalikan ke stok, dan resi ini bisa discan lagi.";

        new MaterialAlertDialogBuilder(this)
                .setTitle(showingDeliveries ? "Hapus laporan ini?" : "Hapus scan ini?")
                .setMessage(labels.get(pos) + "\n\n" + what)
                .setPositiveButton("Hapus", (d, w) -> {
                    Api.Cb after = r -> {
                        if (r.ok()) {
                            Toast.makeText(this, "Dihapus, nilai stok dikembalikan.",
                                    Toast.LENGTH_LONG).show();
                            switchTo(showingDeliveries);
                        } else {
                            Toast.makeText(this, r.message("Gagal menghapus."),
                                    Toast.LENGTH_LONG).show();
                        }
                    };
                    if (showingDeliveries) api.deletePurchase(id, after);
                    else api.delete(id, after);
                })
                .setNegativeButton("Batal", null)
                .show();
    }
}
