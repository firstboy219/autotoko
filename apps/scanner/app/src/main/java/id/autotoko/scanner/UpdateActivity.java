package id.autotoko.scanner;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Versi aplikasi: apa yang terpasang, apa yang tersedia, dan cara pindah.
 *
 * APK ini dibagikan di luar Play Store, jadi tidak ada yang memberi tahu
 * pemakainya kalau ada versi baru -- selama ini satu-satunya cara tahu adalah
 * membuka halaman web di komputer. Layar ini memindahkan pertanyaan itu ke
 * tempat pertanyaannya muncul.
 *
 * Yang diunduh SELALU diperiksa sha256-nya terhadap yang dicatat server sebelum
 * pemasang Android dipanggil. Berkas 34 MB lewat wifi gudang bisa terpotong,
 * dan APK terpotong gagal pasang dengan pesan yang menyalahkan aplikasinya,
 * bukan unduhannya. Ini juga sekalian menutup celah unduhan yang dibelokkan:
 * yang dipasang harus persis yang dibangun.
 */
public class UpdateActivity extends AppCompatActivity {

    private static final int REQ_IZIN_PASANG = 4101;

    /** Nama tetap: satu unduhan tertahan, bukan menumpuk 34 MB tiap dicoba. */
    private static final String NAMA_BERKAS = "pembaruan.apk";

    private static final String[] BULAN = {
        "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
        "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
    };

    private final Handler main = new Handler(Looper.getMainLooper());

    private Api api;
    private Session session;

    private TextView status;
    private LinearLayout kartu;
    private LinearLayout riwayat;
    private MaterialButton aksi;
    private ProgressBar bar;
    private TextView progres;

    private int kodeTerpasang;
    private String namaTerpasang = "?";

    /** Rilis yang ditawarkan server. Null selama belum dimuat atau gagal. */
    private JSONObject terbaru;
    private File berkas;
    private boolean sibuk = false;
    /** Unduhan sudah ada dan sha256-nya cocok, tinggal dipasang. */
    private boolean siapPasang = false;

    /**
     * Sudah ditawari pembaruan sekali sejak aplikasi ini dibuka.
     *
     * Sekali per proses, bukan sekali per layar: layar beranda dibuat ulang
     * tiap kali orang kembali ke sana, dan dialog yang muncul tiap kali akan
     * diketuk "Nanti" tanpa pernah dibaca.
     */
    private static boolean sudahDitawari = false;

    static int versiKode(android.content.Context c) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? (int) pi.getLongVersionCode()
                    : pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    static String versiNama(android.content.Context c) {
        try {
            String n = c.getPackageManager()
                    .getPackageInfo(c.getPackageName(), 0).versionName;
            return n == null ? "?" : n;
        } catch (Exception e) {
            return "?";
        }
    }

