package id.autotoko.scanner;

import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Promotion: kartu per promo yang berfokus ke PRODUK -- nama toko,
 * marketplace, lalu tiap produk dengan potongannya dan rentang tanggalnya.
 * Sumber: GET /promotion/cards (backend menggabungkan list + detail activity
 * TikTok + nama produk dari data sinkron).
 *
 * Replikasi ke toko lain = aksi ke TikTok (membuat promo & mengubah harga),
 * jadi selalu dua langkah: rencana dulu (dryRun, tidak menyentuh TikTok --
 * produk mana yang cocok di toko tujuan), baru dijalankan setelah seller
 * menekan "Jalankan".
 *
 * Promo otomatis TikTok (SmartAuto_*) tidak bisa dibaca produknya lewat API
 * (TikTok menolak, 17029028) -- ditampilkan sebagai ringkasan per toko.
 */
public class PromotionActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout list, tabs;
    private TextView status;
    private androidx.swiperefreshlayout.widget.SwipeRefreshLayout srl;
    private String filter = "";
    private float d;
    private int muatKe = 0;

    private static final String[][] FILTER = {
            {"", "Semua"}, {"ONGOING", "Berlangsung"}, {"NOT_START", "Akan datang"}, {"EXPIRED", "Berakhir"},
    };

    private int dp(int v) { return (int) (v * d); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Promotion");
        d = getResources().getDisplayMetrics().density;

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackgroundColor(getColor(R.color.canvas));

        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabs.setPadding(dp(8), dp(8), dp(8), 0);
        hs.addView(tabs);
        col.addView(hs);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(getColor(R.color.ink2));
        status.setPadding(dp(16), dp(8), dp(16), dp(4));
        col.addView(status);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(12), 0, dp(12), dp(16));
        ScrollView sv = new ScrollView(this);
        sv.addView(list);
        srl = new androidx.swiperefreshlayout.widget.SwipeRefreshLayout(this);
        srl.addView(sv, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        srl.setOnRefreshListener(this::muat);
        col.addView(srl, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(NavBawah.bungkus(this, col, NavBawah.PROMO));
        buatTab();
        muat();
    }

    private void buatTab() {
        tabs.removeAllViews();
        for (String[] f : FILTER) {
            boolean on = f[0].equals(filter);
            TextView t = new TextView(this);
            t.setText(f[1]);
            t.setTextSize(13);
            t.setTypeface(null, on ? Typeface.BOLD : Typeface.NORMAL);
            t.setTextColor(on ? getColor(R.color.on_brand) : getColor(R.color.ink2));
            t.setBackground(bulat(on ? getColor(R.color.brand) : getColor(R.color.surface), 18, true));
            t.setPadding(dp(14), dp(8), dp(14), dp(8));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            p.setMargins(dp(4), 0, dp(4), 0);
            final String kode = f[0];
            t.setOnClickListener(v -> { if (!kode.equals(filter)) { filter = kode; buatTab(); muat(); } });
            tabs.addView(t, p);
        }
    }

    private void muat() {
        final int ke = ++muatKe;
        status.setText("Memuat promo & produk dari TikTok…");
        list.removeAllViews();
        api.promoCards(filter, r -> {
            if (ke != muatKe) return; // tab sudah diganti
            srl.setRefreshing(false);
            if (r == null || !r.ok() || r.data() == null) {
                if (r != null && r.code == 403) status.setText("Promotion hanya untuk pemilik toko.");
                else status.setText(r == null ? "Gagal memuat." : r.message("Gagal memuat promo."));
                return;
            }
            gambar(r.data());
        });
    }

    private void gambar(JSONObject data) {
        list.removeAllViews();
        JSONArray cards = data.optJSONArray("cards");
        JSONArray oto = data.optJSONArray("otomatis");
        JSONArray gagal = data.optJSONArray("gagal");
        int n = cards == null ? 0 : cards.length();

        StringBuilder st = new StringBuilder(n == 0 ? "Tidak ada promo yang bisa dibaca di filter ini." : n + " promo");
        if (data.optBoolean("dipotong", false)) st.append(" (").append(data.optInt("total")).append(" total, tampil terbaru)");
        status.setText(st);

        for (int i = 0; gagal != null && i < gagal.length(); i++) {
            JSONObject g = gagal.optJSONObject(i);
            if (g != null) list.addView(catatan(g.optString("shopName") + ": gagal memuat — " + g.optString("error"), true));
        }
        if (oto != null && oto.length() > 0) {
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < oto.length(); i++) {
                JSONObject o = oto.optJSONObject(i);
                if (o == null) continue;
                if (s.length() > 0) s.append("\n");
                s.append("• ").append(o.optString("shopName")).append(": ").append(o.optInt("count")).append(" promo");
            }
            LinearLayout k = kotak();
            k.addView(teks("Promo otomatis TikTok (SmartAuto)", 13, true, R.color.attention));
            k.addView(teks(s.toString(), 12, false, R.color.ink2));
            k.addView(teks("Produk & diskonnya tidak dibuka API TikTok (ditolak: izin), jadi tidak bisa ditampilkan "
                    + "atau direplikasi. Lihat di Seller Center.", 11, false, R.color.ink3));
            list.addView(k);
        }
        for (int i = 0; i < n; i++) {
            JSONObject c = cards.optJSONObject(i);
            if (c != null) list.addView(kartu(c));
        }
    }

    /* ------------------------------------------------ kartu promo */

    private View kartu(JSONObject c) {
        LinearLayout box = kotak();
        String rentang = tgl(c.optLong("beginTime", 0)) + " – " + tgl(c.optLong("endTime", 0));

        // Kepala: toko + marketplace, lalu judul + chip status/jenis.
        LinearLayout atas = new LinearLayout(this);
        atas.setOrientation(LinearLayout.HORIZONTAL);
        atas.setGravity(Gravity.CENTER_VERTICAL);
        TextView toko = teks(c.optString("shopName", "-") + "  ·  " + namaMp(c.optString("marketplace")), 13, true, R.color.ink);
        atas.addView(toko, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        atas.addView(chip(labelStatus(c.optString("status")), "ONGOING".equalsIgnoreCase(c.optString("status"))));
        box.addView(atas);
        box.addView(teks(c.optString("title", "-"), 12, false, R.color.ink2));
        String jenis = jenis(c.optString("type")) + (c.isNull("discountSummary") ? "" : "  ·  " + c.optString("discountSummary"));
        box.addView(teks(jenis, 12, false, R.color.ink2));

        JSONArray prods = c.optJSONArray("products");
        int np = prods == null ? 0 : prods.length();
        if (!c.isNull("error") && !c.optString("error").isEmpty()) {
            box.addView(teks("Detail tidak terbaca: " + c.optString("error"), 11, false, R.color.warn));
        } else if (np == 0) {
            box.addView(teks("Tidak ada produk (promo yang sudah berakhir biasanya dikosongkan TikTok).", 11, false, R.color.ink3));
        }

        // Daftar produk: nama, potongan, rentang tanggal per item.
        String bmsm = c.isNull("discountSummary") ? null : c.optString("discountSummary");
        for (int i = 0; i < np; i++) {
            JSONObject p = prods.optJSONObject(i);
            if (p == null) continue;
            JSONArray skus = p.optJSONArray("skus");
            if (skus != null && skus.length() > 0) {
                box.addView(barisProduk(p.optString("name"), null, rentang));
                for (int k = 0; k < skus.length(); k++) {
                    JSONObject s = skus.optJSONObject(k);
                    if (s != null) box.addView(barisProduk("   ↳ " + s.optString("name"), potongan(s, bmsm), null));
                }
            } else {
                box.addView(barisProduk(p.optString("name"), potongan(p, bmsm), rentang));
            }
        }

        String stp = c.optString("status", "").toUpperCase(Locale.ROOT);
        boolean berjalan = stp.equals("ONGOING") || stp.equals("NOT_START");
        if (np > 0) {
            LinearLayout aksi = new LinearLayout(this);
            aksi.setOrientation(LinearLayout.HORIZONTAL);
            LinearLayout.LayoutParams al = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            al.topMargin = dp(8);
            MaterialButton kedua = new MaterialButton(this);
            kedua.setAllCaps(false);
            kedua.setTextSize(13);
            if (berjalan) {
                kedua.setText("Perpanjang");
                kedua.setOnClickListener(v -> perpanjang(c));
            } else {
                kedua.setText("Aktifkan kembali");
                kedua.setOnClickListener(v -> aktifkanKembali(c));
            }
            aksi.addView(kedua, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            aksi.addView(new View(this), new LinearLayout.LayoutParams(dp(8), 1));
            MaterialButton rep = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            rep.setText("Replikasi");
            rep.setAllCaps(false);
            rep.setTextSize(13);
            rep.setOnClickListener(v -> pilihTujuan(c));
            aksi.addView(rep, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            box.addView(aksi, al);
            if (berjalan) {
                MaterialButton non = new MaterialButton(this, null,
                        com.google.android.material.R.attr.materialButtonOutlinedStyle);
                non.setText("Nonaktifkan promo");
                non.setAllCaps(false);
                non.setTextSize(13);
                non.setTextColor(getColor(R.color.warn));
                non.setStrokeColor(android.content.res.ColorStateList.valueOf(getColor(R.color.warn)));
                non.setOnClickListener(v -> nonaktifkan(c));
                box.addView(non, new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            }
        } else if (berjalan) {
            MaterialButton non = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            non.setText("Nonaktifkan promo");
            non.setAllCaps(false);
            non.setTextColor(getColor(R.color.warn));
            non.setOnClickListener(v -> nonaktifkan(c));
            box.addView(non);
        } else if (!berjalan) {
            box.addView(teks("Tidak bisa diaktifkan kembali: TikTok sudah mengosongkan daftar produknya.", 11, false, R.color.ink3));
        }
        return box;
    }

    /* ------------------------------------------------ perpanjang / aktifkan kembali */

    private static final String[] PILIHAN_HARI = {"7 hari", "14 hari", "30 hari"};
    private static final int[] NILAI_HARI = {7, 14, 30};

    /** Promo berjalan/akan datang: geser tanggal selesai (UpdateActivity). */
    private void perpanjang(JSONObject c) {
        final int[] pilih = {0};
        String selesai = tgl(c.optLong("endTime", 0));
        new AlertDialog.Builder(this)
                .setTitle("Perpanjang promo (selesai sekarang " + selesai + ")")
                .setSingleChoiceItems(PILIHAN_HARI, 0, (dlg, w) -> pilih[0] = w)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Lanjut", (dlg, w) -> {
                    int hari = NILAI_HARI[pilih[0]];
                    long baru = c.optLong("endTime", 0) + hari * 86400L;
                    new AlertDialog.Builder(this)
                            .setTitle("Konfirmasi perpanjang")
                            .setMessage(c.optString("title") + "\n" + c.optString("shopName")
                                    + "\n\nSelesai: " + selesai + " → " + tgl(baru)
                                    + "\n\nPerubahan dikirim ke TikTok sekarang.")
                            .setNegativeButton("Batal", null)
                            .setPositiveButton("Perpanjang di TikTok", (d2, w2) -> kirimPerpanjang(c, hari))
                            .show();
                })
                .show();
    }

    private void kirimPerpanjang(JSONObject c, int hari) {
        Toast.makeText(this, "Mengirim ke TikTok…", Toast.LENGTH_SHORT).show();
        api.promoExtend(c.optString("shopId"), c.optString("activityId"), hari, r -> {
            if (r == null || !r.ok() || r.data() == null) {
                pesan("Gagal memperpanjang", r == null ? "Gagal." : r.message("TikTok menolak perubahan."));
                return;
            }
            JSONObject d = r.data();
            String isi = "Selesai baru: " + tgl(d.optLong("endBaru"));
            if (d.optBoolean("terverifikasi", false)) isi += "\n✓ Terverifikasi di TikTok.";
            else if (!d.isNull("endTerbaca")) isi += "\n⚠ TikTok membaca selesai " + tgl(d.optLong("endTerbaca")) + " — cek Seller Center.";
            else isi += "\nTerkirim; verifikasi belum terbaca.";
            pesan("Promo diperpanjang", isi);
        });
    }

    /**
     * Promo berakhir/nonaktif: TikTok tak punya API "aktifkan ulang", jadi
     * dibuat promo BARU di toko yang sama dengan produk & potongan identik.
     */
    private void aktifkanKembali(JSONObject c) {
        final String[] opsi = {"Durasi sama seperti sebelumnya", "7 hari", "14 hari", "30 hari"};
        final int[] nilai = {0, 7, 14, 30};
        final int[] pilih = {0};
        new AlertDialog.Builder(this)
                .setTitle("Aktifkan kembali — berapa lama?")
                .setSingleChoiceItems(opsi, 0, (dlg, w) -> pilih[0] = w)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Lanjut", (dlg, w) -> rencanaAktif(c, nilai[pilih[0]]))
                .show();
    }

    private void rencanaAktif(JSONObject c, int hari) {
        api.promoReactivate(c.optString("shopId"), c.optString("activityId"), hari, true, r -> {
            if (r == null || !r.ok() || r.data() == null) {
                pesan("Tidak bisa diaktifkan kembali", r == null ? "Gagal." : r.message("Gagal."));
                return;
            }
            JSONObject d = r.data();
            String isi = c.optString("title") + "\n" + c.optString("shopName") + " · " + jenis(c.optString("type"))
                    + "\n\n" + d.optInt("produk") + " produk dengan potongan yang sama seperti sebelumnya."
                    + "\nJadwal baru: " + tgl(d.optLong("beginTime")) + " – " + tgl(d.optLong("endTime"))
                    + "\n\nTikTok tidak bisa menghidupkan promo lama, jadi dibuat promo baru (promo lama tetap tercatat berakhir)."
                    + " Produk yang sedang ikut promo lain bisa ditolak TikTok.";
            new AlertDialog.Builder(this)
                    .setTitle("Konfirmasi aktifkan kembali")
                    .setMessage(isi)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Aktifkan di TikTok", (dlg, w) -> jalankanAktif(c, hari))
                    .show();
        });
    }

    private void jalankanAktif(JSONObject c, int hari) {
        Toast.makeText(this, "Membuat promo di TikTok…", Toast.LENGTH_SHORT).show();
        api.promoReactivate(c.optString("shopId"), c.optString("activityId"), hari, false, r -> {
            if (r == null || !r.ok() || r.data() == null) {
                pesan("Gagal mengaktifkan kembali", r == null ? "Gagal." : r.message("TikTok menolak."));
                return;
            }
            JSONObject b = r.data().optJSONObject("baru");
            if (b == null) { pesan("Selesai", "Terkirim."); return; }
            String isi = "Promo baru: " + b.optString("title") + "\nID " + b.optString("activityId");
            if (!b.isNull("terverifikasi")) {
                int v = b.optInt("terverifikasi");
                isi += "\n✓ Terverifikasi di TikTok: " + v + " dari " + b.optInt("cocok") + " produk";
                if (v < b.optInt("cocok")) isi += " — sebagian ditolak, cek Seller Center";
            } else isi += "\n" + b.optInt("cocok") + " produk terkirim (verifikasi belum terbaca)";
            if (!b.isNull("statusBaru")) isi += "\nStatus: " + labelStatus(b.optString("statusBaru"));
            JSONArray ds = b.optJSONArray("ditolakSmart");
            if (ds != null && ds.length() > 0) isi += "\n" + ds.length() + " produk dilewati: sedang dipakai Promo Otomatis TikTok";
            pesan("Promo aktif kembali", isi);
        });
    }

    /** Nonaktifkan: konfirmasi eksplisit, lalu status dibaca ulang dari TikTok. */
    private void nonaktifkan(JSONObject c) {
        new AlertDialog.Builder(this)
                .setTitle("Nonaktifkan promo?")
                .setMessage(c.optString("title") + "\n" + c.optString("shopName")
                        + "\n\nHarga produk kembali normal di TikTok. Tidak bisa dibatalkan — "
                        + "setelah ini hanya bisa \"Aktifkan kembali\" (membuat promo baru).")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Nonaktifkan di TikTok", (dlg, w) -> {
                    Toast.makeText(this, "Mengirim ke TikTok…", Toast.LENGTH_SHORT).show();
                    api.promoDeactivate(c.optString("shopId"), c.optString("activityId"), r -> {
                        if (r == null || !r.ok() || r.data() == null) {
                            pesan("Gagal menonaktifkan", r == null ? "Gagal." : r.message("TikTok menolak."));
                            return;
                        }
                        JSONObject d = r.data();
                        String isi = c.optString("title");
                        if (d.optBoolean("terverifikasi", false)) isi += "\n✓ Terverifikasi di TikTok: Dinonaktifkan.";
                        else if (!d.isNull("statusTerbaca")) isi += "\n⚠ Status terbaca di TikTok: "
                                + labelStatus(d.optString("statusTerbaca")) + " — cek Seller Center.";
                        else isi += "\nTerkirim; verifikasi belum terbaca.";
                        pesan("Promo dinonaktifkan", isi);
                    });
                })
                .show();
    }

    private void pesan(String judul, String isi) {
        // Daftar promo TikTok (search) terlambat ±1 menit dari perubahan (terukur).
        new AlertDialog.Builder(this).setTitle(judul)
                .setMessage(isi + "\n\nDaftar di halaman ini bisa terlambat ±1 menit dari TikTok — tarik ke bawah untuk muat ulang.")
                .setPositiveButton("OK", (dlg, w) -> muat()).show();
    }

    /** "-15%" / "Rp 39.000 (normal Rp 49.300)" / tier BMSM. */
    private static String potongan(JSONObject p, String bmsm) {
        double pct = p.optDouble("discountPct", Double.NaN);
        double harga = p.optDouble("activityPrice", Double.NaN);
        double normal = p.optDouble("originalPrice", Double.NaN);
        if (!Double.isNaN(pct)) {
            String s = "-" + fmtAngka(pct) + "%";
            if (!Double.isNaN(normal)) s += "  (" + rp(normal) + " → " + rp(normal * (100 - pct) / 100) + ")";
            return s;
        }
        if (!Double.isNaN(harga)) {
            String s = "Harga promo " + rp(harga);
            if (!Double.isNaN(normal) && normal > 0) s += "  (normal " + rp(normal) + ", -" + Math.round((normal - harga) / normal * 100) + "%)";
            return s;
        }
        if (bmsm != null) return "Ikut: " + bmsm + (Double.isNaN(normal) ? "" : "  · normal " + rp(normal));
        return Double.isNaN(normal) ? "-" : "normal " + rp(normal);
    }

    private View barisProduk(String nama, String diskon, String rentang) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.VERTICAL);
        r.setPadding(0, dp(6), 0, dp(6));
        TextView n = teks(nama, 13, false, R.color.ink);
        n.setMaxLines(2);
        n.setEllipsize(android.text.TextUtils.TruncateAt.END);
        r.addView(n);
        if (diskon != null || rentang != null) {
            LinearLayout b = new LinearLayout(this);
            b.setOrientation(LinearLayout.HORIZONTAL);
            if (diskon != null) {
                TextView dv = teks(diskon, 12, true, R.color.brand);
                b.addView(dv, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            } else {
                b.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1f));
            }
            if (rentang != null) b.addView(teks("📅 " + rentang, 11, false, R.color.ink3));
            r.addView(b);
        }
        View garis = new View(this);
        garis.setBackgroundColor(getColor(R.color.line));
        LinearLayout.LayoutParams gl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(1) / 2));
        gl.topMargin = dp(6);
        r.addView(garis, gl);
        return r;
    }

    /* ------------------------------------------------ replikasi */

    private void pilihTujuan(JSONObject c) {
        final String srcShop = c.optString("shopId");
        api.shops(r -> {
            JSONArray a = r == null ? null : r.dataArray();
            if (a == null) { Toast.makeText(this, "Gagal memuat daftar toko.", Toast.LENGTH_SHORT).show(); return; }
            final List<String> ids = new ArrayList<>();
            final List<String> nama = new ArrayList<>();
            for (int i = 0; i < a.length(); i++) {
                JSONObject s = a.optJSONObject(i);
                if (s == null || !"tiktok".equals(s.optString("marketplace")) || !"active".equals(s.optString("shopStatus"))) continue;
                if (s.isNull("connectedAt") || srcShop.equals(s.optString("id"))) continue;
                ids.add(s.optString("id"));
                String dn = s.isNull("displayName") || s.optString("displayName").isEmpty() ? s.optString("shopName") : s.optString("displayName");
                nama.add(dn);
            }
            if (ids.isEmpty()) { Toast.makeText(this, "Tidak ada toko TikTok lain yang terhubung.", Toast.LENGTH_LONG).show(); return; }
            final boolean[] pilih = new boolean[ids.size()];
            new AlertDialog.Builder(this)
                    .setTitle("Replikasi ke toko mana?")
                    .setMultiChoiceItems(nama.toArray(new String[0]), pilih, (dlg, w, on) -> pilih[w] = on)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Cek produk cocok", (dlg, w) -> {
                        JSONArray t = new JSONArray();
                        for (int i = 0; i < pilih.length; i++) if (pilih[i]) t.put(ids.get(i));
                        if (t.length() == 0) { Toast.makeText(this, "Pilih minimal satu toko.", Toast.LENGTH_SHORT).show(); return; }
                        rencana(c, t);
                    })
                    .show();
        });
    }

    /** Langkah 1: dryRun -- tampilkan pemetaan produk, tidak menyentuh TikTok. */
    private void rencana(JSONObject c, JSONArray targets) {
        Toast.makeText(this, "Mencocokkan produk di toko tujuan…", Toast.LENGTH_SHORT).show();
        api.promoReplicate(c.optString("shopId"), c.optString("activityId"), targets, true, r -> {
            if (r == null || !r.ok() || r.data() == null) {
                Toast.makeText(this, r == null ? "Gagal." : r.message("Gagal membuat rencana replikasi."), Toast.LENGTH_LONG).show();
                return;
            }
            JSONObject d = r.data();
            JSONArray h = d.optJSONArray("hasil");
            StringBuilder s = new StringBuilder();
            s.append("Promo: ").append(c.optString("title")).append("\n")
             .append(jenis(c.optString("type"))).append(" — potongan per produk sama dengan sumber.\n")
             .append("Jadwal baru: ").append(tgl(d.optLong("beginTime"))).append(" – ").append(tgl(d.optLong("endTime"))).append("\n");
            int adaCocok = 0;
            for (int i = 0; h != null && i < h.length(); i++) {
                JSONObject x = h.optJSONObject(i);
                if (x == null) continue;
                s.append("\n■ ").append(x.optString("shopName")).append(": ")
                 .append(x.optInt("cocok")).append(" dari ").append(x.optInt("total")).append(" produk cocok");
                if (!x.isNull("error") && !x.optString("error").isEmpty()) s.append("\n   ").append(x.optString("error"));
                if (x.optInt("cocok") > 0) adaCocok++;
                JSONArray tak = x.optJSONArray("tidakTerpetakan");
                for (int k = 0; tak != null && k < Math.min(5, tak.length()); k++) {
                    JSONObject t = tak.optJSONObject(k);
                    if (t != null) s.append("\n   ✗ ").append(potong(t.optString("name"), 48));
                }
                if (tak != null && tak.length() > 5) s.append("\n   ✗ dan ").append(tak.length() - 5).append(" lagi");
                JSONArray kb = x.optJSONArray("kembar");
                if (kb != null && kb.length() > 0) s.append("\n   ≡ ").append(kb.length())
                        .append(" produk sumber menunjuk produk yang sama di toko ini — dikirim sekali");
            }
            s.append("\n\nProduk ✗ tidak ditemukan padanannya (katalog/master produk/nama) di toko itu dan akan dilewati.");
            TextView tv = teks(s.toString(), 13, false, R.color.ink);
            tv.setPadding(dp(20), dp(8), dp(20), dp(8));
            ScrollView sc = new ScrollView(this);
            sc.addView(tv);
            AlertDialog.Builder bld = new AlertDialog.Builder(this)
                    .setTitle("Rencana replikasi")
                    .setView(sc)
                    .setNegativeButton("Batal", null);
            if (adaCocok > 0) {
                bld.setPositiveButton("Jalankan di TikTok", (dlg, w) -> jalankan(c, targets));
            }
            bld.show();
        });
    }

    /** Langkah 2: aksi outward -- membuat promo di tiap toko tujuan. */
    private void jalankan(JSONObject c, JSONArray targets) {
        Toast.makeText(this, "Membuat promo di TikTok…", Toast.LENGTH_SHORT).show();
        api.promoReplicate(c.optString("shopId"), c.optString("activityId"), targets, false, r -> {
            if (r == null || !r.ok() || r.data() == null) {
                Toast.makeText(this, r == null ? "Gagal." : r.message("Replikasi gagal."), Toast.LENGTH_LONG).show();
                return;
            }
            JSONArray h = r.data().optJSONArray("hasil");
            StringBuilder s = new StringBuilder();
            for (int i = 0; h != null && i < h.length(); i++) {
                JSONObject x = h.optJSONObject(i);
                if (x == null) continue;
                boolean ok = x.isNull("error") || x.optString("error").isEmpty();
                s.append(ok ? "✓ " : "✗ ").append(x.optString("shopName")).append(": ");
                if (ok) {
                    s.append("promo baru dibuat (ID ").append(x.optString("activityId")).append(")");
                    if (!x.isNull("terverifikasi")) {
                        int v = x.optInt("terverifikasi");
                        s.append("\n   terverifikasi di TikTok: ").append(v).append(" dari ")
                         .append(x.optInt("cocok")).append(" produk");
                        if (v < x.optInt("cocok")) s.append(" — sebagian ditolak TikTok, cek di Seller Center");
                    } else {
                        s.append("\n   ").append(x.optInt("cocok")).append(" produk dikirim (verifikasi belum terbaca)");
                    }
                    if (!x.isNull("statusBaru")) s.append("\n   status: ").append(labelStatus(x.optString("statusBaru")));
                    JSONArray ds = x.optJSONArray("ditolakSmart");
                    if (ds != null && ds.length() > 0) s.append("\n   ").append(ds.length())
                            .append(" produk dilewati: sedang dipakai Promo Otomatis TikTok");
                } else s.append(x.optString("error"));
                s.append("\n");
            }
            new AlertDialog.Builder(this)
                    .setTitle("Hasil replikasi")
                    .setMessage(s.toString().trim())
                    .setPositiveButton("OK", (dlg, w) -> muat())
                    .show();
        });
    }

    /* ------------------------------------------------ bantu */

    private static String potong(String s, int n) { return s.length() > n ? s.substring(0, n - 1) + "…" : s; }

    private static String fmtAngka(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    private static String rp(double v) {
        return "Rp " + String.format(new Locale("id", "ID"), "%,.0f", v);
    }

    private static String namaMp(String mp) {
        if ("tiktok".equals(mp)) return "TikTok Shop";
        if ("shopee".equals(mp)) return "Shopee";
        return mp == null || mp.isEmpty() ? "-" : mp;
    }

    private static String labelStatus(String s) {
        switch (s == null ? "" : s.toUpperCase(Locale.ROOT)) {
            case "ONGOING": return "Berlangsung";
            case "NOT_START": return "Akan datang";
            case "EXPIRED": return "Berakhir";
            case "DEACTIVATED": return "Dinonaktifkan";
            case "NOT_EFFECT": return "Tidak berlaku";
            case "DRAFT": return "Draf";
            default: return s == null || s.isEmpty() ? "-" : s;
        }
    }

    private static String jenis(String t) {
        switch (t == null ? "" : t.toUpperCase(Locale.ROOT)) {
            case "FIXED_PRICE": return "Harga tetap";
            case "DIRECT_DISCOUNT": return "Diskon langsung";
            case "FLASHSALE": return "Flash sale";
            case "BUY_MORE_SAVE_MORE": return "Beli banyak lebih hemat";
            default: return t == null || t.isEmpty() ? "Promo" : t;
        }
    }

    private static String tgl(long detik) {
        if (detik <= 0) return "?";
        SimpleDateFormat f = new SimpleDateFormat("dd/MM/yy", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Jakarta"));
        return f.format(new Date(detik * 1000L));
    }

    private GradientDrawable bulat(int warna, int radius, boolean garis) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(warna);
        g.setCornerRadius(dp(radius));
        if (garis) g.setStroke(Math.max(1, dp(1)), getColor(R.color.line));
        return g;
    }

    private LinearLayout kotak() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(8));
        box.setBackground(bulat(getColor(R.color.surface), 12, true));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        box.setLayoutParams(lp);
        return box;
    }

    private TextView teks(String s, int size, boolean tebal, int warnaRes) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(getColor(warnaRes));
        if (tebal) t.setTypeface(null, Typeface.BOLD);
        t.setPadding(0, dp(2), 0, 0);
        return t;
    }

    private TextView catatan(String s, boolean peringatan) {
        TextView t = teks(s, 12, false, peringatan ? R.color.warn : R.color.ink2);
        t.setPadding(dp(4), dp(8), dp(4), 0);
        return t;
    }

    private TextView chip(String s, boolean hijau) {
        TextView c = teks(s, 11, false, hijau ? R.color.ok : R.color.ink2);
        c.setBackground(bulat(getColor(hijau ? R.color.ok_bg : R.color.canvas), 10, false));
        c.setPadding(dp(8), dp(2), dp(8), dp(2));
        return c;
    }
}
