package id.autotoko.scanner;

import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;

import org.json.JSONObject;

/**
 * Cek Resi / Pembatalan (fulfillment/packing).
 *
 * Scan (pakai alat scan yang mengetik lalu Enter) atau ketik nomor resi →
 * status INSTAN: DIBATALKAN (merah, jangan dikirim) / AMAN (hijau), plus apakah
 * resinya sudah pernah dicetak. Field dikosongkan otomatis tiap selesai supaya
 * bisa scan beruntun.
 */
public class CekResiActivity extends AppCompatActivity {

    private Api api;
    private float d;
    private EditText input;
    private LinearLayout hasilBox;

    private int dp(int v) { return (int) (v * d); }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        d = getResources().getDisplayMetrics().density;
        setTitle("Cek Resi / Pembatalan");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        ScrollView sc = new ScrollView(this);
        sc.setBackgroundColor(getColor(R.color.canvas));
        sc.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = dp(16);
        root.setPadding(p, p, p, dp(24));
        sc.addView(root);
        setContentView(sc);

        TextView hint = new TextView(this);
        hint.setText("Scan (alat scan) atau ketik nomor resi lalu tekan Enter/Cek. Cek instan status pembatalan & apakah resi sudah pernah dicetak.");
        hint.setTextSize(13);
        hint.setTextColor(getColor(R.color.ink2));
        root.addView(hint);

        input = new EditText(this);
        input.setHint("Nomor resi / AWB…");
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        input.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        input.setOnEditorActionListener((v, a, e) -> { cek(); return true; });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        root.addView(input, lp);

        MaterialButton cek = new MaterialButton(this);
        cek.setText("Cek");
        cek.setAllCaps(false);
        cek.setOnClickListener(v -> cek());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = dp(8);
        root.addView(cek, bp);

        hasilBox = new LinearLayout(this);
        hasilBox.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.topMargin = dp(16);
        root.addView(hasilBox, hp);

        input.requestFocus();
    }

    private void cek() {
        final String q = input.getText().toString().trim();
        if (q.isEmpty()) return;
        api.lookupResi(q, r -> {
            if (r == null || !r.ok() || r.data() == null) {
                Toast.makeText(this, r == null ? "Gagal" : r.message("Gagal cek resi"), Toast.LENGTH_LONG).show();
                return;
            }
            tampil(q, r.data());
            input.setText("");
            input.requestFocus();
        });
    }

    private void tampil(String resi, JSONObject o) {
        hasilBox.removeAllViews();
        boolean found = o.optBoolean("found", false);
        boolean cancelled = o.optBoolean("cancelled", false);
        int bg, fg;
        String judul;
        if (!found) { bg = 0xFFEFEFEF; fg = 0xFF555555; judul = "Resi tidak ditemukan"; }
        else if (cancelled) { bg = 0xFFFDE8E8; fg = 0xFFB3261E; judul = "DIBATALKAN — JANGAN dikirim"; }
        else { bg = 0xFFE6F4EA; fg = 0xFF1B7F4B; judul = "AMAN — boleh diproses"; }

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.VERTICAL);
        head.setBackgroundColor(bg);
        head.setPadding(dp(16), dp(16), dp(16), dp(16));
        head.setGravity(Gravity.CENTER);
        TextView t = new TextView(this);
        t.setText(judul);
        t.setTextSize(18);
        t.setTypeface(null, Typeface.BOLD);
        t.setTextColor(fg);
        t.setGravity(Gravity.CENTER);
        head.addView(t);
        TextView rr = new TextView(this);
        rr.setText(resi);
        rr.setTextSize(12);
        rr.setTextColor(fg);
        rr.setGravity(Gravity.CENTER);
        head.addView(rr);
        hasilBox.addView(head);

        if (found) {
            hasilBox.addView(kv("Order", o.optString("marketplaceOrderId", "-")));
            hasilBox.addView(kv("Pembeli", o.optString("buyerName", "-")));
            hasilBox.addView(kv("Toko", o.optString("shopName", "-")));
            hasilBox.addView(kv("Status", o.optString("fulfillmentStatus", "-")));
            hasilBox.addView(kv("Resi dicetak", o.optBoolean("labelPrinted", false) ? "SUDAH dicetak" : "belum"));
        }
    }

    private LinearLayout kv(String k, String v) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(dp(4), dp(6), dp(4), dp(6));
        TextView a = new TextView(this);
        a.setText(k);
        a.setTextSize(12);
        a.setTextColor(getColor(R.color.ink2));
        r.addView(a, new LinearLayout.LayoutParams(dp(110), ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView b = new TextView(this);
        b.setText(v);
        b.setTextSize(13);
        b.setTextColor(getColor(R.color.ink));
        r.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return r;
    }
}
