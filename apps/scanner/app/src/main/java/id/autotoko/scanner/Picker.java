package id.autotoko.scanner;

import android.app.Activity;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * A chooser you can type into.
 *
 * A Spinner is fine for five things and useless for eighty: the packer knows
 * the product is "Mouthspray Siwak" and has to scroll a list looking for it,
 * on a phone, one-handed, with a parcel in the other. Every long list in this
 * app is now this instead — a button showing the current choice, opening a
 * dialog with a filter box.
 *
 * Matching is on substrings of the whole name, case-insensitive, split on
 * spaces so "siwak 100" finds "Mouthspray Siwak 100ml". Not fuzzy: the person
 * typing knows what they are looking for, and fuzzy matching mostly serves to
 * put the wrong thing at the top of a short list.
 */
public final class Picker {

    public interface OnPicked { void picked(int index); }

    private final Activity activity;
    private final MaterialButton button;
    private final List<String> options;
    private final String title;
    private final String emptyLabel;
    private int selected = -1;
    private OnPicked listener;

    private Picker(Activity a, MaterialButton b, List<String> options, String title, String emptyLabel) {
        this.activity = a;
        this.button = b;
        this.options = options;
        this.title = title;
        this.emptyLabel = emptyLabel;
    }

    /**
     * Build a picker and its button in one call.
     *
     * Returns the Picker rather than the view so the caller can read the
     * selection later; the button is reachable through view().
     */
    public static Picker create(Activity a, List<String> options, String title, String emptyLabel) {
        MaterialButton b = new MaterialButton(a, null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle);
        b.setAllCaps(false);
        // Left-aligned: these read as fields, and a centred value in a
        // full-width button looks like a title rather than a choice.
        b.setGravity(android.view.Gravity.CENTER_VERTICAL | android.view.Gravity.START);
        b.setText(emptyLabel);
        Picker p = new Picker(a, b, options, title, emptyLabel);
        b.setOnClickListener(v -> p.open());
        return p;
    }

    public MaterialButton view() { return button; }

    public int selectedIndex() { return selected; }

    public void select(int index) {
        selected = index;
        button.setText(index >= 0 && index < options.size() ? options.get(index) : emptyLabel);
    }

    public void onPicked(OnPicked l) { this.listener = l; }

    private void open() {
        if (options.isEmpty()) return;

        float d = activity.getResources().getDisplayMetrics().density;
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * d);
        root.setPadding(pad, pad, pad, 0);

        final EditText search = new EditText(activity);
        search.setHint("Ketik untuk mencari…");
        search.setInputType(InputType.TYPE_CLASS_TEXT);
        search.setSingleLine(true);
        root.addView(search);

        final List<Integer> shown = new ArrayList<>();
        final List<String> visible = new ArrayList<>();
        for (int i = 0; i < options.size(); i++) {
            shown.add(i);
            visible.add(options.get(i));
        }

        final ListView list = new ListView(activity);
        final ArrayAdapter<String> adapter = new ArrayAdapter<>(
                activity, android.R.layout.simple_list_item_1, visible);
        list.setAdapter(adapter);
        // Bounded height: an unbounded ListView inside a dialog collapses to
        // nothing on some ROMs, which reads as "the list is empty".
        root.addView(list, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, (int) (360 * d)));

        final TextView none = new TextView(activity);
        none.setText("Tidak ada yang cocok.");
        none.setPadding(0, (int) (12 * d), 0, (int) (12 * d));
        none.setVisibility(android.view.View.GONE);
        root.addView(none);

        final androidx.appcompat.app.AlertDialog dlg = new MaterialAlertDialogBuilder(activity)
                .setTitle(title)
                .setView(root)
                .setNegativeButton("Batal", null)
                .create();
        if (dlg.getWindow() != null) {
            dlg.getWindow().setSoftInputMode(
                    android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }

        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable e) {
                String q = e.toString().trim().toLowerCase(Locale.ROOT);
                shown.clear();
                visible.clear();
                String[] parts = q.isEmpty() ? new String[0] : q.split("\\s+");
                for (int i = 0; i < options.size(); i++) {
                    String name = options.get(i).toLowerCase(Locale.ROOT);
                    boolean hit = true;
                    // Every word must appear somewhere, so "siwak 100" narrows
                    // rather than widening the way an OR would.
                    for (String part : parts) {
                        if (!name.contains(part)) { hit = false; break; }
                    }
                    if (hit) {
                        shown.add(i);
                        visible.add(options.get(i));
                    }
                }
                adapter.notifyDataSetChanged();
                none.setVisibility(visible.isEmpty() ? android.view.View.VISIBLE : android.view.View.GONE);
            }
        });

        list.setOnItemClickListener((p, v, pos, id) -> {
            if (pos < 0 || pos >= shown.size()) return;
            select(shown.get(pos));
            if (listener != null) listener.picked(selected);
            dlg.dismiss();
        });

        dlg.show();
    }
}
