package id.autotoko.scanner;

import static id.autotoko.scanner.PayoutUi.GARIS;
import static id.autotoko.scanner.PayoutUi.INK;
import static id.autotoko.scanner.PayoutUi.INK2;
import static id.autotoko.scanner.PayoutUi.INK3;
import static id.autotoko.scanner.PayoutUi.OK;
import static id.autotoko.scanner.PayoutUi.PERHATIAN;
import static id.autotoko.scanner.PayoutUi.angka;
import static id.autotoko.scanner.PayoutUi.catatan;
import static id.autotoko.scanner.PayoutUi.d;
import static id.autotoko.scanner.PayoutUi.garis;
import static id.autotoko.scanner.PayoutUi.isian;
import static id.autotoko.scanner.PayoutUi.judul;
import static id.autotoko.scanner.PayoutUi.label;
import static id.autotoko.scanner.PayoutUi.num;
import static id.autotoko.scanner.PayoutUi.rp;
import static id.autotoko.scanner.PayoutUi.str;
import static id.autotoko.scanner.PayoutUi.tombol;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * HPP & Harga Jual di ponsel: daftar produk, marginnya, dan pintu ke perhitungan.
 *
 * KENAPA DI PONSEL. Harga diputuskan saat melihat barangnya dan saat menerima
 * harga bahan dari pemasok -- dua momen yang terjadi di gudang dan di jalan,
 * bukan di depan komputer. Selama fitur ini hanya ada di web, keputusannya
 * ditunda sampai malam, dan yang ditunda diputuskan dari ingatan.
 *
 * MARGIN DITARUH DI DAFTAR, bukan disembunyikan di halaman detail. Pertanyaan
 * pertama seorang seller bukan "berapa HPP produk X" melainkan "produk mana
 * yang marginnya bermasalah" -- dan itu pertanyaan tentang seluruh daftar.
 *
 * SUSUNANNYA MENGIKUTI WEB dengan sengaja, sampai ke urutan kolom dan bunyi
 * peringatannya. Layar yang sama dengan dua tata letak berbeda membuat orang
 * harus belajar dua kali, dan yang lebih buruk: membuat dua orang membaca
 * angka yang sama dengan cara berbeda.
 */
public class HppActivity extends AppCompatActivity {

    /** Nilai yang dikirim ke server, sejajar dengan URUT_LABEL. */
    private static final String[] URUT_NILAI = {
        "nama", "terlaris", "margin", "profit",
        "harga_tertinggi", "harga_terendah", "hpp_tertinggi", "hpp_terendah",
    };
    private static final String[] URUT_LABEL = {
        "Urut nama", "Terlaris (qty terjual)", "Margin bersih tertinggi",
        "Profit bersih terbesar", "Harga jual tertinggi", "Harga jual terendah",
        "HPP termahal", "HPP termurah",
    };
    private static final String[] HARI_NILAI = {"30", "90", "180", "365"};
    private static final String[] HARI_LABEL = {"30 hari", "3 bulan", "6 bulan", "1 tahun"};

    /**
     * Kolom pengubahan massal, persis seperti di web.
     *
     * {kunci, label, "1" bila persen}. Yang dikosongkan TIDAK dikirim.
     */
    private static final String[][] KOLOM_MASSAL = {
        {"marketplaceFeeRate", "Fee marketplace", "1"},
        {"affiliatorRate", "Afiliator", "1"},
        {"adsRate", "Iklan", "1"},
        {"adsFixedPerPcs", "Iklan (Rp/pcs)", ""},
        {"eventRate", "Event / promo", "1"},
        {"sedekahRate", "Sedekah", "1"},
        {"resellerRate", "Reseller", "1"},
        {"targetProfitRate", "Target profit", "1"},
        {"serviceCostPerPcs", "Biaya jasa (Rp/pcs)", ""},
        {"packingCostPerOrder", "Biaya packing (Rp/resi)", ""},
    };

    private Session session;
    private Api api;
    private LinearLayout root;

    private String urut = "nama";
    private String hari = "30";
    /** "" semua brand, "none" yang tanpa brand. */
    private String brand = "";
    private final List<String[]> brands = new ArrayList<>();   // {id, nama}
    private final Set<String> dipilih = new LinkedHashSet<>();

