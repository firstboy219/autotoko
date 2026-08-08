package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Stock control the way it can actually be done: from in front of the rack.
 *
 * Nobody weighs the glycerine before packing, so a numeric stock figure drifts
 * out of date the first busy week and then quietly lies. What a packer CAN say
 * without counting anything is which of five buckets a material is in, and
 * that is enough for the only decision this feeds: order today by courier,
 * order this week by COD, or do nothing.
 *
 * The five are not evenly spaced on purpose. The gap that matters is between
 * "cukup" and "normal" — one means start ordering the slow cheap way, the
 * other means leave it alone — so collapsing the middle would turn every
 * reading into either panic or silence.
 */
public class StockActivity extends AppCompatActivity {

    /** Server values, in the order shown. Must match STOCK_LEVELS on the API. */
    static final String[] LEVELS = {"habis", "hampir_habis", "cukup", "normal", "banyak"};

    static final String[] LEVEL_LABELS = {
            "Habis",
            "Hampir habis",
            "Cukup",
            "Normal",
            "Masih banyak",
    };

    /** What to do about each level. Only the first three reach WhatsApp. */
    static final String[] LEVEL_ACTION = {
            "sudah kosong — restock instan/sameday hari ini",
            "restock instan/sameday sekarang",
            "mulai restock COD (±3 hari)",
            "aman seminggu ke depan",
            "stok masih banyak",
    };

    /** Levels at or below this index are the ones worth telling a supplier about. */
    private static final int SHARE_UP_TO = 2;

    private Session session;
    private Api api;
    private LinearLayout list;
    private TextView empty;
    private final List<Item> items = new ArrayList<>();

    private static final class Item {
        String id;
        String name;
        String unit;
        int level = -1;
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("Kontrol Stok Bahan Baku");
        title.setTextSize(18);
        title.setTextColor(Color.parseColor("#1B1D1F"));
        title.setPadding(pad, pad, pad, (int) (4 * d));
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Pilih kondisi tiap bahan sesuai yang terlihat di rak. Tersimpan otomatis.");
        sub.setTextSize(12);
        sub.setTextColor(Color.parseColor("#6B7178"));
        sub.setPadding(pad, 0, pad, pad);
        root.addView(sub);

        empty = new TextView(this);
        empty.setText("Memuat…");
        empty.setTextSize(13);
        empty.setTextColor(Color.parseColor("#6B7178"));
        empty.setPadding(pad, pad, pad, pad);
        root.addView(empty);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(list);
        LinearLayout.LayoutParams grow = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(scroll, grow);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(pad, (int) (8 * d), pad, pad);

        MaterialButton share = new MaterialButton(this);
        share.setText("Bagikan ke WhatsApp");
        share.setAllCaps(false);
        share.setOnClickListener(v -> share());
        bar.addView(share, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        MaterialButton close = new MaterialButton(this);
        close.setText("Tutup");
        close.setAllCaps(false);
        close.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams closeLp =
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        closeLp.leftMargin = (int) (8 * d);
        bar.addView(close, closeLp);

        root.addView(bar);
        setContentView(root);

        load();
    }

