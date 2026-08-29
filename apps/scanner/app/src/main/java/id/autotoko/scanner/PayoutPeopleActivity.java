package id.autotoko.scanner;

import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Sub-seller, sub-sub-seller, dan toko siapa punya siapa.
 *
 * Tiga hal ini satu layar karena memang satu urusan: menambah sub-seller tanpa
 * bisa langsung menugaskan tokonya berarti menyeberang layar untuk
 * menyelesaikan satu pekerjaan.
 *
 * Tidak ada tombol hapus, sama seperti di web: sub-seller yang sudah pernah
 * kebagian pencairan ikut menyusun riwayat batch, jadi yang bisa dilakukan
 * adalah menonaktifkannya.
 */
public class PayoutPeopleActivity extends AppCompatActivity {

    private Api api;
    private LinearLayout root;
    private TextView status;

    private JSONArray subs, subSubs, mapping;
    private int menunggu = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Sub-seller & Toko");
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        int pad = (int) (16 * PayoutUi.d(this));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        status = new TextView(this);
        status.setTextSize(13);
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

    /** Tiga daftar diambil bersamaan; digambar setelah ketiganya pulang. */
    private void muat() {
        menunggu = 3;
        status.setText("Memuat…");
        api.payoutSubSellers(r -> { subs = r.dataArray(); siap(); });
        api.payoutSubSubSellers(r -> { subSubs = r.dataArray(); siap(); });
        api.payoutMapping(r -> { mapping = r.dataArray(); siap(); });
    }

    private void siap() {
        menunggu -= 1;
        if (menunggu <= 0) gambar();
    }

    private void gambar() {
        root.removeAllViews();
        status.setText("");
        root.addView(status);

        /* ------------------------------------------------------ sub-seller */
        root.addView(PayoutUi.judul(this, "Sub-seller"));
        if (subs == null || subs.length() == 0) {
            root.addView(PayoutUi.catatan(this, "Belum ada sub-seller."));
        }
        for (int i = 0; subs != null && i < subs.length(); i++) {
            JSONObject s = subs.optJSONObject(i);
            if (s == null) continue;
            final JSONObject item = s;
            boolean aktif = "active".equals(PayoutUi.str(s, "status", "active"));
            String ket = PayoutUi.str(s, "bankAccount", "(rekening belum diisi)");
            String kontak = PayoutUi.str(s, "contact", null);
            if (kontak != null) ket = kontak + " · " + ket;
            if (!aktif) ket = "NONAKTIF · " + ket;
            root.addView(PayoutUi.baris(this,
                    PayoutUi.str(s, "name", "(tanpa nama)"), ket,
                    PayoutUi.persen(PayoutUi.num(s, "defaultRate")),
                    v -> formSub(item, null)));
            root.addView(PayoutUi.garis(this));
        }
        root.addView(PayoutUi.tombol(this, "+ Tambah Sub-seller", v -> formSub(null, null)),
                PayoutUi.lebar(this));

        /* -------------------------------------------------- sub-sub-seller */
        root.addView(PayoutUi.judul(this, "Sub-sub-seller"));
        if (subSubs == null || subSubs.length() == 0) {
            root.addView(PayoutUi.catatan(this, "Belum ada sub-sub-seller."));
        }
        for (int i = 0; subSubs != null && i < subSubs.length(); i++) {
            JSONObject s = subSubs.optJSONObject(i);
            if (s == null) continue;
            final JSONObject item = s;
            String induk = namaSub(PayoutUi.str(s, "subSellerId", null));
            root.addView(PayoutUi.baris(this,
                    PayoutUi.str(s, "name", "(tanpa nama)"),
                    "di bawah " + (induk == null ? "-" : induk),
                    PayoutUi.persen(PayoutUi.num(s, "defaultRate")),
                    v -> formSub(item, PayoutUi.str(item, "subSellerId", null))));
            root.addView(PayoutUi.garis(this));
        }
        if (subs != null && subs.length() > 0) {
            root.addView(PayoutUi.tombol(this, "+ Tambah Sub-sub-seller",
                    v -> pilihInduk()), PayoutUi.lebar(this));
        } else {
            root.addView(PayoutUi.catatan(this,
                    "Tambah sub-seller dulu — sub-sub-seller selalu berada di bawah satu."));
        }

        /* --------------------------------------------------- penugasan toko */
        root.addView(PayoutUi.judul(this, "Toko Milik Siapa"));
        if (mapping == null || mapping.length() == 0) {
            root.addView(PayoutUi.catatan(this, "Belum ada toko."));
        }
        for (int i = 0; mapping != null && i < mapping.length(); i++) {
            JSONObject m = mapping.optJSONObject(i);
            if (m == null) continue;
            final JSONObject item = m;
            String pemilik = PayoutUi.str(m, "subSubSellerName", null);
            if (pemilik == null) pemilik = PayoutUi.str(m, "subSellerName", null);
            root.addView(PayoutUi.baris(this,
                    PayoutUi.str(m, "shopName", "(tanpa nama)"),
                    PayoutUi.str(m, "marketplace", "-")
                            + " · " + (pemilik == null ? "milik seller sendiri" : pemilik),
                    "ubah", v -> formTugas(item)));
            root.addView(PayoutUi.garis(this));
        }
    }

