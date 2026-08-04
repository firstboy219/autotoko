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
    private final List<String> labels = new ArrayList<>();

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_history);
        api = new Api(new Session(this));

        list = findViewById(R.id.list);
        empty = findViewById(R.id.empty);
        header = findViewById(R.id.header);
        findViewById(R.id.back).setOnClickListener(v -> finish());

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
            JSONArray rows = r.data().optJSONArray("rows");
            int total = r.data().optInt("total", 0);
            if (rows != null) {
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject o = rows.optJSONObject(i);
                    if (o == null) continue;
                    ids.add(o.optString("id"));
                    String courier = o.optString("courier", "");
                    String device = o.optString("deviceLabel", "");
                    StringBuilder sb = new StringBuilder(o.optString("resi"));
                    sb.append("\n").append(Format.clock(o.optString("scannedAt", null)));
                    if (!courier.isEmpty() && !"null".equals(courier)) sb.append("  •  ").append(courier);
                    if (!device.isEmpty() && !"null".equals(device)) sb.append("  •  ").append(device);
                    labels.add(sb.toString());
                }
            }
            header.setText("Riwayat Scan (" + total + ")");
            list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, labels));
            empty.setText("Belum ada resi yang discan.");
            empty.setVisibility(labels.isEmpty() ? View.VISIBLE : View.GONE);
        });
    }

    private void confirmDelete(int pos) {
        if (pos < 0 || pos >= ids.size()) return;
        final String id = ids.get(pos);
        new AlertDialog.Builder(this)
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