    private void load() {
        api.materials(r -> {
            if (!r.ok() || r.body == null) {
                empty.setText("Gagal memuat bahan baku: " + r.message("coba lagi nanti"));
                return;
            }
            JSONArray arr = r.body.optJSONArray("data");
            items.clear();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o == null) continue;
                    Item it = new Item();
                    it.id = o.optString("id", "");
                    if (it.id.isEmpty()) continue;
                    it.name = o.optString("name", "-");
                    it.unit = o.optString("unit", "");
                    it.level = indexOf(o.optString("stockLevel", null));
                    items.add(it);
                }
            }
            render();
        });
    }

    static int indexOf(String level) {
        if (level == null) return -1;
        for (int i = 0; i < LEVELS.length; i++) if (LEVELS[i].equals(level)) return i;
        return -1;
    }

    private void render() {
        list.removeAllViews();
        if (items.isEmpty()) {
            empty.setText("Belum ada bahan baku. Tambahkan lewat menu BOM di web.");
            return;
        }
        empty.setVisibility(View.GONE);

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);

        for (final Item it : items) {
            // Inflated rather than assembled by hand, so this list and the
            // history list are laid out by the same file instead of by two
            // sets of numbers that drifted apart.
            View row = getLayoutInflater().inflate(R.layout.row_stock, list, false);
            ((TextView) row.findViewById(R.id.stockName)).setText(it.name);
            TextView unitLine = row.findViewById(R.id.stockUnit);
            unitLine.setText(it.unit == null || it.unit.isEmpty() ? "" : "satuan: " + it.unit);
            unitLine.setVisibility(it.unit == null || it.unit.isEmpty() ? View.GONE : View.VISIBLE);

            List<String> options = new ArrayList<>();
            options.add("— belum diisi —");
            for (String label : LEVEL_LABELS) options.add(label);

            Spinner spinner = row.findViewById(R.id.stockLevel);
            spinner.setAdapter(new ArrayAdapter<>(
                    this, android.R.layout.simple_spinner_dropdown_item, options));
            spinner.setSelection(it.level + 1);
            spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                    int next = pos - 1;
                    if (next == it.level || next < 0) return;
                    it.level = next;
                    save(it);
                }
                @Override public void onNothingSelected(AdapterView<?> p) {}
            });
            list.addView(row);

            View line = new View(this);
            line.setBackgroundColor(Color.parseColor("#E7E9EC"));
            list.addView(line, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, (int) d)));
        }
    }

    /**
     * Saved the moment it is picked, one material at a time.
     *
     * No Save button: a packer walking the rack sets one, moves on, and would
     * lose the lot to a mistyped step or a locked screen. A failed write says
     * so and leaves the choice on screen so it can be tried again.
     */
    private void save(Item it) {
        api.setStockLevel(it.id, LEVELS[it.level], r -> {
            if (!r.ok()) {
                Toast.makeText(this, "Gagal menyimpan " + it.name + ": "
                        + r.message("coba lagi"), Toast.LENGTH_SHORT).show();
            }
        });
    }

    /**
     * The message a supplier can act on.
     *
     * Only the three levels that need buying. "Normal" and "masih banyak" are
     * the answer to a question nobody asked, and padding the list with them is
     * how a restock message stops being read.
     */
    String buildMessage() {
        StringBuilder sb = new StringBuilder("*Kebutuhan Restock Bahan Baku*\n");
        sb.append(new java.text.SimpleDateFormat("d MMM yyyy", new java.util.Locale("id", "ID"))
                .format(new java.util.Date())).append("\n");

        int found = 0;
        for (int level = 0; level <= SHARE_UP_TO; level++) {
            List<String> names = new ArrayList<>();
            for (Item it : items) if (it.level == level) names.add(it.name);
            if (names.isEmpty()) continue;
            found += names.size();
            sb.append("\n*").append(LEVEL_LABELS[level].toUpperCase())
              .append("* — ").append(LEVEL_ACTION[level]).append("\n");
            for (String n : names) sb.append("• ").append(n).append("\n");
        }
        if (found == 0) return null;
        return sb.toString();
    }

    private void share() {
        String text = buildMessage();
        if (text == null) {
            Toast.makeText(this,
                    "Tidak ada bahan yang perlu direstock. Isi dulu kondisi bahannya.",
                    Toast.LENGTH_LONG).show();
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        try {
            // Straight to WhatsApp when it is installed, which is the whole
            // point; the chooser is the fallback rather than the default so the
            // common case is one tap.
            send.setPackage("com.whatsapp");
            startActivity(send);
        } catch (Exception e) {
            send.setPackage(null);
            startActivity(Intent.createChooser(send, "Bagikan lewat"));
        }
    }
}
