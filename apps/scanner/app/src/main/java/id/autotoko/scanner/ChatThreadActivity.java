package id.autotoko.scanner;

import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Satu percakapan: pesan pembeli & balasan (termasuk yang dikirim otomatis),
 * kolom balas + "Saran KB". Membuka layar ini menarik pesan terbaru dari TikTok
 * dan menandai dibaca (backend). Balasan yang gagal terkirim diantre & dikirim
 * ulang otomatis.
 */
public class ChatThreadActivity extends AppCompatActivity {

    private Api api;
    private String convId;
    private LinearLayout list;
    private ScrollView sv;
    private EditText input;
    private MaterialButton kirim;
    private JSONArray pesan = new JSONArray();
    private float d;

    private int dp(int v) { return (int) (v * d); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        convId = getIntent().getStringExtra("convId");
        setTitle(getIntent().getStringExtra("buyer") == null ? "Chat" : getIntent().getStringExtra("buyer"));
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        d = getResources().getDisplayMetrics().density;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackgroundColor(getColor(R.color.canvas));

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(12), dp(8), dp(12), dp(8));
        sv = new ScrollView(this);
        sv.addView(list);
        col.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), dp(6), dp(8), dp(6));
        bar.setBackgroundColor(getColor(R.color.surface));
        input = new EditText(this);
        input.setHint("Tulis balasan…");
        input.setTextSize(14);
        input.setMaxLines(4);
        bar.addView(input, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        MaterialButton saran = new MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        saran.setText("KB");
        saran.setAllCaps(false);
        saran.setOnClickListener(v -> saranKb());
        bar.addView(saran);
        kirim = new MaterialButton(this);
        kirim.setText("Kirim");
        kirim.setAllCaps(false);
        kirim.setOnClickListener(v -> balas());
        LinearLayout.LayoutParams kl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        kl.leftMargin = dp(6);
        bar.addView(kirim, kl);
        col.addView(bar);
        setContentView(col);
        muat();
    }

    @Override public boolean onSupportNavigateUp() { finish(); return true; }

    private void muat() {
        api.chatMessages(convId, r -> {
            JSONArray a = r == null ? null : r.dataArray();
            if (a == null) { Toast.makeText(this, r == null ? "Gagal." : r.message("Gagal memuat pesan."), Toast.LENGTH_SHORT).show(); return; }
            pesan = a;
            gambar();
        });
    }

    private void gambar() {
        list.removeAllViews();
        if (pesan.length() == 0) {
            TextView t = new TextView(this);
            t.setText("Belum ada pesan.");
            t.setTextColor(getColor(R.color.ink3));
            t.setGravity(Gravity.CENTER);
            t.setPadding(0, dp(40), 0, 0);
            list.addView(t);
        }
        for (int i = 0; i < pesan.length(); i++) {
            JSONObject m = pesan.optJSONObject(i);
            if (m != null) list.addView(gelembung(m));
        }
        sv.post(() -> sv.fullScroll(View.FOCUS_DOWN));
    }

    private View gelembung(JSONObject m) {
        boolean keluar = "out".equals(m.optString("direction"));
        LinearLayout baris = new LinearLayout(this);
        baris.setGravity(keluar ? Gravity.END : Gravity.START);
        baris.setPadding(0, dp(3), 0, dp(3));
        LinearLayout g = new LinearLayout(this);
        g.setOrientation(LinearLayout.VERTICAL);
        g.setPadding(dp(12), dp(8), dp(12), dp(6));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(keluar ? getColor(R.color.brand) : getColor(R.color.surface));
        bg.setCornerRadius(dp(14));
        if (!keluar) bg.setStroke(Math.max(1, dp(1)), getColor(R.color.line));
        g.setBackground(bg);
        TextView t = new TextView(this);
        t.setText(m.isNull("text") ? "(bukan teks)" : m.optString("text"));
        t.setTextSize(14);
        t.setTextColor(keluar ? getColor(R.color.on_brand) : getColor(R.color.ink));
        g.addView(t);
        String ket = ChatActivity.waktu(m.optString("createdAt", ""));
        if ("auto".equals(m.optString("sender"))) ket += " · otomatis";
        if (keluar && "queued".equals(m.optString("status"))) ket += " · diantre";
        if (keluar && "failed".equals(m.optString("status"))) ket += " · gagal terkirim";
        TextView k = new TextView(this);
        k.setText(ket);
        k.setTextSize(10);
        k.setTextColor(keluar ? 0xB3FFFFFF : getColor(R.color.ink3));
        g.addView(k);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        g.setMinimumWidth(dp(80));
        baris.addView(g, lp);
        // batasi lebar ~80% layar
        t.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.72));
        return baris;
    }

    private void saranKb() {
        String sumber = null;
        for (int i = pesan.length() - 1; i >= 0; i--) {
            JSONObject m = pesan.optJSONObject(i);
            if (m != null && "in".equals(m.optString("direction")) && !m.isNull("text")) { sumber = m.optString("text"); break; }
        }
        if (sumber == null) sumber = input.getText().toString();
        if (sumber.trim().isEmpty()) { Toast.makeText(this, "Tak ada pesan pembeli untuk dasar saran.", Toast.LENGTH_SHORT).show(); return; }
        api.kbDraft(sumber, r -> {
            JSONObject x = r != null && r.ok() ? r.data() : null;
            if (x != null && x.optBoolean("matched")) { input.setText(x.optString("reply")); Toast.makeText(this, "Draf dari KB — periksa lalu kirim.", Toast.LENGTH_SHORT).show(); }
            else Toast.makeText(this, "Tak ada saran cocok dari KB.", Toast.LENGTH_SHORT).show();
        });
    }

    private void balas() {
        String s = input.getText().toString().trim();
        if (s.isEmpty()) return;
        kirim.setEnabled(false);
        api.chatReply(convId, s, r -> {
            kirim.setEnabled(true);
            if (r == null || !r.ok() || r.data() == null) {
                Toast.makeText(this, r == null ? "Gagal." : r.message("Gagal mengirim."), Toast.LENGTH_LONG).show();
                return;
            }
            input.setText("");
            JSONObject x = r.data();
            if (x.optBoolean("sent")) Toast.makeText(this, "Terkirim ke pembeli.", Toast.LENGTH_SHORT).show();
            else Toast.makeText(this, "Belum terkirim — diantre & dikirim ulang otomatis.", Toast.LENGTH_LONG).show();
            muat();
        });
    }
}