    private String namaSub(String id) {
        for (int i = 0; subs != null && i < subs.length(); i++) {
            JSONObject s = subs.optJSONObject(i);
            if (s != null && id != null && id.equals(PayoutUi.str(s, "id", null))) {
                return PayoutUi.str(s, "name", null);
            }
        }
        return null;
    }

    /* ------------------------------------------------------------- formulir */

    private void pilihInduk() {
        final List<String> nama = new ArrayList<>();
        final List<String> id = new ArrayList<>();
        for (int i = 0; subs != null && i < subs.length(); i++) {
            JSONObject s = subs.optJSONObject(i);
            if (s == null) continue;
            nama.add(PayoutUi.str(s, "name", "(tanpa nama)"));
            id.add(PayoutUi.str(s, "id", ""));
        }
        new MaterialAlertDialogBuilder(this)
                .setTitle("Di bawah sub-seller mana?")
                .setItems(nama.toArray(new String[0]),
                        (d, w) -> formSub(null, id.get(w)))
                .setNegativeButton("Batal", null)
                .show();
    }

    /**
     * Satu formulir untuk empat hal: tambah/ubah sub-seller dan sub-sub-seller.
     *
     * `induk` yang terisi menandakan sub-sub-seller. Bentuk datanya memang
     * sama di server -- sub-sub-seller hanya sub-seller yang punya induk.
     */
    private void formSub(JSONObject ada, String induk) {
        boolean baru = ada == null;
        boolean sub2 = induk != null;

        LinearLayout f = new LinearLayout(this);
        f.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (20 * PayoutUi.d(this));
        f.setPadding(p, p / 2, p, 0);

        EditText nama = PayoutUi.isian(this, "Nama", PayoutUi.str(ada, "name", ""), false);
        EditText kontak = PayoutUi.isian(this, "08…", PayoutUi.str(ada, "contact", ""), false);
        EditText bank = PayoutUi.isian(this, "Nomor rekening",
                PayoutUi.str(ada, "bankAccount", ""), false);
        EditText rate = PayoutUi.isian(this, "20",
                baru ? "" : String.valueOf(Math.round(PayoutUi.num(ada, "defaultRate") * 100)), true);
        EditText kuota = PayoutUi.isian(this, "kosongkan kalau tanpa batas",
                (ada == null || ada.isNull("kuotaTokoMaksimal")) ? ""
                        : String.valueOf(ada.optInt("kuotaTokoMaksimal", 0)), true);

        f.addView(PayoutUi.label(this, "Nama"));
        f.addView(nama);
        f.addView(PayoutUi.label(this, "Kontak"));
        f.addView(kontak);
        f.addView(PayoutUi.label(this, "Rekening tujuan"));
        f.addView(bank);
        f.addView(PayoutUi.label(this, "Rate (%)"));
        f.addView(rate);
        f.addView(PayoutUi.label(this, "Kuota toko"));
        f.addView(kuota);

        final Spinner st = new Spinner(this);
        if (!baru) {
            ArrayAdapter<String> ad = new ArrayAdapter<>(this,
                    android.R.layout.simple_spinner_item, new String[] {"Aktif", "Nonaktif"});
            ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            st.setAdapter(ad);
            st.setSelection("active".equals(PayoutUi.str(ada, "status", "active")) ? 0 : 1);
            f.addView(PayoutUi.label(this, "Status"));
            f.addView(st);
        }

        ScrollView sv = new ScrollView(this);
        sv.addView(f);

        new MaterialAlertDialogBuilder(this)
                .setTitle((baru ? "Tambah " : "Ubah ") + (sub2 ? "Sub-sub-seller" : "Sub-seller"))
                .setView(sv)
                .setPositiveButton("Simpan", (d, w) -> {
                    String n = nama.getText().toString().trim();
                    if (n.isEmpty()) {
                        Toast.makeText(this, "Nama wajib diisi.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    JSONObject body = new JSONObject();
                    try {
                        body.put("name", n);
                        String k = kontak.getText().toString().trim();
                        if (!k.isEmpty()) body.put("contact", k);
                        String bk = bank.getText().toString().trim();
                        if (!bk.isEmpty()) body.put("bankAccount", bk);
                        String rt = rate.getText().toString().trim();
                        if (!rt.isEmpty()) {
                            double r = PayoutUi.angka(rate);
                            if (r < 0 || r > 100) {
                                Toast.makeText(this, "Rate harus 0–100%.", Toast.LENGTH_LONG).show();
                                return;
                            }
                            body.put("defaultRate", r / 100);
                        }
                        String kt = kuota.getText().toString().trim();
                        if (!kt.isEmpty()) body.put("kuotaTokoMaksimal", (int) PayoutUi.angka(kuota));
                        if (!baru) body.put("status", st.getSelectedItemPosition() == 0
                                ? "active" : "inactive");
                        if (baru && sub2) body.put("subSellerId", induk);
                    } catch (Exception ignored) {}
                    kirimSub(baru, sub2, ada == null ? null : PayoutUi.str(ada, "id", null), body);
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    private void kirimSub(boolean baru, boolean sub2, String id, JSONObject body) {
        Api.Cb cb = r -> {
            if (!r.ok()) {
                Toast.makeText(this, r.message("Gagal menyimpan."), Toast.LENGTH_LONG).show();
                return;
            }
            Toast.makeText(this, "Tersimpan.", Toast.LENGTH_SHORT).show();
            muat();
        };
        if (baru && sub2) api.payoutCreateSubSubSeller(body, cb);
        else if (baru) api.payoutCreateSubSeller(body, cb);
        else if (sub2) api.payoutUpdateSubSubSeller(id, body, cb);
        else api.payoutUpdateSubSeller(id, body, cb);
    }

    /**
     * Toko ini punya siapa.
     *
     * Melepas toko ke pemiliknya sendiri dikirim sebagai null yang eksplisit,
     * bukan dengan menghilangkan fieldnya: field yang hilang berarti "jangan
     * diubah", dan toko yang mau dilepas justru tidak akan berubah apa-apa.
     */
    private void formTugas(JSONObject shop) {
        final List<String> nama = new ArrayList<>();
        final List<String> idSub = new ArrayList<>();
        final List<String> idSub2 = new ArrayList<>();
        nama.add("Seller sendiri (tanpa sub-seller)");
        idSub.add(null);
        idSub2.add(null);
        for (int i = 0; subs != null && i < subs.length(); i++) {
            JSONObject s = subs.optJSONObject(i);
            if (s == null) continue;
            nama.add(PayoutUi.str(s, "name", "(tanpa nama)"));
            idSub.add(PayoutUi.str(s, "id", null));
            idSub2.add(null);
        }
        for (int i = 0; subSubs != null && i < subSubs.length(); i++) {
            JSONObject s = subSubs.optJSONObject(i);
            if (s == null) continue;
            String induk = namaSub(PayoutUi.str(s, "subSellerId", null));
            nama.add(PayoutUi.str(s, "name", "(tanpa nama)")
                    + " (di bawah " + (induk == null ? "-" : induk) + ")");
            idSub.add(PayoutUi.str(s, "subSellerId", null));
            idSub2.add(PayoutUi.str(s, "id", null));
        }

        new MaterialAlertDialogBuilder(this)
                .setTitle(PayoutUi.str(shop, "shopName", "Toko"))
                .setItems(nama.toArray(new String[0]), (d, w) -> {
                    JSONObject body = new JSONObject();
                    try {
                        body.put("subSellerId", idSub.get(w) == null
                                ? JSONObject.NULL : idSub.get(w));
                        body.put("subSubSellerId", idSub2.get(w) == null
                                ? JSONObject.NULL : idSub2.get(w));
                    } catch (Exception ignored) {}
                    api.payoutAssignShop(PayoutUi.str(shop, "id", ""), body, r -> {
                        if (!r.ok()) {
                            Toast.makeText(this, r.message("Gagal menugaskan toko."),
                                    Toast.LENGTH_LONG).show();
                            return;
                        }
                        Toast.makeText(this, "Toko diperbarui.", Toast.LENGTH_SHORT).show();
                        muat();
                    });
                })
                .setNegativeButton("Batal", null)
                .show();
    }
}
