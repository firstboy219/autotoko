package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * What is not finished, on the screen the person who can finish it is holding.
 *
 * The web has the same list, and the web is not where the packing bench is. The
 * largest item by far is resi with no shop — sixty-five of them — and mapping a
 * resi is something this phone can now do, so putting the list here turns a
 * report into a route.
 *
 * Tasks that cannot be done from a phone are still shown, and say so. Hiding
 * them would make the count on this screen disagree with the count on the web,
 * and two numbers for one question is worse than one number with a caveat.
 */
public class PendingActivity extends AppCompatActivity {

    private ListView list;
    private TextView empty, header;
    private Api api;

    private final List<Task> tasks = new ArrayList<>();

    /** One kind of incomplete data. */
    private static final class Task {
        String key;
        String title;
        String why;
        String severity;
        int count;
        List<String> samples = new ArrayList<>();
        /** True when this phone can actually do something about it. */
        boolean actionableHere;
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_pending);
        api = new Api(new Session(this));

        list = findViewById(R.id.list);
        empty = findViewById(R.id.empty);
        header = findViewById(R.id.header);
        findViewById(R.id.back).setOnClickListener(v -> finish());

        list.setOnItemClickListener((AdapterView<?> p, View v, int pos, long id) -> open(pos));

        load();
    }

    @Override protected void onResume() {
        super.onResume();
        // Coming back from the history screen after mapping a few: the counts
        // should reflect the work just done rather than the state on arrival.
        if (!tasks.isEmpty()) load();
    }

    private void load() {
        header.setText("Memuat…");
        api.pendingTasks(r -> {
            tasks.clear();
            if (!r.ok() || r.data() == null) {
                header.setText("Data Belum Lengkap");
                empty.setText(r.message("Gagal memuat daftar."));
                empty.setVisibility(View.VISIBLE);
                list.setAdapter(new TaskAdapter());
                return;
            }

            int total = r.data().optInt("total", 0);
            JSONArray arr = r.data().optJSONArray("tasks");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o == null) continue;
                    Task t = new Task();
                    t.key = o.optString("key");
                    t.title = o.optString("title");
                    t.why = o.optString("why");
                    t.severity = o.optString("severity", "medium");
                    t.count = o.optInt("count", 0);
                    // Only these two have a screen on the phone that can fix
                    // them. Recipes and shop categories are web work, and
                    // pretending otherwise would send somebody to a dead end.
                    t.actionableHere = "scan_origin".equals(t.key) || "scan_items".equals(t.key);
                    JSONArray s = o.optJSONArray("samples");
                    if (s != null) {
                        for (int j = 0; j < s.length() && j < 3; j++) {
                            JSONObject so = s.optJSONObject(j);
                            if (so != null) t.samples.add(so.optString("label"));
                        }
                    }
                    tasks.add(t);
                }
            }

            header.setText(total == 0 ? "Semua Lengkap" : "Data Belum Lengkap (" + total + ")");
            list.setAdapter(new TaskAdapter());
            empty.setText("Tidak ada data yang perlu dilengkapi.");
            empty.setVisibility(tasks.isEmpty() ? View.VISIBLE : View.GONE);
        });
    }

    /**
     * Take the packer where the work is, or say plainly that it is not here.
     *
     * A row that opens nothing and explains nothing is worse than a row that
     * says "this one is done on the web" — the second answers the question the
     * tap was asking.
     */
    private void open(int pos) {
        if (pos < 0 || pos >= tasks.size()) return;
        Task t = tasks.get(pos);

        if (t.actionableHere) {
            Toast.makeText(this,
                    "scan_origin".equals(t.key)
                            ? "Cari baris bertanda \"belum dipetakan\", lalu ketuk untuk mengisi toko."
                            : "Buka resi yang isinya belum lengkap dari daftar ini.",
                    Toast.LENGTH_LONG).show();
            startActivity(new Intent(this, HistoryActivity.class));
            return;
        }

        new MaterialAlertDialogBuilder(this)
                .setTitle(t.title)
                .setMessage(t.why + "\n\nBagian ini dikerjakan lewat web, bukan dari HP.")
                .setPositiveButton("Mengerti", null)
                .show();
    }

    private final class TaskAdapter extends ArrayAdapter<Task> {
        TaskAdapter() {
            super(PendingActivity.this, R.layout.row_pending, tasks);
        }

        @Override public View getView(int position, View convertView, ViewGroup parent) {
            View v = convertView != null
                    ? convertView
                    : getLayoutInflater().inflate(R.layout.row_pending, parent, false);
            Task t = tasks.get(position);

            ((TextView) v.findViewById(R.id.rowTitle)).setText(t.title);

            TextView count = v.findViewById(R.id.rowCount);
            count.setText(String.valueOf(t.count));
            // Colour carries the same ranking the server sent, so the eye lands
            // on what costs most rather than on what is most numerous.
            count.setTextColor(Color.parseColor(
                    "high".equals(t.severity) ? "#B3261E"
                            : "medium".equals(t.severity) ? "#B26A00" : "#6B7178"));

            StringBuilder body = new StringBuilder(t.why);
            if (!t.samples.isEmpty()) {
                body.append("\n\nContoh: ").append(String.join(", ", t.samples));
            }
            body.append(t.actionableHere ? "\n\nKetuk untuk memperbaiki di HP."
                    : "\n\nDikerjakan lewat web.");
            ((TextView) v.findViewById(R.id.rowWhy)).setText(body.toString());
            return v;
        }
    }
}
