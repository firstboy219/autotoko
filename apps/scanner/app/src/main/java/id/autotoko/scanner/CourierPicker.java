package id.autotoko.scanner;

import android.app.Activity;
import android.graphics.Color;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Menambah kurir yang tidak ada di daftar bawaan, dari tempat kurir dipilih.
 *
 * Daftar bawaan berisi kurir nasional dan itu memang cukup untuk kebanyakan
 * paket. Yang tidak tertampung: kurir lokal, layanan marketplace yang baru
 * muncul, dan barang yang diantar sendiri. Sebelum ini satu-satunya jalan
 * adalah mengubah kode, jadi paket semacam itu tersimpan tanpa kurir.
 *
 * Tombolnya ditaruh persis di bawah pilihan kurir, bukan di menu pengaturan:
 * kebutuhannya muncul saat paket sedang dipegang dan barcodenya sudah terbaca,
 * dan menyuruh orang menyeberang layar pada saat itu berarti kurirnya tidak
 * akan diisi sama sekali.
 */
final class CourierPicker {

    private CourierPicker() {}

    /**
     * Tombol "+ Tambah kurir", lengkap dengan efeknya ke spinner pemanggil.
     *
     * `sumber` adalah daftar kurir yang dipegang layar itu; ia ikut diperbarui
     * supaya sheet yang dibuka lagi untuk paket berikutnya sudah memuat kurir
     * baru tanpa memanggil server lagi.
     */
    static View tombolTambah(final Activity a, final Api api,
                             final ArrayAdapter<String> adapter,
                             final List<String> namaDiSpinner,
                             final Spinner spinner,
                             final List<String> sumber) {
        MaterialButton b = new MaterialButton(a);
        b.setText("+ Tambah kurir");
        b.setAllCaps(false);
        b.setTextSize(12);
        b.setOnClickListener(v -> dialog(a, api, adapter, namaDiSpinner, spinner, sumber));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (4 * a.getResources().getDisplayMetrics().density);
        b.setLayoutParams(lp);
        return b;
    }

