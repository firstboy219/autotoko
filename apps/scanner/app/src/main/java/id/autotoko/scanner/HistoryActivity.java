package id.autotoko.scanner;

import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
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
        list.setOnItemLongClickListener((AdapterView<?> p, View v, int pos, long id) -> {
            confirmDelete(pos);
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

                    StringBuilder meta = new StringBuilder(Format.clock(o.optString("scannedAt", null)));
                    String courier = clean(o.optString("courier", ""));
                    String device = clean(o.optString("deviceLabel", ""));
                    if (!courier.isEmpty()) meta.append("  ·  ").append(courier);
                    if (!device.isEmpty()) meta.append("  ·  ").append(device);
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
            confirmDelete(pos);
            return;
        }
        final String id = ids.get(pos);
        new MaterialAlertDialogBuilder(this)
                .setTitle(rows.get(pos).resi)
                .setItems(new String[]{"Ubah asal paket (toko & kurir)", "Hapus scan ini"},
                        (d, which) -> {
                            if (which == 0) editMapping(id, pos);
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
