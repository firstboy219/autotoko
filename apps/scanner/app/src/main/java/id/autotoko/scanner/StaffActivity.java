package id.autotoko.scanner;

import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Akun karyawan, dikelola dari HP pemiliknya.
 *
 * Isinya sama dengan halaman Karyawan di web dan memakai endpoint yang sama.
 * Ada di APK karena yang memegang HP inilah yang biasanya sedang berdiri di
 * gudang saat memutuskan siapa boleh pegang apa -- menyuruhnya membuka laptop
 * untuk itu berarti keputusannya ditunda, dan yang terjadi kemudian adalah
 * password pemilik dipinjamkan "sementara".
 */
public class StaffActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout root;
    private TextView status;

    private JSONArray daftar;
    private JSONArray katalogIzin;
    private int menunggu = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Akun Karyawan");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        int pad = (int) (16 * PayoutUi.d(this));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(Color.parseColor(PayoutUi.INK2));
        status.setText("Memuat…");
        root.addView(status);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);
        muat();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private void muat() {
        status.setText("Memuat…");
        menunggu = 2;
        api.staffList(r -> { if (r.ok()) daftar = r.dataArray(); siap(r); });
        api.staffPermissions(r -> { if (r.ok()) katalogIzin = r.dataArray(); siap(r); });
    }

    private void siap(Api.Resp r) {
        menunggu -= 1;
        if (menunggu > 0) return;
        if (daftar == null) {
            status.setText(r.message("Gagal memuat akun karyawan."));
            return;
        }
        gambar();
    }

    private String labelIzin(String kunci) {
        for (int i = 0; katalogIzin != null && i < katalogIzin.length(); i++) {
            JSONObject p = katalogIzin.optJSONObject(i);
            if (p != null && kunci.equals(p.optString("key"))) return p.optString("label", kunci);
        }
        return kunci;
    }

    private void gambar() {
        root.removeAllViews();
        status.setText(daftar.length() + " akun karyawan");
        root.addView(status);

        root.addView(PayoutUi.catatan(this,
                "Karyawan masuk lewat halaman login yang sama dengan email dan "
                        + "passwordnya sendiri, lalu melihat data toko yang sama. "
                        + "Mencabut akses langsung mengakhiri sesi yang sedang berjalan."));

        root.addView(PayoutUi.tombol(this, "+ Tambah Karyawan", v -> form(null)),
                PayoutUi.lebar(this));

        for (int i = 0; i < daftar.length(); i++) {
            JSONObject s = daftar.optJSONObject(i);
            if (s == null) continue;
            final JSONObject item = s;

            StringBuilder ket = new StringBuilder();
            ket.append(PayoutUi.str(s, "email", "-"));
            if (!s.optBoolean("isActive", true)) ket.append(" · NONAKTIF");
            JSONArray izin = s.optJSONArray("permissions");
            ket.append("\n");
            if (izin == null || izin.length() == 0) {
                ket.append("belum ada akses");
            } else {
                for (int k = 0; k < izin.length(); k++) {
                    if (k > 0) ket.append(", ");
                    ket.append(labelIzin(izin.optString(k)));
                }
            }

            root.addView(PayoutUi.baris(this, PayoutUi.str(s, "name", "(tanpa nama)"),
                    ket.toString(), "ubah", v -> form(item)));
            root.addView(PayoutUi.garis(this));
        }
    }

    /** Satu formulir untuk menambah maupun mengubah. */
    private void form(final JSONObject ada) {
        final boolean baru = ada == null;

        LinearLayout f = new LinearLayout(this);
        f.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (20 * PayoutUi.d(this));
        f.setPadding(p, p / 2, p, 0);

        final EditText nama = PayoutUi.isian(this, "Nama karyawan",
                PayoutUi.str(ada, "name", ""), false);
        final EditText email = PayoutUi.isian(this, "nama@email.com",
                PayoutUi.str(ada, "email", ""), false);
        email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        final EditText sandi = PayoutUi.isian(this,
                baru ? "minimal 8 karakter" : "biarkan kosong bila tidak diubah", "", false);
        sandi.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);

        f.addView(PayoutUi.label(this, "Nama"));
        f.addView(nama);
        f.addView(PayoutUi.label(this, "Email untuk login"));
        f.addView(email);
        f.addView(PayoutUi.label(this, baru ? "Password" : "Password baru"));
        f.addView(sandi);
        f.addView(PayoutUi.catatan(this,
                "Password diberitahukan sendiri ke karyawannya — sistem tidak mengirim email."));

        f.addView(PayoutUi.label(this, "Akses yang diberikan"));
        final List<String> kunci = new ArrayList<>();
        final List<CheckBox> centang = new ArrayList<>();
        JSONArray punya = ada == null ? null : ada.optJSONArray("permissions");
        for (int i = 0; katalogIzin != null && i < katalogIzin.length(); i++) {
            JSONObject izin = katalogIzin.optJSONObject(i);
            if (izin == null) continue;
            String k = izin.optString("key");
            CheckBox c = new CheckBox(this);
            c.setText(izin.optString("label", k));
            c.setTextSize(14);
            boolean aktif = false;
            for (int j = 0; punya != null && j < punya.length(); j++) {
                if (k.equals(punya.optString(j))) aktif = true;
            }
            c.setChecked(aktif);
            f.addView(c);

            TextView h = new TextView(this);
            h.setText(izin.optString("hint", ""));
            h.setTextSize(11);
            h.setTextColor(Color.parseColor(PayoutUi.INK3));
            h.setPadding((int) (32 * PayoutUi.d(this)), 0, 0, (int) (6 * PayoutUi.d(this)));
            f.addView(h);

            kunci.add(k);
            centang.add(c);
        }

        ScrollView sv = new ScrollView(this);
        sv.addView(f);

        MaterialAlertDialogBuilder b = new MaterialAlertDialogBuilder(this)
                .setTitle(baru ? "Tambah Karyawan" : "Ubah " + PayoutUi.str(ada, "name", ""))
                .setView(sv)
                .setPositiveButton("Simpan", null)
                .setNegativeButton("Batal", null);
        if (!baru) b.setNeutralButton("Lainnya", null);
        final androidx.appcompat.app.AlertDialog dlg = b.create();

        dlg.setOnShowListener(dd -> {
            dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                JSONObject body = new JSONObject();
                try {
                    body.put("name", nama.getText().toString().trim());
                    body.put("email", email.getText().toString().trim());
                    String s = sandi.getText().toString();
                    // Kosong berarti "jangan diubah", bukan "kosongkan".
                    if (baru || !s.isEmpty()) body.put("password", s);
                    JSONArray izin = new JSONArray();
                    for (int i = 0; i < kunci.size(); i++) {
                        if (centang.get(i).isChecked()) izin.put(kunci.get(i));
                    }
                    body.put("permissions", izin);
                } catch (Exception ignored) {}

                Api.Cb cb = r -> {
                    if (!r.ok()) {
                        // Pesan servernya apa adanya: di situlah email ganda dan
                        // password terlalu pendek menerangkan dirinya sendiri.
                        new MaterialAlertDialogBuilder(this)
                                .setTitle("Tidak bisa disimpan")
                                .setMessage(r.message("Gagal menyimpan akun karyawan."))
                                .setPositiveButton("Mengerti", null)
                                .show();
                        return;
                    }
                    Toast.makeText(this, "Tersimpan.", Toast.LENGTH_SHORT).show();
                    dlg.dismiss();
                    muat();
                };
                if (baru) api.staffCreate(body, cb);
                else api.staffUpdate(PayoutUi.str(ada, "id", ""), body, cb);
            });

            if (!baru) {
                dlg.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener(
                        v -> lainnya(ada, dlg));
            }
        });
        dlg.show();
    }

    private void lainnya(final JSONObject s, final androidx.appcompat.app.AlertDialog induk) {
        final boolean aktif = s.optBoolean("isActive", true);
        final String id = PayoutUi.str(s, "id", "");
        final String nama = PayoutUi.str(s, "name", "");
        new MaterialAlertDialogBuilder(this)
                .setTitle(nama)
                .setItems(new String[] {aktif ? "Nonaktifkan" : "Aktifkan", "Hapus akun"},
                        (d, w) -> {
                            if (w == 0) {
                                JSONObject body = new JSONObject();
                                try { body.put("isActive", !aktif); } catch (Exception ignored) {}
                                api.staffUpdate(id, body, r -> {
                                    Toast.makeText(this, r.ok()
                                            ? (aktif ? "Dinonaktifkan. Sesi yang sedang berjalan "
                                                     + "langsung berakhir." : "Diaktifkan lagi.")
                                            : r.message("Gagal mengubah."), Toast.LENGTH_LONG).show();
                                    induk.dismiss();
                                    muat();
                                });
                            } else {
                                konfirmasiHapus(id, nama, induk);
                            }
                        })
                .setNegativeButton("Batal", null)
                .show();
    }

    private void konfirmasiHapus(final String id, final String nama,
                                 final androidx.appcompat.app.AlertDialog induk) {
        new MaterialAlertDialogBuilder(this)
                .setTitle("Hapus akun " + nama + "?")
                .setMessage("Akun ini tidak bisa masuk lagi. Data yang sudah dia catat — "
                        + "resi, pencairan, dan lainnya — tetap utuh sebagai milik toko.")
                .setPositiveButton("Hapus", (d, w) -> api.staffDelete(id, r -> {
                    Toast.makeText(this, r.ok() ? "Akun dihapus."
                            : r.message("Gagal menghapus."), Toast.LENGTH_LONG).show();
                    induk.dismiss();
                    muat();
                }))
                .setNegativeButton("Batal", null)
                .show();
    }
}
