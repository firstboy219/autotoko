package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.SwitchCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Chat Pelanggan (inbox). Sama dengan menu Chat Pelanggan di web: status izin
 * Customer Service per toko, saklar balas otomatis (Knowledge Base), dan daftar
 * percakapan. Ketuk percakapan -> ChatThreadActivity.
 */
public class ChatActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout list;
    private TextView status;
    private androidx.swiperefreshlayout.widget.SwipeRefreshLayout srl;
    private float d;
    private JSONObject izinPerToko = new JSONObject();

    private int dp(int v) { return (int) (v * d); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Chat Pelanggan");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        d = getResources().getDisplayMetrics().density;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackgroundColor(getColor(R.color.canvas));
        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(getColor(R.color.ink2));
        status.setPadding(dp(16), dp(10), dp(16), dp(4));
        col.addView(status);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(12), 0, dp(12), dp(16));
        ScrollView sv = new ScrollView(this);
        sv.addView(list);
        srl = new androidx.swiperefreshlayout.widget.SwipeRefreshLayout(this);
        srl.addView(sv, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        srl.setOnRefreshListener(this::jalankan);
        col.addView(srl, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(col);
    }

    @Override public boolean onSupportNavigateUp() { finish(); return true; }
    @Override protected void onResume() { super.onResume(); muat(); }

    /** Tarik ke bawah = satu putaran otomasi (sinkron + balas otomatis + antrean). */
    private void jalankan() {
        status.setText("Menarik chat dari TikTok…");
        api.chatRun(r -> {
            if (r != null && r.ok() && r.data() != null) {
                JSONObject x = r.data();
                Toast.makeText(this, x.optInt("percakapan") + " percakapan · " + x.optInt("pesanBaru") + " pesan baru · "
                        + x.optInt("dibalasOtomatis") + " dibalas otomatis", Toast.LENGTH_SHORT).show();
            }
            muat();
        });
    }

    private void muat() {
        api.chatStatus(rs -> {
            JSONObject st = rs != null && rs.ok() ? rs.data() : null;
            api.chatSettings(rp -> {
                JSONObject set = rp != null && rp.ok() ? rp.data() : null;
                api.chatConversations(rc -> {
                    srl.setRefreshing(false);
                    JSONArray conv = rc == null ? null : rc.dataArray();
                    gambar(st, set, conv);
                });
            });
        });
    }

    private void gambar(JSONObject st, JSONObject set, JSONArray conv) {
        list.removeAllViews();
        JSONArray izin = st == null ? null : st.optJSONArray("izin");
        int aktif = 0;
        izinPerToko = new JSONObject();
        StringBuilder daftar = new StringBuilder();
        for (int i = 0; izin != null && i < izin.length(); i++) {
            JSONObject z = izin.optJSONObject(i);
            if (z == null) continue;
            try { izinPerToko.put(z.optString("shopId"), z.optString("shopName")); } catch (Exception ignore) {}
            if (z.optBoolean("aktif")) aktif++;
            daftar.append(z.optBoolean("aktif") ? "✓ " : "✗ ").append(z.optString("shopName")).append("\n");
        }

        LinearLayout kIzin = kotak();
        kIzin.addView(teks(aktif > 0 ? "Chat TikTok tersambung di " + aktif + " toko" : "Izin chat TikTok belum aktif",
                14, true, aktif > 0 ? R.color.ok : R.color.attention));
        kIzin.addView(teks(daftar.toString().trim(), 12, false, R.color.ink2));
        if (aktif == 0) kIzin.addView(teks("Setelah izin Customer Service disetujui di Partner Center, hubungkan ulang toko "
                + "di menu Integrasi Toko. Otomasi langsung menyala.", 11, false, R.color.ink3));
        if (st != null) kIzin.addView(teks(st.optInt("otomatis7Hari") + " dibalas otomatis (7 hari) · "
                + st.optInt("antre") + " antre" + (st.optInt("gagal") > 0 ? " · " + st.optInt("gagal") + " gagal" : ""), 11, false, R.color.ink3));
        list.addView(kIzin);

        // Saklar balas otomatis (pengaturan lengkap: jam kerja, toko, pesan luar jam -> web).
        LinearLayout kAuto = kotak();
        LinearLayout baris = new LinearLayout(this);
        baris.setOrientation(LinearLayout.HORIZONTAL);
        baris.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout kiri = new LinearLayout(this);
        kiri.setOrientation(LinearLayout.VERTICAL);
        kiri.addView(teks("Balas otomatis (Knowledge Base)", 14, true, R.color.ink));
        String cakupan = "semua toko";
        JSONArray ids = set == null ? null : set.optJSONArray("autoReplyShopIds");
        if (ids != null && ids.length() > 0) {
            StringBuilder n = new StringBuilder();
            for (int i = 0; i < ids.length(); i++) { if (n.length() > 0) n.append(", "); n.append(izinPerToko.optString(ids.optString(i), "?")); }
            cakupan = n.toString();
        }
        kiri.addView(teks("Berlaku: " + cakupan + ". Jam kerja & pesan luar jam diatur di web.", 11, false, R.color.ink3));
        baris.addView(kiri, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        SwitchCompat sw = new SwitchCompat(this);
        sw.setChecked(set != null && set.optBoolean("autoReply", false));
        sw.setOnCheckedChangeListener((v, on) -> {
            JSONObject body = new JSONObject();
            try { body.put("autoReply", on); } catch (Exception ignore) {}
            api.chatSaveSettings(body, r -> {
                boolean ok = r != null && r.ok();
                Toast.makeText(this, ok ? (on ? "Balas otomatis AKTIF" : "Balas otomatis mati")
                        : (r == null ? "Gagal." : r.message("Gagal menyimpan (migrasi 0081 sudah dijalankan?)")), Toast.LENGTH_LONG).show();
                if (!ok) sw.setChecked(!on);
            });
        });
        baris.addView(sw);
        kAuto.addView(baris);
        list.addView(kAuto);

        // Percakapan
        int n = conv == null ? 0 : conv.length();
        status.setText(n == 0 ? "Belum ada percakapan · tarik ke bawah untuk menarik chat" : n + " percakapan · tarik ke bawah untuk menarik chat");
        for (int i = 0; i < n; i++) {
            JSONObject c = conv.optJSONObject(i);
            if (c == null) continue;
            list.addView(kartu(c));
        }
    }

    private View kartu(JSONObject c) {
        LinearLayout box = kotak();
        box.setClickable(true);
        LinearLayout atas = new LinearLayout(this);
        atas.setOrientation(LinearLayout.HORIZONTAL);
        atas.setGravity(Gravity.CENTER_VERTICAL);
        String nama = c.isNull("buyerName") ? "Pembeli" : c.optString("buyerName", "Pembeli");
        atas.addView(teks(nama, 14, true, R.color.ink), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        int unread = c.optInt("unread", 0);
        if (unread > 0) {
            TextView b = teks(String.valueOf(unread), 11, true, R.color.white);
            GradientDrawable g = new GradientDrawable();
            g.setColor(getColor(R.color.warn));
            g.setCornerRadius(dp(10));
            b.setBackground(g);
            b.setPadding(dp(7), dp(1), dp(7), dp(1));
            atas.addView(b);
        }
        box.addView(atas);
        TextView last = teks(c.isNull("lastMessage") ? "—" : c.optString("lastMessage"), 12, false, R.color.ink2);
        last.setMaxLines(2);
        last.setEllipsize(android.text.TextUtils.TruncateAt.END);
        box.addView(last);
        String toko = c.isNull("shopId") ? "" : izinPerToko.optString(c.optString("shopId"), "");
        box.addView(teks((toko.isEmpty() ? "" : toko + " · ") + waktu(c.optString("lastMessageAt", "")), 11, false, R.color.ink3));
        box.setOnClickListener(v -> {
            Intent i = new Intent(this, ChatThreadActivity.class);
            i.putExtra("convId", c.optString("id"));
            i.putExtra("buyer", nama);
            startActivity(i);
        });
        return box;
    }

    static String waktu(String iso) {
        if (iso == null || iso.length() < 19 || "null".equals(iso)) return "";
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date dt = in.parse(iso.substring(0, 19));
            SimpleDateFormat out = new SimpleDateFormat("dd/MM HH:mm", Locale.US);
            out.setTimeZone(TimeZone.getTimeZone("Asia/Jakarta"));
            return out.format(dt);
        } catch (Exception e) { return ""; }
    }

    private LinearLayout kotak() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable g = new GradientDrawable();
        g.setColor(getColor(R.color.surface));
        g.setCornerRadius(dp(12));
        g.setStroke(Math.max(1, dp(1)), getColor(R.color.line));
        box.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        box.setLayoutParams(lp);
        return box;
    }

    private TextView teks(String s, int size, boolean tebal, int warna) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(getColor(warna));
        if (tebal) t.setTypeface(null, Typeface.BOLD);
        t.setPadding(0, dp(2), 0, 0);
        return t;
    }
}
