package id.autotoko.scanner;

import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.ListView;
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

        // A tap, not only a long press. Delete existed here from the start and
        // was reported missing, which is the same thing when the only way to
        // reach it is a gesture nothing on screen mentions.
        list.setOnItemClickListener((AdapterView<?> p, View v, int pos, long id) ->
                confirmDelete(pos));
        list.setOnItemLongClickListener((AdapterView<?> p, View v, int pos, long id) -> {
            confirmDelete(pos);
            return true;
        });

        load();
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
            header.setText("Riwayat Scan (" + total + ")");
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

    private void confirmDelete(int pos) {
        if (pos < 0 || pos >= ids.size()) return;
        final String id = ids.get(pos);
        new MaterialAlertDialogBuilder(this)
                .setTitle("Hapus scan ini?")
                .setMessage(labels.get(pos)
                        + "\n\nSetelah dihapus, resi ini bisa discan lagi.")
                .setPositiveButton("Hapus", (d, w) -> api.delete(id, r -> {
                    if (r.ok()) {
                        Toast.makeText(this, "Scan dihapus.", Toast.LENGTH_SHORT).show();
                        load();
                    } else {
                        Toast.makeText(this, r.message("Gagal menghapus."), Toast.LENGTH_LONG).show();
                    }
                }))
                .setNegativeButton("Batal", null)
                .show();
    }
}