    private JSONArray produk;
    private JSONArray packing;
    private JSONArray katalogBahan;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        if (session.token() == null) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }
        setTitle("HPP & Harga Jual");

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.parseColor("#FAF9F6"));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (16 * d(this));
        root.setPadding(p, p, p, (int) (32 * d(this)));
        sv.addView(root);
        setContentView(sv);

        muat();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Kembali dari halaman detail berarti HPP dan marginnya mungkin baru
        // berubah, dan daftar ini memuat keduanya.
        if (produk != null) muat();
    }

    /* ------------------------------------------------------------- memuat */

    private void muat() {
        api.costingList(brand, urut, hari, r -> {
            if (!r.ok()) {
                gagal(r.message("Gagal memuat daftar HPP"));
                return;
            }
            produk = r.dataArray();
            api.costingPackingList(rp2 -> {
                packing = rp2.ok() ? rp2.dataArray() : new JSONArray();
                api.materials(rm -> {
                    katalogBahan = rm.ok() ? rm.dataArray() : new JSONArray();
                    if (brands.isEmpty()) {
                        api.shopCategories(rb -> {
                            JSONArray a = rb.ok() ? rb.dataArray() : new JSONArray();
                            for (int i = 0; a != null && i < a.length(); i++) {
                                JSONObject o = a.optJSONObject(i);
                                if (o != null) {
                                    brands.add(new String[]{
                                        str(o, "id", ""), str(o, "name", "(tanpa nama)")});
                                }
                            }
                            gambar();
                        });
                    } else {
                        gambar();
                    }
                });
            });
        });
    }

    private void gagal(String pesan) {
        root.removeAllViews();
        root.addView(judul(this, "HPP & Harga Jual"));
        TextView t = catatan(this, pesan);
        t.setTextColor(Color.parseColor("#B3261E"));
        root.addView(t);
        root.addView(tombol(this, "Coba lagi", v -> muat()));
    }

    /* ------------------------------------------------------------ menggambar */

    private void gambar() {
        root.removeAllViews();

        TextView t = judul(this, "HPP & Harga Jual");
        t.setPadding(0, 0, 0, (int) (2 * d(this)));
        root.addView(t);
        root.addView(catatan(this,
                "Hitung harga pokok dari bahan baku, lalu susun harga publish "
                        + "beserta seluruh potongannya."));

        kartuPacking();
        penyaring();

        int n = produk == null ? 0 : produk.length();
        root.addView(judul(this, n + " produk"));

        if (n > 0) root.addView(pilihSemua(n));
        if (!dipilih.isEmpty()) barisTerpilih();

        if (n == 0) {
            root.addView(catatan(this,
                    "Belum ada produk. Tambahkan master produk dulu, lalu isi bahan "
                            + "bakunya di menu BOM / Bahan."));
        }
        for (int i = 0; i < n; i++) {
            JSONObject o = produk.optJSONObject(i);
            if (o != null) root.addView(barisProduk(o));
        }

        root.addView(tombolSaran());
    }

    /* -------------------------------------------------- bahan baku packing */

    /**
     * Daftar bahan packing itu BERSAMA, jumlahnya tidak.
     *
     * Yang di sini hanya daftarnya dan jumlah awalnya. Berapa yang benar-benar
     * dipakai satu produk diatur di halaman HPP produk itu, karena barang
     * besar makan dus dan lakban lebih banyak daripada barang kecil.
     *
     * Harganya dibaca dari master bahan, bukan diketik ulang di sini -- supaya
     * satu kali harga dus naik, seluruh HPP produk ikut betul.
     */
    private void kartuPacking() {
        root.addView(judul(this, "Bahan Baku Packing"));
        root.addView(catatan(this,
                "Dipakai semua produk. Jumlah per produk diatur di halaman HPP "
                        + "produk masing-masing."));

        int n = packing == null ? 0 : packing.length();
        double totalDefault = 0;
        for (int i = 0; i < n; i++) {
            JSONObject o = packing.optJSONObject(i);
            if (o != null) totalDefault += num(o, "defaultQuantity") * num(o, "unitCost");
        }
        if (n > 0) {
            TextView tot = catatan(this, "Default: " + rp(totalDefault) + " / resi");
            tot.setTextColor(Color.parseColor(INK));
            root.addView(tot);
        } else {
            root.addView(catatan(this,
                    "Belum ada bahan packing. Tambahkan dus, lakban, bubble wrap, "
                            + "dan sejenisnya."));
        }

        for (int i = 0; i < n; i++) {
            final JSONObject o = packing.optJSONObject(i);
            if (o == null) continue;
            final String id = str(o, "id", "");
            String nama = str(o, "name", "(tanpa nama)");
            String satuan = str(o, "unit", "");
            double qty = num(o, "defaultQuantity");
            double harga = num(o, "unitCost");
            double stok = num(o, "currentStock");

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, (int) (8 * d(this)), 0, (int) (8 * d(this)));

            LinearLayout kiri = new LinearLayout(this);
            kiri.setOrientation(LinearLayout.VERTICAL);
            kiri.setLayoutParams(new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            TextView nm = new TextView(this);
            nm.setText(nama + (satuan.isEmpty() ? "" : " (" + satuan + ")"));
            nm.setTextSize(14);
            nm.setTextColor(Color.parseColor(INK));
            kiri.addView(nm);
            TextView ket = new TextView(this);
            ket.setText(rp(harga) + " / " + (satuan.isEmpty() ? "satuan" : satuan)
                    + " · biaya default " + rp(qty * harga) + " / resi"
                    + " · stok " + angkaRapi(stok));
            ket.setTextSize(11);
            ket.setTextColor(Color.parseColor(INK2));
            kiri.addView(ket);
            row.addView(kiri);

            final EditText eq = isian(this, "1", angkaRapi(qty), true);
            eq.setWidth((int) (78 * d(this)));
            eq.setGravity(Gravity.END);
            row.addView(eq);

            MaterialButton simpan = tombol(this, "Simpan", v -> {
                double q = angka(eq);
                if (q <= 0) {
                    Toast.makeText(this, "Jumlah harus lebih dari nol",
                            Toast.LENGTH_SHORT).show();
                    return;
                }
                api.costingPackingUpdate(id, q, rr -> {
                    if (rr.ok()) muat();
                    else Toast.makeText(this, rr.message("Gagal menyimpan"),
                            Toast.LENGTH_LONG).show();
                });
            });
            row.addView(simpan);

            MaterialButton hapus = tombol(this, "Hapus", v -> new AlertDialog.Builder(this)
                    .setTitle("Hapus " + nama + " dari daftar packing?")
                    .setMessage("Bahannya tetap ada di katalog. Jumlah khusus yang sudah "
                            + "diatur di tiap produk untuk bahan ini ikut terhapus.")
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Hapus", (dd, w) -> api.costingPackingRemove(id, rr -> {
                        if (rr.ok()) muat();
                        else Toast.makeText(this, rr.message("Gagal menghapus"),
                                Toast.LENGTH_LONG).show();
                    }))
                    .show());
            hapus.setTextColor(Color.parseColor("#B3261E"));
            row.addView(hapus);

            root.addView(row);
            root.addView(garis(this));
        }

        root.addView(tombol(this, "+ Tambah bahan packing", v -> dialogTambahPacking()));
    }

    /**
     * Memilih dari master data adalah bawaannya, membuat baru pengecualian.
     *
     * Mengetik nama yang sudah ada adalah cara "Dus" dan "dus" menjadi dua
     * bahan dengan stok dan harga masing-masing.
     */
    private void dialogTambahPacking() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (16 * d(this));
        box.setPadding(p, p, p, p);

        final List<String[]> tersedia = new ArrayList<>();   // {id, label}
        Set<String> terpakai = new LinkedHashSet<>();
        for (int i = 0; packing != null && i < packing.length(); i++) {
            JSONObject o = packing.optJSONObject(i);
            if (o != null) terpakai.add(str(o, "materialId", ""));
        }
        for (int i = 0; katalogBahan != null && i < katalogBahan.length(); i++) {
            JSONObject o = katalogBahan.optJSONObject(i);
            if (o == null) continue;
            String id = str(o, "id", "");
            if (terpakai.contains(id)) continue;
            String satuan = str(o, "unit", "");
            tersedia.add(new String[]{id, str(o, "name", "(tanpa nama)")
                    + (satuan.isEmpty() ? "" : " (" + satuan + ")")
                    + " — " + rp(num(o, "unitCost"))});
        }

        final Spinner sp = new Spinner(this);
        List<String> labels = new ArrayList<>();
        labels.add("— pilih bahan dari master —");
        for (String[] x : tersedia) labels.add(x[1]);
        sp.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, labels));
        box.addView(label(this, "Dari master data"));
        box.addView(sp);

        box.addView(label(this, "Atau bahan baru — nama"));
        final EditText eNama = isian(this, "mis. Dus, Lakban, Bubble Wrap", "", false);
        box.addView(eNama);
        box.addView(label(this, "Satuan"));
        final EditText eSatuan = isian(this, "pcs", "", false);
        box.addView(eSatuan);
        box.addView(label(this, "Harga satuan"));
        final EditText eHarga = isian(this, "0", "", true);
        box.addView(eHarga);

        box.addView(label(this, "Jumlah default per resi"));
        final EditText eQty = isian(this, "1", "1", true);
        box.addView(eQty);
        box.addView(catatan(this,
                "Kalau namanya sudah ada di master data, bahan yang lama yang dipakai "
                        + "— tidak dibuat ganda."));

        ScrollView sv = new ScrollView(this);
        sv.addView(box);

        new AlertDialog.Builder(this)
                .setTitle("Tambah bahan packing")
                .setView(sv)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Tambah", (dd, w) -> {
                    double q = angka(eQty);
                    if (q <= 0) {
                        Toast.makeText(this, "Jumlah default harus lebih dari nol",
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    JSONObject body = new JSONObject();
                    try {
                        body.put("defaultQuantity", q);
                        int pos = sp.getSelectedItemPosition();
                        String nama = eNama.getText().toString().trim();
                        if (pos > 0) {
                            body.put("materialId", tersedia.get(pos - 1)[0]);
                        } else if (!nama.isEmpty()) {
                            body.put("materialName", nama);
                            String st = eSatuan.getText().toString().trim();
                            if (!st.isEmpty()) body.put("unit", st);
                            body.put("unitCost", angka(eHarga));
                        } else {
                            Toast.makeText(this, "Pilih bahan dari master atau isi namanya",
                                    Toast.LENGTH_LONG).show();
                            return;
                        }
                    } catch (Exception ignored) {}
                    api.costingPackingAdd(body, rr -> {
                        if (rr.ok()) muat();
                        else Toast.makeText(this, rr.message("Gagal menambah"),
                                Toast.LENGTH_LONG).show();
                    });
                })
                .show();
    }

    /* ---------------------------------------------------------- penyaring */

    private void penyaring() {
        root.addView(judul(this, "Tampilkan"));

        final Spinner spUrut = new Spinner(this);
        spUrut.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, URUT_LABEL));
        spUrut.setSelection(indeks(URUT_NILAI, urut));
        root.addView(spUrut);

        // Jendela hari HANYA untuk urutan terlaris. Sebuah margin bukan "30
        // hari", dan kontrol yang tetap terpampang sambil tidak mengerjakan
        // apa pun mengajari orang mengabaikan kontrol.
        final Spinner spHari = new Spinner(this);
        spHari.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, HARI_LABEL));
        spHari.setSelection(indeks(HARI_NILAI, hari));
        spHari.setVisibility("terlaris".equals(urut) ? View.VISIBLE : View.GONE);
        root.addView(spHari);

        final Spinner spBrand = new Spinner(this);
        List<String> labelBrand = new ArrayList<>();
        labelBrand.add("Semua brand");
        for (String[] b : brands) labelBrand.add(b[1]);
        labelBrand.add("Tanpa brand");
        spBrand.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, labelBrand));
        int posBrand = 0;
        if ("none".equals(brand)) {
            posBrand = labelBrand.size() - 1;
        } else if (!brand.isEmpty()) {
            for (int i = 0; i < brands.size(); i++) {
                if (brand.equals(brands.get(i)[0])) posBrand = i + 1;
            }
        }
        spBrand.setSelection(posBrand);
        root.addView(spBrand);

        root.addView(tombol(this, "Terapkan", v -> {
            urut = URUT_NILAI[Math.max(0, spUrut.getSelectedItemPosition())];
            hari = HARI_NILAI[Math.max(0, spHari.getSelectedItemPosition())];
            int pb = spBrand.getSelectedItemPosition();
            if (pb <= 0) brand = "";
            else if (pb == labelBrand.size() - 1) brand = "none";
            else brand = brands.get(pb - 1)[0];
            // Pilihan dilepas: setelah menyaring, yang tampil bukan lagi
            // produk yang tadi dipilih, dan mengubah massal sesuatu yang
            // tidak terlihat adalah cara membuat kejutan.
            dipilih.clear();
            muat();
        }));
        root.addView(garis(this));
    }

    private static int indeks(String[] arr, String nilai) {
        for (int i = 0; i < arr.length; i++) if (arr[i].equals(nilai)) return i;
        return 0;
    }

    /* ------------------------------------------------------ baris produk */

    /**
     * Memilih apa yang ADA DI LAYAR, yang setelah disaring bukan seluruh
     * katalog.
     *
     * Karena itu tulisannya "yang tampil", bukan "semua": mengatakan "semua"
     * sambil memaksudkan "yang ini" adalah cara sebuah pengubahan massal
     * mengejutkan orang, dan pengubahan massal tidak punya pembatalan.
     */
    private View pilihSemua(final int n) {
        final CheckBox cb = new CheckBox(this);
        cb.setText("Pilih semua yang tampil (" + n + ")");
        cb.setTextSize(13);
        cb.setTextColor(Color.parseColor(INK2));
        cb.setChecked(dipilih.size() == n && n > 0);
        cb.setOnClickListener(v -> {
            dipilih.clear();
            if (cb.isChecked()) {
                for (int i = 0; produk != null && i < produk.length(); i++) {
                    JSONObject o = produk.optJSONObject(i);
                    if (o != null) dipilih.add(str(o, "productId", ""));
                }
            }
            gambar();
        });
        return cb;
    }

    private void barisTerpilih() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        int p = (int) (10 * d(this));
        bar.setPadding(p, p, p, p);
        bar.setBackgroundColor(Color.parseColor("#F1F6F2"));

        TextView t = new TextView(this);
        t.setText(dipilih.size() + " produk dipilih");
        t.setTextSize(13);
        t.setTextColor(Color.parseColor(INK));
        t.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(t);

        bar.addView(tombol(this, "Batal pilih", v -> {
            dipilih.clear();
            gambar();
        }));
        bar.addView(tombol(this, "Ubah komposisi harga", v -> dialogMassal()));
        root.addView(bar);
    }

    private View barisProduk(final JSONObject o) {
        final String id = str(o, "productId", "");
        String nama = str(o, "name", "(tanpa nama)");
        String sku = str(o, "sku", "");
        int jumlahBahan = (int) num(o, "materialCount");
        boolean hargaKurang = o.optBoolean("missingCost", false);
        double hpp = num(o, "hpp");
        boolean adaHarga = o.has("publishPrice") && !o.isNull("publishPrice");
        double harga = num(o, "publishPrice");
        boolean adaLaba = o.has("netProfit") && !o.isNull("netProfit");
        double laba = num(o, "netProfit");
        boolean adaMargin = o.has("netMarginRate") && !o.isNull("netMarginRate");
        double margin = num(o, "netMarginRate");
        double terjual = num(o, "soldQty");

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        int p = (int) (10 * d(this));
        row.setPadding(0, p, 0, p);

        final CheckBox cb = new CheckBox(this);
        cb.setChecked(dipilih.contains(id));
        cb.setOnClickListener(v -> {
            if (cb.isChecked()) dipilih.add(id);
            else dipilih.remove(id);
            gambar();
        });
        row.addView(cb);

        LinearLayout kiri = new LinearLayout(this);
        kiri.setOrientation(LinearLayout.VERTICAL);
        kiri.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView nm = new TextView(this);
        nm.setText(nama);
        nm.setTextSize(14);
        nm.setTextColor(Color.parseColor(INK));
        nm.setTypeface(nm.getTypeface(), Typeface.BOLD);
        kiri.addView(nm);

        if (!sku.isEmpty()) {
            TextView s = new TextView(this);
            s.setText(sku);
            s.setTextSize(11);
            s.setTextColor(Color.parseColor(INK3));
            kiri.addView(s);
        }

        // Keadaan bahan baku dibedakan bertingkat: belum ada bahan sama sekali,
        // ada tapi harganya belum lengkap, dan lengkap. Ketiganya menuntut
        // tindakan yang berbeda, dan "belum lengkap" adalah yang paling
        // berbahaya karena HPP-nya terlihat wajar padahal kurang.
        TextView bahan = new TextView(this);
        if (jumlahBahan == 0) {
            bahan.setText("Belum ada bahan");
            bahan.setTextColor(Color.parseColor(INK3));
        } else if (hargaKurang) {
            bahan.setText(jumlahBahan + " bahan · harga belum lengkap");
            bahan.setTextColor(Color.parseColor(PERHATIAN));
        } else {
            bahan.setText(jumlahBahan + " bahan");
            bahan.setTextColor(Color.parseColor(OK));
        }
        bahan.setTextSize(11);
        kiri.addView(bahan);

        StringBuilder ang = new StringBuilder();
        ang.append("HPP ").append(rp(hpp));
        ang.append(" · Publish ").append(adaHarga ? rp(harga) : "—");
        if (terjual > 0) {
            ang.append(" · Terjual ").append(angkaRapi(terjual))
               .append(" (").append(labelHari()).append(")");
        }
        TextView a = new TextView(this);
        a.setText(ang.toString());
        a.setTextSize(11);
        a.setTextColor(Color.parseColor(INK2));
        kiri.addView(a);
        row.addView(kiri);

        LinearLayout kanan = new LinearLayout(this);
        kanan.setOrientation(LinearLayout.VERTICAL);
        kanan.setGravity(Gravity.END);

        TextView lb = new TextView(this);
        lb.setText(adaLaba ? rp(laba) : "—");
        lb.setTextSize(14);
        lb.setTextColor(Color.parseColor(
                !adaLaba ? INK3 : (laba < 0 ? "#B3261E" : INK)));
        kanan.addView(lb);

        TextView mg = new TextView(this);
        mg.setText(adaMargin
                ? String.format(Locale.US, "%.1f%%", margin * 100)
                : "margin —");
        mg.setTextSize(11);
        mg.setTextColor(Color.parseColor(!adaMargin
                ? INK3
                : (margin < 0 ? "#B3261E" : (margin < 0.10 ? PERHATIAN : OK))));
        kanan.addView(mg);
        row.addView(kanan);

        row.setOnClickListener(v -> {
            Intent i = new Intent(this, HppDetailActivity.class);
            i.putExtra("productId", id);
            i.putExtra("nama", nama);
            i.putExtra("sku", sku);
            startActivity(i);
        });

        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.addView(row);
        wrap.addView(garis(this));
        return wrap;
    }

    private String labelHari() {
        return HARI_LABEL[indeks(HARI_NILAI, hari)];
    }

    /* --------------------------------------------------- ubah massal */

    /**
     * Satu set tarif untuk banyak produk sekaligus.
     *
     * Angka-angka ini sama untuk hampir seluruh katalog dan berubah bersamaan:
     * marketplace menaikkan fee, program afiliasi dimulai, porsi sedekah
     * disepakati sekali. Menyuntingnya satu produk demi satu adalah cara
     * membuatnya tidak konsisten, dan margin yang tidak konsisten tidak
     * dipercaya siapa pun.
     *
     * KOLOM YANG DIKOSONGKAN TIDAK DIUBAH. Itu seluruh keamanan layar ini, dan
     * dikatakan sebelum tombolnya ditekan, bukan sesudah kerusakannya.
     */
    private void dialogMassal() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (16 * d(this));
        box.setPadding(p, p, p, p);

        TextView warn = new TextView(this);
        warn.setText("Kolom yang dikosongkan TIDAK diubah — hanya yang Anda isi yang "
                + "ditulis ke semua produk terpilih. Tidak ada pembatalan setelah disimpan.");
        warn.setTextSize(12);
        warn.setTextColor(Color.parseColor(PERHATIAN));
        box.addView(warn);

        final EditText[] isi = new EditText[KOLOM_MASSAL.length];
        for (int i = 0; i < KOLOM_MASSAL.length; i++) {
            boolean persen = !KOLOM_MASSAL[i][2].isEmpty();
            box.addView(label(this, KOLOM_MASSAL[i][1] + (persen ? " (%)" : "")));
            isi[i] = isian(this, "biarkan kosong = tidak diubah", "", true);
            box.addView(isi[i]);
        }

        ScrollView sv = new ScrollView(this);
        sv.addView(box);

        new AlertDialog.Builder(this)
                .setTitle("Ubah komposisi harga — " + dipilih.size() + " produk")
                .setView(sv)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Terapkan", (dd, w) -> {
                    JSONObject body = new JSONObject();
                    int terisi = 0;
                    try {
                        JSONArray ids = new JSONArray();
                        for (String s : dipilih) ids.put(s);
                        body.put("productIds", ids);
                        for (int i = 0; i < KOLOM_MASSAL.length; i++) {
                            String teks = isi[i].getText().toString().trim();
                            if (teks.isEmpty()) continue;
                            double n = angka(isi[i]);
                            if (n < 0) {
                                Toast.makeText(this, KOLOM_MASSAL[i][1]
                                        + " bukan angka yang benar", Toast.LENGTH_LONG).show();
                                return;
                            }
                            boolean persen = !KOLOM_MASSAL[i][2].isEmpty();
                            // Persentase diketik seperti orang mengucapkannya
                            // dan disimpan seperti yang dimau kalkulatornya.
                            body.put(KOLOM_MASSAL[i][0], persen ? n / 100 : n);
                            terisi++;
                        }
                    } catch (Exception ignored) {}
                    if (terisi == 0) {
                        Toast.makeText(this, "Isi minimal satu kolom",
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    api.costingUpdateMany(body, rr -> {
                        if (!rr.ok()) {
                            Toast.makeText(this, rr.message("Gagal menyimpan"),
                                    Toast.LENGTH_LONG).show();
                            return;
                        }
                        int n = rr.data() == null ? dipilih.size()
                                : rr.data().optInt("updated", dipilih.size());
                        Toast.makeText(this, n + " produk diperbarui",
                                Toast.LENGTH_LONG).show();
                        dipilih.clear();
                        muat();
                    });
                })
                .show();
    }

    /* ------------------------------------------------------------ saran AI */

    private View tombolSaran() {
        MaterialButton b = tombol(this, "Saran AI atas margin katalog", v -> {
            Toast.makeText(this, "Membaca margin tiap produk…", Toast.LENGTH_SHORT).show();
            api.costingSaran(r -> {
                if (!r.ok() || r.data() == null) {
                    Toast.makeText(this, r.message("Saran AI gagal dipanggil"),
                            Toast.LENGTH_LONG).show();
                    return;
                }
                JSONObject d = r.data();
                StringBuilder sb = new StringBuilder();
                if (!d.optBoolean("tersedia", false)) {
                    // Sebabnya ditampilkan apa adanya, bukan "gagal". Sampai
                    // hari ini penyebabnya selalu satu: API key-nya belum
                    // diisi, dan itu bisa diperbaiki sendiri oleh pemiliknya.
                    sb.append(str(d, "alasan", "Saran AI belum tersedia."));
                    String cara = str(d, "caraSetel", "");
                    if (!cara.isEmpty()) sb.append("\n\n").append(cara);
                } else {
                    JSONArray a = d.optJSONArray("saran");
                    if (a == null || a.length() == 0) {
                        sb.append("Tidak ada yang perlu dibenahi menurut AI.");
                    }
                    for (int i = 0; a != null && i < a.length(); i++) {
                        JSONObject s = a.optJSONObject(i);
                        if (s == null) continue;
                        sb.append("• ").append(str(s, "judul", "(tanpa judul)"));
                        String dampak = str(s, "dampak", "");
                        if (!dampak.isEmpty()) sb.append("  [").append(dampak).append("]");
                        String alasan = str(s, "alasan", "");
                        if (!alasan.isEmpty()) sb.append("\n   ").append(alasan);
                        sb.append("\n\n");
                    }
                }
                new AlertDialog.Builder(this)
                        .setTitle("Saran AI")
                        .setMessage(sb.toString().trim())
                        .setPositiveButton("Tutup", null)
                        .show();
            });
        });
        b.setLayoutParams(PayoutUi.lebar(this));
        return b;
    }

    /* ------------------------------------------------------------ pembantu */

    /** "2" bukan "2.0"; "0.5" tetap "0.5". */
    static String angkaRapi(double v) {
        if (Math.abs(v - Math.round(v)) < 0.0005) return String.valueOf(Math.round(v));
        return String.format(Locale.US, "%.3f", v).replaceAll("0+$", "").replaceAll("\\.$", "");
    }
}