    /**
     * Tawarkan pembaruan begitu aplikasi dibuka, kalau ada yang lebih baru.
     *
     * Dipanggil dari layar beranda, bukan dari layar login: HP gudang tetap
     * masuk berhari-hari, jadi pemeriksaan yang hanya jalan saat login
     * sungguhan nyaris tidak pernah jalan.
     *
     * Gagal memeriksa didiamkan. Server yang tak terjangkau bukan alasan untuk
     * menghalangi orang yang sedang memegang paket -- dan APK yang tertinggal
     * satu versi masih bisa bekerja, sedangkan yang tidak bisa membuka layar
     * sama sekali tidak.
     */
    static void periksaSekali(final Activity a, Api api) {
        if (sudahDitawari) return;
        sudahDitawari = true;
        final int terpasang = versiKode(a);
        api.appReleases(r -> {
            if (!r.ok() || r.data() == null) return;
            JSONObject cur = r.data().optJSONObject("current");
            if (cur == null) return;
            if (cur.optInt("versionCode", 0) <= terpasang) return;
            if (a.isFinishing() || a.isDestroyed()) return;

            StringBuilder p = new StringBuilder();
            p.append("Scan Resi ").append(cur.optString("versionName", ""))
             .append(" sudah terbit.\n");
            p.append("Versi di HP ini: ").append(versiNama(a)).append(".");
            String catatan = cur.optString("notes", "");
            if (!catatan.isEmpty() && !"null".equals(catatan)) {
                p.append("\n\n").append(catatan);
            }

            new MaterialAlertDialogBuilder(a)
                    .setTitle("Versi baru tersedia")
                    .setMessage(p.toString())
                    // Tidak bisa ditutup dengan mengetuk di luar kotak: satu
                    // ketukan tak sengaja tidak boleh terhitung sebagai
                    // "nanti saja".
                    .setCancelable(false)
                    .setPositiveButton("Perbarui Sekarang",
                            (d, w) -> a.startActivity(new Intent(a, UpdateActivity.class)))
                    .setNegativeButton("Nanti", null)
                    .show();
        });
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        setTitle("Versi Aplikasi");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        // Dibaca lewat pembantu yang sama dengan pemeriksa di beranda, supaya
        // tidak ada dua cara membaca versi yang bisa menyimpang satu sama lain.
        namaTerpasang = versiNama(this);
        kodeTerpasang = versiKode(this);
        berkas = new File(getExternalFilesDir(null), NAMA_BERKAS);

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView judul = new TextView(this);
        judul.setTextSize(18);
        judul.setTextColor(Color.parseColor("#1B1D1F"));
        judul.setText("Scan Resi " + namaTerpasang);
        root.addView(judul);

        TextView sub = new TextView(this);
        sub.setTextSize(11);
        sub.setTextColor(Color.parseColor("#9AA0A6"));
        sub.setPadding(0, (int) (2 * d), 0, (int) (14 * d));
        sub.setText("Versi terpasang di HP ini (build " + kodeTerpasang + ")");
        root.addView(sub);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(Color.parseColor("#6B7178"));
        status.setText("Memeriksa versi terbaru...");
        root.addView(status);

        kartu = new LinearLayout(this);
        kartu.setOrientation(LinearLayout.VERTICAL);
        kartu.setPadding(pad, pad, pad, pad);
        kartu.setVisibility(android.view.View.GONE);
        LinearLayout.LayoutParams lpKartu = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lpKartu.topMargin = (int) (12 * d);
        root.addView(kartu, lpKartu);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setVisibility(android.view.View.GONE);
        LinearLayout.LayoutParams lpBar = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lpBar.topMargin = (int) (12 * d);
        root.addView(bar, lpBar);

        progres = new TextView(this);
        progres.setTextSize(11);
        progres.setTextColor(Color.parseColor("#6B7178"));
        progres.setVisibility(android.view.View.GONE);
        root.addView(progres);

        aksi = new MaterialButton(this);
        aksi.setAllCaps(false);
        aksi.setText("Unduh & Pasang");
        aksi.setVisibility(android.view.View.GONE);
        aksi.setOnClickListener(v -> {
            if (siapPasang) pasang();
            else unduh();
        });
        LinearLayout.LayoutParams lpAksi = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lpAksi.topMargin = (int) (12 * d);
        root.addView(aksi, lpAksi);

        TextView labelRiwayat = new TextView(this);
        labelRiwayat.setTextSize(11);
        labelRiwayat.setTextColor(Color.parseColor("#9AA0A6"));
        labelRiwayat.setPadding(0, (int) (22 * d), 0, (int) (4 * d));
        labelRiwayat.setText("RIWAYAT VERSI");
        root.addView(labelRiwayat);

        riwayat = new LinearLayout(this);
        riwayat.setOrientation(LinearLayout.VERTICAL);
        root.addView(riwayat);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);