    private static void dialog(final Activity a, final Api api,
                               final ArrayAdapter<String> adapter,
                               final List<String> namaDiSpinner,
                               final Spinner spinner,
                               final List<String> sumber) {
        float d = a.getResources().getDisplayMetrics().density;
        LinearLayout f = new LinearLayout(a);
        f.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (20 * d);
        f.setPadding(p, p / 2, p, 0);

        final EditText nama = new EditText(a);
        nama.setHint("Nama kurir");
        nama.setSingleLine(true);
        nama.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        // Batasnya sama dengan kolom yang akan menyimpannya, jadi nama yang
        // terlalu panjang ketahuan saat diketik, bukan saat gagal disimpan.
        nama.setFilters(new android.text.InputFilter[] {
                new android.text.InputFilter.LengthFilter(32) });
        f.addView(nama);

        final TextView ket = new TextView(a);
        ket.setTextSize(11);
        ket.setTextColor(Color.parseColor("#6B7178"));
        ket.setPadding(0, (int) (8 * d), 0, 0);
        ket.setText("Maksimal 32 huruf. Kurir tambahan ikut muncul di web.");
        f.addView(ket);

        // Kurir tambahan yang sudah ada, supaya salah ketik bisa dibereskan
        // dari tempat yang sama -- tanpa ini nama yang salah akan menetap
        // selamanya di daftar.
        final TextView milik = new TextView(a);
        milik.setTextSize(11);
        milik.setTextColor(Color.parseColor("#9AA0A6"));
        milik.setPadding(0, (int) (10 * d), 0, 0);
        milik.setVisibility(View.GONE);
        f.addView(milik);

        final List<String> idTambahan = new ArrayList<>();
        final List<String> namaTambahan = new ArrayList<>();

        final androidx.appcompat.app.AlertDialog dlg = new MaterialAlertDialogBuilder(a)
                .setTitle("Tambah Kurir")
                .setView(f)
                .setPositiveButton("Simpan", null)
                .setNeutralButton("Hapus kurir tambahan", null)
                .setNegativeButton("Batal", null)
                .create();

        dlg.setOnShowListener(dd -> {
            dlg.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setEnabled(false);
            api.couriers(r -> {
                if (!r.ok() || r.data() == null) return;
                JSONArray c = r.data().optJSONArray("custom");
                idTambahan.clear();
                namaTambahan.clear();
                for (int i = 0; c != null && i < c.length(); i++) {
                    JSONObject o = c.optJSONObject(i);
                    if (o == null) continue;
                    idTambahan.add(o.optString("id", ""));
                    namaTambahan.add(o.optString("name", ""));
                }
                if (!namaTambahan.isEmpty()) {
                    milik.setVisibility(View.VISIBLE);
                    milik.setText("Kurir tambahan Anda: "
                            + android.text.TextUtils.join(", ", namaTambahan));
                    dlg.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setEnabled(true);
                }
            });

            // Tombolnya dipasang sendiri supaya kegagalan tidak menutup dialog
            // dan menghapus nama yang sudah diketik.
            dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                final String n = nama.getText().toString().trim().replaceAll("\\s+", " ");
                if (n.length() < 2) {
                    Toast.makeText(a, "Nama kurir minimal 2 huruf.", Toast.LENGTH_LONG).show();
                    return;
                }
                api.addCourier(n, r -> {
                    if (!r.ok()) {
                        // Pesan servernya apa adanya: di situlah penolakan nama
                        // yang sudah ada -- bawaan maupun tambahan -- menerangkan
                        // dirinya sendiri.
                        new MaterialAlertDialogBuilder(a)
                                .setTitle("Tidak bisa ditambahkan")
                                .setMessage(r.message("Gagal menambah kurir."))
                                .setPositiveButton("Mengerti", null)
                                .show();
                        return;
                    }
                    String tersimpan = r.data() == null ? n : r.data().optString("name", n);
                    pasang(tersimpan, adapter, namaDiSpinner, spinner, sumber);
                    Toast.makeText(a, "Kurir \"" + tersimpan + "\" ditambahkan.",
                            Toast.LENGTH_SHORT).show();
                    dlg.dismiss();
                });
            });

            dlg.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
                if (namaTambahan.isEmpty()) return;
                new MaterialAlertDialogBuilder(a)
                        .setTitle("Hapus kurir tambahan")
                        .setItems(namaTambahan.toArray(new String[0]), (d2, w) ->
                                konfirmasiHapus(a, api, idTambahan.get(w), namaTambahan.get(w),
                                        adapter, namaDiSpinner, spinner, sumber, dlg))
                        .setNegativeButton("Batal", null)
                        .show();
            });
        });
        dlg.show();
    }

    private static void konfirmasiHapus(final Activity a, final Api api, final String id,
                                        final String nama,
                                        final ArrayAdapter<String> adapter,
                                        final List<String> namaDiSpinner,
                                        final Spinner spinner,
                                        final List<String> sumber,
                                        final androidx.appcompat.app.AlertDialog induk) {
        new MaterialAlertDialogBuilder(a)
                .setTitle("Hapus \"" + nama + "\"?")
                .setMessage("Kurir ini hilang dari daftar pilihan. Paket yang terlanjur "
                        + "tercatat memakai kurir ini TIDAK berubah — namanya tersimpan "
                        + "sebagai teks di resi masing-masing.")
                .setPositiveButton("Hapus", (d, w) -> api.deleteCourier(id, r -> {
                    if (!r.ok()) {
                        Toast.makeText(a, r.message("Gagal menghapus."),
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    lepas(nama, adapter, namaDiSpinner, spinner, sumber);
                    Toast.makeText(a, "Kurir \"" + nama + "\" dihapus.",
                            Toast.LENGTH_SHORT).show();
                    induk.dismiss();
                }))
                .setNegativeButton("Batal", null)
                .show();
    }

    /** Masukkan ke daftar yang sedang tampil, lalu langsung pilih. */
    private static void pasang(String nama, ArrayAdapter<String> adapter,
                               List<String> namaDiSpinner, Spinner spinner,
                               List<String> sumber) {
        if (!sumber.contains(nama)) sumber.add(nama);
        if (!namaDiSpinner.contains(nama)) namaDiSpinner.add(nama);
        adapter.notifyDataSetChanged();
        int i = namaDiSpinner.indexOf(nama);
        if (i >= 0) spinner.setSelection(i);
    }

    private static void lepas(String nama, ArrayAdapter<String> adapter,
                              List<String> namaDiSpinner, Spinner spinner,
                              List<String> sumber) {
        // Kalau yang dihapus sedang terpilih, pilihannya dikembalikan ke
        // "— pilih kurir —" daripada diam-diam menunjuk kurir lain.
        int terpilih = spinner.getSelectedItemPosition();
        boolean sedangDipakai = terpilih >= 0 && terpilih < namaDiSpinner.size()
                && nama.equals(namaDiSpinner.get(terpilih));
        sumber.remove(nama);
        namaDiSpinner.remove(nama);
        adapter.notifyDataSetChanged();
        if (sedangDipakai && !namaDiSpinner.isEmpty()) spinner.setSelection(0);
    }
}