        muat();
    }

    // ---------------------------------------------------------------- memuat

    private void muat() {
        api.appReleases(r -> {
            if (!r.ok() || r.data() == null) {
                status.setText(r.message("Tidak bisa memeriksa versi terbaru."));
                return;
            }
            JSONObject d = r.data();
            terbaru = d.optJSONObject("current");
            gambar(d.optJSONArray("releases"));
        });
    }

    private void gambar(JSONArray semua) {
        if (terbaru == null) {
            status.setText("Server belum menerbitkan versi apa pun.");
            return;
        }
        int kode = terbaru.optInt("versionCode", 0);
        String nama = terbaru.optString("versionName", "?");
        boolean ada = kode > kodeTerpasang;

        status.setText(ada
                ? "Versi baru tersedia: " + nama
                : "Aplikasi sudah versi terbaru.");
        status.setTextColor(Color.parseColor(ada ? "#8A5A00" : "#1B7F4B"));

        if (ada) {
            kartu.setVisibility(android.view.View.VISIBLE);
            kartu.setBackgroundColor(Color.parseColor("#FBF0DC"));
            kartu.removeAllViews();
            baris(kartu, "Versi " + nama, 15, "#1B1D1F", true);
            baris(kartu, tanggal(terbaru.optString("publishedAt", "")) + " · "
                    + ukuran(terbaru.optLong("sizeBytes", 0)), 11, "#6B7178", false);
            String catatan = terbaru.optString("notes", "");
            if (!catatan.isEmpty()) baris(kartu, catatan, 13, "#1B1D1F", false);

            aksi.setVisibility(android.view.View.VISIBLE);
            // Berkas dari percobaan sebelumnya masih ada? Jangan tarik 34 MB
            // lagi kalau isinya memang sudah yang ini.
            periksaUnduhanLama();
        } else {
            // Sisa unduhan versi yang sekarang sudah terpasang hanya makan
            // tempat di HP.
            if (berkas.exists()) berkas.delete();
        }

        riwayat.removeAllViews();
        if (semua == null) return;
        for (int i = 0; i < semua.length(); i++) {
            JSONObject rel = semua.optJSONObject(i);
            if (rel == null) continue;
            LinearLayout r = new LinearLayout(this);
            r.setOrientation(LinearLayout.VERTICAL);
            float d = getResources().getDisplayMetrics().density;
            r.setPadding(0, (int) (8 * d), 0, (int) (8 * d));

            boolean ini = rel.optInt("versionCode", -1) == kodeTerpasang;
            String tanda = ini ? "  · terpasang" : "";
            baris(r, "Versi " + rel.optString("versionName", "?") + tanda,
                    13, ini ? "#0E6E55" : "#1B1D1F", ini);
            baris(r, tanggal(rel.optString("publishedAt", "")), 11, "#9AA0A6", false);
            String catatan = rel.optString("notes", "");
            if (!catatan.isEmpty()) baris(r, catatan, 11, "#6B7178", false);
            riwayat.addView(r);
        }
    }

    private void baris(LinearLayout parent, String teks, int sp, String warna, boolean tebal) {
        TextView t = new TextView(this);
        t.setTextSize(sp);
        t.setTextColor(Color.parseColor(warna));
        if (tebal) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setText(teks);
        parent.addView(t);
    }

    // --------------------------------------------------------------- unduhan

    /**
     * Unduhan yang tertinggal dipakai ulang hanya kalau sha256-nya cocok.
     *
     * Cocok berarti berkasnya memang rilis ini dan utuh; kalau tidak, ia sisa
     * versi lain atau unduhan yang putus, dan dua-duanya harus dibuang diam-diam
     * daripada ditawarkan untuk dipasang.
     */
    private void periksaUnduhanLama() {
        if (!berkas.exists() || terbaru == null) return;
        final String sha = terbaru.optString("sha256", "");
        if (sha.isEmpty()) return;
        new Thread(() -> {
            final boolean cocok = sha.equalsIgnoreCase(shaBerkas(berkas));
            main.post(() -> {
                if (cocok) {
                    siapPasang = true;
                    aksi.setText("Pasang Sekarang");
                    progres.setVisibility(android.view.View.VISIBLE);
                    progres.setText("Sudah diunduh dan diperiksa, tinggal dipasang.");
                } else {
                    berkas.delete();
                }
            });
        }).start();
    }

    private void unduh() {
        if (sibuk || terbaru == null) return;
        String url = terbaru.optString("url", "");
        if (url == null || url.isEmpty() || "null".equals(url)) {
            Toast.makeText(this, "Server tidak memberi tautan unduhan.", Toast.LENGTH_LONG).show();
            return;
        }
        final String penuh = url.startsWith("http") ? url : session.baseUrl() + url;
        final String sha = terbaru.optString("sha256", "");
        final long perkiraan = terbaru.optLong("sizeBytes", 0);

        sibuk = true;
        aksi.setEnabled(false);
        aksi.setText("Mengunduh...");
        bar.setVisibility(android.view.View.VISIBLE);
        bar.setProgress(0);
        progres.setVisibility(android.view.View.VISIBLE);
        progres.setText("0%");

        new Thread(() -> {
            HttpURLConnection c = null;
            String galat = null;
            try {
                c = (HttpURLConnection) new URL(penuh).openConnection();
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                c.setInstanceFollowRedirects(true);
                int code = c.getResponseCode();
                if (code < 200 || code >= 300) {
                    galat = "Server menolak unduhan (HTTP " + code + ").";
                } else {
                    long total = c.getContentLength() > 0 ? c.getContentLength() : perkiraan;
                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    InputStream is = c.getInputStream();
                    FileOutputStream os = new FileOutputStream(berkas);
                    byte[] buf = new byte[64 * 1024];
                    long sudah = 0;
                    int n;
                    int persenTerakhir = -1;
                    while ((n = is.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        md.update(buf, 0, n);
                        sudah += n;
                        if (total > 0) {
                            int p = (int) (sudah * 100 / total);
                            if (p != persenTerakhir) {
                                persenTerakhir = p;
                                final int pp = p;
                                final long s = sudah;
                                final long t = total;
                                main.post(() -> {
                                    bar.setProgress(pp);
                                    progres.setText(pp + "% · " + ukuran(s) + " dari " + ukuran(t));
                                });
                            }
                        }
                    }
                    os.close();
                    is.close();

                    String hitung = hex(md.digest());
                    if (!sha.isEmpty() && !sha.equalsIgnoreCase(hitung)) {
                        berkas.delete();
                        galat = "Berkas yang terunduh tidak utuh, pemasangan dibatalkan. "
                                + "Coba lagi dengan koneksi yang lebih stabil.";
                    }
                }
            } catch (Exception e) {
                if (berkas.exists()) berkas.delete();
                String m = e.getMessage();
                galat = "Unduhan gagal" + (m == null ? "." : ": " + m);
            } finally {
                if (c != null) c.disconnect();
            }

            final String pesan = galat;
            main.post(() -> {
                sibuk = false;
                aksi.setEnabled(true);
                bar.setVisibility(android.view.View.GONE);
                if (pesan != null) {
                    siapPasang = false;
                    aksi.setText("Coba Unduh Lagi");
                    progres.setText(pesan);
                    progres.setTextColor(Color.parseColor("#B3261E"));
                    return;
                }
                siapPasang = true;
                aksi.setText("Pasang Sekarang");
                progres.setTextColor(Color.parseColor("#1B7F4B"));
                progres.setText("Unduhan selesai dan sudah diperiksa.");
                pasang();
            });
        }).start();
    }

    // ------------------------------------------------------------- pemasangan

    /**
     * Android 8+ meminta izin "pasang aplikasi tak dikenal" per aplikasi.
     *
     * Izinnya diminta SETELAH berkasnya siap, bukan sebelum: kalau dimintakan
     * di awal, pemakainya menyetujui sesuatu yang belum tentu jadi dipakai.
     */
    private void pasang() {
        if (!berkas.exists()) {
            siapPasang = false;
            aksi.setText("Unduh & Pasang");
            Toast.makeText(this, "Berkasnya tidak ada lagi, unduh ulang.", Toast.LENGTH_LONG).show();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
            new MaterialAlertDialogBuilder(this)
                    .setTitle("Perlu izin memasang")
                    .setMessage("Android meminta izin \"pasang aplikasi tak dikenal\" untuk Scan "
                            + "Resi. Berkasnya sudah selesai diunduh dan langsung dipasang begitu "
                            + "izinnya diberikan.")
                    .setPositiveButton("Buka Pengaturan", (dd, w) -> {
                        try {
                            startActivityForResult(new Intent(
                                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getPackageName())), REQ_IZIN_PASANG);
                        } catch (Exception e) {
                            Toast.makeText(this, "Tidak bisa membuka pengaturan izin.",
                                    Toast.LENGTH_LONG).show();
                        }
                    })
                    .setNegativeButton("Nanti", null)
                    .show();
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".berkas", berkas);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Tidak bisa membuka pemasang Android.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int req, int hasil, Intent data) {
        super.onActivityResult(req, hasil, data);
        // Hasilnya diabaikan: dialog izin Android tidak melaporkan pilihan, jadi
        // yang dipakai adalah keadaan izin sekarang -- dan pasang() sendiri yang
        // memeriksanya lagi.
        if (req == REQ_IZIN_PASANG && siapPasang) pasang();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    // ---------------------------------------------------------------- bantuan

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    private static String shaBerkas(File f) {
        try (FileInputStream is = new FileInputStream(f)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = is.read(buf)) > 0) md.update(buf, 0, n);
            return hex(md.digest());
        } catch (Exception e) {
            return "";
        }
    }

    private static String ukuran(long bytes) {
        if (bytes <= 0) return "-";
        double mb = bytes / 1024.0 / 1024.0;
        return String.format(java.util.Locale.US, "%.1f MB", mb);
    }

    /** "2026-08-28T03:29:05Z" jadi "28 Agu 2026". */
    private static String tanggal(String iso) {
        if (iso == null || iso.length() < 10) return "-";
        try {
            int th = Integer.parseInt(iso.substring(0, 4));
            int bl = Integer.parseInt(iso.substring(5, 7));
            int hr = Integer.parseInt(iso.substring(8, 10));
            if (bl < 1 || bl > 12) return "-";
            return hr + " " + BULAN[bl - 1] + " " + th;
        } catch (Exception e) {
            return "-";
        }
    }
}
