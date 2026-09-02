package id.autotoko.scanner;

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
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
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
import java.util.List;
import java.util.Locale;

/**
 * Hitung HPP dan susun harga jual satu produk.
 *
 * DUA BAGIAN, dan urutannya bukan selera: harga pokok dulu, baru harga jual.
 * Menyusun harga sebelum tahu biayanya adalah menebak, dan tebakan itulah yang
 * membuat produk terlihat untung di layar sambil merugi di rekening.
 *
 * AIR TERJUNNYA DIHITUNG DI PONSEL, bukan diminta ke server tiap ketukan.
 * Angka yang tertinggal di belakang jari membuat orang berhenti mempercayainya,
 * dan yang lebih buruk lagi: membuat orang menyimpan lebih dulu untuk melihat
 * akibatnya. Hitungannya ada di HargaJual, tiruan persis dari kalkulator yang
 * dipakai web dan backend, dan HargaJualTest yang menjaganya tidak menyimpang.
 *
 * SATU TOMBOL SIMPAN UNTUK SELURUH TABEL BAHAN. Di web, tombol simpan per baris
 * pernah menyebabkan tiga baris disunting lalu satu ditekan: satu baris
 * tersimpan, dua lainnya hilang tanpa ada yang gagal dan tanpa ada yang
 * memberi tahu. Satu tombol untuk tabel yang dilihatnya tidak bisa kehilangan
 * suntingan yang ada di depan matanya.
 */
public class HppDetailActivity extends AppCompatActivity {

    /** {kunci, label, keterangan} — enam tarif, urutannya seperti di web. */
    private static final String[][] TARIF = {
        {"marketplaceFeeRate", "Biaya Marketplace", "% dari harga publish"},
        {"eventRate", "Biaya Event", "% dari harga publish"},
        {"affiliatorRate", "Biaya Affiliator", "% dari harga publish"},
        {"adsRate", "Biaya Iklan", "% dari harga publish"},
        {"sedekahRate", "Sedekah", "% dari dana yang dicairkan"},
        {"resellerRate", "Reseller / Sub-seller", "% dari sisa setelah sedekah"},
    };

    private Session session;
    private Api api;
    private LinearLayout root;

    private String productId;
    private String namaProduk = "";
    private String skuProduk = "";

    private JSONObject detail;
    private JSONArray katalogBahan;
    private JSONObject saranBiaya;

    /** Baris resep di layar, beserta nilai aslinya untuk membandingkan. */
    private static final class BarisBahan {
        String id;
        String nama;
        double qtyAsli;
        double hargaAsli;
        int dipakaiProduk;
        boolean tertaut;
        EditText eQty;
        EditText eHarga;
        TextView tSub;
        TextView tPeringatan;
    }
    private final List<BarisBahan> baris = new ArrayList<>();

    /* --- isian bagian harga jual, dipegang supaya bisa dihitung ulang --- */
    private EditText eHargaPublish;
    private final EditText[] eTarif = new EditText[TARIF.length];
    private EditText eIklanTetap;
    private EditText eTarget;
    private TextView[] airLabel;
    private TextView[] airNilai;
    private TextView tLaba;
    private TextView tMargin;
    private TextView tRugi;
    private TextView tSaranHarga;
    private MaterialButton bPakaiSaran;
    private TextView tBelumDisimpan;

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
        productId = getIntent().getStringExtra("productId");
        if (getIntent().getStringExtra("nama") != null) {
            namaProduk = getIntent().getStringExtra("nama");
        }
        if (getIntent().getStringExtra("sku") != null) {
            skuProduk = getIntent().getStringExtra("sku");
        }
        if (productId == null || productId.isEmpty()) {
            Toast.makeText(this, "Produk tidak dikenali", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        setTitle("Hitung HPP & Harga Jual");

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.parseColor("#FAF9F6"));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (16 * d(this));
        root.setPadding(p, p, p, (int) (40 * d(this)));
        sv.addView(root);
        setContentView(sv);

        muat();
    }

    private void muat() {
        api.costingDetail(productId, r -> {
            if (!r.ok() || r.data() == null) {
                root.removeAllViews();
                root.addView(judul(this, namaProduk));
                TextView t = catatan(this, r.message("Gagal memuat data HPP"));
                t.setTextColor(Color.parseColor("#B3261E"));
                root.addView(t);
                root.addView(tombol(this, "Coba lagi", v -> muat()));
                return;
            }
            detail = r.data();
            api.materials(rm -> {
                katalogBahan = rm.ok() ? rm.dataArray() : new JSONArray();
                api.biayaMarketplace(rb -> {
                    saranBiaya = rb.ok() ? rb.data() : null;
                    gambar();
                });
            });
        });
    }

    /* ---------------------------------------------------------- menggambar */

    private void gambar() {
        root.removeAllViews();
        baris.clear();

        JSONObject prod = detail.optJSONObject("product");
        if (prod != null) {
            namaProduk = str(prod, "name", namaProduk);
            skuProduk = str(prod, "sku", skuProduk);
        }
        TextView t = judul(this, namaProduk);
        t.setPadding(0, 0, 0, 0);
        root.addView(t);
        if (!skuProduk.isEmpty()) root.addView(catatan(this, "SKU " + skuProduk));

        bagianPackingProduk();
        bagianHpp();
        bagianHargaJual();
    }

    /* ------------------------------------- bahan packing untuk produk ini */

    /**
     * Daftar bahan packing dipakai semua produk; jumlahnya tidak.
     *
     * Produk yang belum menetapkan jumlahnya sendiri mewarisi default bersama,
     * dan itu DIKATAKAN -- kalau tidak, tidak ada yang bisa membedakan angka
     * yang dipilih di sini dengan angka yang datang dari tempat lain, dan
     * mengubah default bersama akan terlihat seperti tidak melakukan apa-apa.
     */
    private void bagianPackingProduk() {
        JSONArray a = detail.optJSONArray("packingMaterials");
        if (a == null || a.length() == 0) return;

        root.addView(judul(this, "Bahan Packing Produk Ini"));
        double total = 0;
        for (int i = 0; i < a.length(); i++) {
            final JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            final String id = str(o, "id", "");
            String nama = str(o, "name", "(tanpa nama)");
            String satuan = str(o, "unit", "");
            final double qty = num(o, "quantity");
            double bawaan = num(o, "defaultQuantity");
            double harga = num(o, "unitCost");
            double sub = num(o, "lineCost");
            final boolean khusus = o.optBoolean("isOverride", false);
            total += sub;

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
            ket.setText(rp(harga) + " × " + HppActivity.angkaRapi(qty) + " = " + rp(sub)
                    + " / resi · " + (khusus
                        ? "jumlah khusus produk ini (default " + HppActivity.angkaRapi(bawaan) + ")"
                        : "ikut default bersama"));
            ket.setTextSize(11);
            ket.setTextColor(Color.parseColor(khusus ? INK : INK2));
            kiri.addView(ket);
            row.addView(kiri);

            final EditText eq = isian(this, HppActivity.angkaRapi(bawaan),
                    HppActivity.angkaRapi(qty), true);
            eq.setWidth((int) (74 * d(this)));
            eq.setGravity(Gravity.END);
            row.addView(eq);

            row.addView(tombol(this, "Simpan", v -> {
                double q = angka(eq);
                if (q <= 0) {
                    Toast.makeText(this, "Jumlah harus lebih dari nol",
                            Toast.LENGTH_SHORT).show();
                    return;
                }
                api.costingSetProductPacking(productId, id, q, rr -> {
                    if (rr.ok()) muat();
                    else Toast.makeText(this, rr.message("Gagal menyimpan"),
                            Toast.LENGTH_LONG).show();
                });
            }));

            if (khusus) {
                // Mengembalikan ke default BUKAN sama dengan mengisi nol.
                // Nol berarti "bahan ini tidak dipakai produk ini"; kembali ke
                // default berarti "ikut apa pun yang berlaku umum nanti".
                row.addView(tombol(this, "Ke default",
                        v -> api.costingSetProductPacking(productId, id, null, rr -> {
                            if (rr.ok()) muat();
                            else Toast.makeText(this, rr.message("Gagal"),
                                    Toast.LENGTH_LONG).show();
                        })));
            }
            root.addView(row);
            root.addView(garis(this));
        }
        TextView tot = catatan(this, "Total bahan packing: " + rp(total) + " / resi");
        tot.setTextColor(Color.parseColor(INK));
        root.addView(tot);
    }

    /* ---------------------------------------------- 1 · harga pokok produksi */

    private void bagianHpp() {
        root.addView(judul(this, "1 · Harga Pokok Produksi"));
        root.addView(catatan(this,
                "Takaran bahan baku untuk 1 pcs produk, dikali harga satuannya."));

        JSONArray bahan = detail.optJSONArray("materials");
        int n = bahan == null ? 0 : bahan.length();
        if (n == 0) {
            root.addView(catatan(this,
                    "Belum ada bahan baku. Tambahkan bahan beserta takarannya untuk "
                            + "1 pcs produk, lalu isi harga satuannya."));
        }
        for (int i = 0; i < n; i++) {
            JSONObject o = bahan.optJSONObject(i);
            if (o != null) root.addView(barisBahan(o));
        }

        JSONObject hpp = detail.optJSONObject("hpp");
        double biayaBahan = hpp == null ? 0 : num(hpp, "materialCost");
        TextView tot = catatan(this, "Total bahan baku: " + rp(biayaBahan));
        tot.setTextColor(Color.parseColor(INK));
        tot.setTypeface(tot.getTypeface(), Typeface.BOLD);
        root.addView(tot);

        if (n > 0) {
            root.addView(tombol(this, "Simpan perubahan takaran & harga",
                    v -> simpanBaris()));
        }
        root.addView(tombol(this, "+ Tambah bahan baku", v -> dialogTambahBahan()));
        root.addView(garis(this));

        /* ---- biaya jasa, packing, dan pembaginya ---- */
        JSONObject c = detail.optJSONObject("costing");
        final double jasaAsli = c == null ? 0 : num(c, "serviceCostPerPcs");
        final double packingAsli = c == null ? 0 : num(c, "packingCostPerOrder");
        final double avgAsli = c == null ? 1 : num(c, "avgUnitsPerOrder");

        root.addView(label(this, "Biaya Jasa Produksi / pcs"));
        root.addView(catatan(this, "Ongkos produksi di luar bahan baku (jahit, rakit, dll)."));
        final EditText eJasa = isian(this, "0", HppActivity.angkaRapi(jasaAsli), true);
        root.addView(eJasa);

        root.addView(label(this, "Biaya Packing Lain / resi"));
        root.addView(catatan(this, "Dibayar sekali per pengiriman, bukan per pcs."));
        final EditText ePacking = isian(this, "0", HppActivity.angkaRapi(packingAsli), true);
        root.addView(ePacking);

        root.addView(label(this, "Rata-rata pcs / resi"));
        root.addView(catatan(this, "Pembagi biaya packing agar jadi per produk."));
        final EditText eAvg = isian(this, "1", HppActivity.angkaRapi(avgAsli), true);
        root.addView(eAvg);

        // Packing dibayar per pengiriman sementara HPP dihitung per produk,
        // jadi biayanya harus dibagi sebanyak pcs yang berangkat bersama.
        // Pembagiannya diperlihatkan, bukan cuma hasilnya -- angka yang muncul
        // tanpa asalnya adalah angka yang tidak bisa diperiksa.
        final TextView tBagi = catatan(this, "");
        root.addView(tBagi);
        Runnable perbaruiBagi = () -> {
            double pk = angka(ePacking);
            double av = angka(eAvg) > 0 ? angka(eAvg) : 1;
            tBagi.setText(pk <= 0 ? ""
                    : rp(pk) + " per resi ÷ " + HppActivity.angkaRapi(av) + " pcs = "
                            + rp(pk / av) + " per produk");
        };
        perbaruiBagi.run();
        TextWatcher w = new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(Editable s) { perbaruiBagi.run(); }
        };
        ePacking.addTextChangedListener(w);
        eAvg.addTextChangedListener(w);

        root.addView(tombol(this, "Hitung rata-rata dari riwayat order", v ->
                api.costingAvgUnits(r -> {
                    if (!r.ok() || r.data() == null) {
                        Toast.makeText(this, r.message("Gagal menghitung"),
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    JSONObject dd = r.data();
                    if (dd.isNull("suggested")) {
                        Toast.makeText(this, "Belum ada data order untuk dihitung.",
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    double s = num(dd, "suggested");
                    int dasar = (int) num(dd, "basedOnOrders");
                    eAvg.setText(HppActivity.angkaRapi(s));
                    Toast.makeText(this, "Rata-rata " + HppActivity.angkaRapi(s)
                            + " pcs per order, dari " + dasar + " order terakhir.",
                            Toast.LENGTH_LONG).show();
                })));

        root.addView(tombol(this, "Simpan biaya produksi & packing", v -> {
            JSONObject body = new JSONObject();
            try {
                body.put("serviceCostPerPcs", angka(eJasa));
                body.put("packingCostPerOrder", angka(ePacking));
                // Pembagi tidak boleh nol: hasilnya tak berhingga, dan yang
                // muncul di layar adalah HPP yang tidak masuk akal tanpa sebab
                // yang kelihatan.
                body.put("avgUnitsPerOrder", Math.max(0.01, angka(eAvg)));
            } catch (Exception ignored) {}
            api.costingUpdate(productId, body, r -> {
                if (r.ok()) {
                    Toast.makeText(this, "Biaya produksi & packing disimpan",
                            Toast.LENGTH_SHORT).show();
                    muat();
                } else {
                    Toast.makeText(this, r.message("Gagal menyimpan"),
                            Toast.LENGTH_LONG).show();
                }
            });
        }));

        /* ---- rincian HPP ---- */
        if (hpp != null) {
            root.addView(garis(this));
            root.addView(rincian("Total bahan baku", rp(num(hpp, "materialCost")), false));
            root.addView(rincian("Biaya jasa produksi", rp(num(hpp, "serviceCost")), false));
            if (num(hpp, "packingMaterialCost") > 0) {
                root.addView(rincian("Bahan baku packing ("
                        + rp(num(hpp, "packingMaterialPerOrder")) + "/resi ÷ "
                        + HppActivity.angkaRapi(avgAsli) + " pcs)",
                        rp(num(hpp, "packingMaterialCost")), false));
            }
            if (num(hpp, "packingOtherCost") > 0) {
                root.addView(rincian("Biaya packing lain ("
                        + rp(num(hpp, "packingOtherPerOrder")) + "/resi ÷ "
                        + HppActivity.angkaRapi(avgAsli) + " pcs)",
                        rp(num(hpp, "packingOtherCost")), false));
            }
            root.addView(rincian("Harga Pokok Produksi / pcs", rp(num(hpp, "total")), true));
        }
    }

    private View barisBahan(final JSONObject o) {
        final BarisBahan b = new BarisBahan();
        b.id = str(o, "id", "");
        b.nama = str(o, "materialName", "(tanpa nama)");
        b.qtyAsli = num(o, "quantity");
        b.hargaAsli = num(o, "unitCost");
        b.dipakaiProduk = o.has("usedByProducts") && !o.isNull("usedByProducts")
                ? (int) num(o, "usedByProducts") : 1;
        b.tertaut = !o.has("isLinked") || o.isNull("isLinked") || o.optBoolean("isLinked", true);
        final String satuan = str(o, "unit", "");

        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setPadding(0, (int) (8 * d(this)), 0, (int) (8 * d(this)));

        TextView nm = new TextView(this);
        nm.setText(b.nama + (satuan.isEmpty() ? "" : "  ·  satuan " + satuan));
        nm.setTextSize(14);
        nm.setTextColor(Color.parseColor(INK));
        wrap.addView(nm);

        if (b.dipakaiProduk > 1) {
            TextView dp = new TextView(this);
            dp.setText("dipakai " + b.dipakaiProduk + " produk");
            dp.setTextSize(11);
            dp.setTextColor(Color.parseColor(INK3));
            wrap.addView(dp);
        }
        if (!b.tertaut) {
            LinearLayout tl = new LinearLayout(this);
            tl.setOrientation(LinearLayout.HORIZONTAL);
            TextView bm = new TextView(this);
            bm.setText("belum di master data");
            bm.setTextSize(11);
            bm.setTextColor(Color.parseColor(INK3));
            bm.setLayoutParams(new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            tl.addView(bm);
            tl.addView(tombol(this, "Tautkan", v ->
                    api.costingLinkMaterial(b.id, null, r -> {
                        if (r.ok()) muat();
                        else Toast.makeText(this, r.message("Gagal menautkan"),
                                Toast.LENGTH_LONG).show();
                    })));
            wrap.addView(tl);
        }

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);

        LinearLayout kq = new LinearLayout(this);
        kq.setOrientation(LinearLayout.VERTICAL);
        kq.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        kq.addView(label(this, "Takaran / pcs"));
        b.eQty = isian(this, "0", HppActivity.angkaRapi(b.qtyAsli), true);
        kq.addView(b.eQty);
        row.addView(kq);

        LinearLayout kh = new LinearLayout(this);
        kh.setOrientation(LinearLayout.VERTICAL);
        kh.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        kh.addView(label(this, "Harga satuan"));
        b.eHarga = isian(this, "0", HppActivity.angkaRapi(b.hargaAsli), true);
        kh.addView(b.eHarga);
        row.addView(kh);
        wrap.addView(row);

        b.tSub = catatan(this, "Subtotal " + rp(b.qtyAsli * b.hargaAsli));
        b.tSub.setTextColor(Color.parseColor(INK));
        wrap.addView(b.tSub);

        b.tPeringatan = catatan(this, "");
        b.tPeringatan.setTextColor(Color.parseColor(PERHATIAN));
        b.tPeringatan.setVisibility(View.GONE);
        wrap.addView(b.tPeringatan);

        TextWatcher w = new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int c, int dd) {}
            public void onTextChanged(CharSequence s, int a, int c, int dd) {}
            public void afterTextChanged(Editable s) {
                b.tSub.setText("Subtotal " + rp(angka(b.eQty) * angka(b.eHarga)));
                // Perubahan harga menjalar ke SETIAP produk yang memakai bahan
                // ini. Dikatakan sebelum disimpan, bukan ditinggalkan untuk
                // ditemukan sendiri nanti.
                boolean hargaBerubah = Math.abs(angka(b.eHarga) - b.hargaAsli) > 0.0001;
                if (b.dipakaiProduk > 1 && hargaBerubah) {
                    b.tPeringatan.setText("Dipakai " + b.dipakaiProduk
                            + " produk — harga ikut berubah di semuanya");
                    b.tPeringatan.setVisibility(View.VISIBLE);
                } else {
                    b.tPeringatan.setVisibility(View.GONE);
                }
            }
        };
        b.eQty.addTextChangedListener(w);
        b.eHarga.addTextChangedListener(w);

        MaterialButton hapus = tombol(this, "Hapus bahan ini", v ->
                new AlertDialog.Builder(this)
                        .setTitle("Hapus bahan baku ini?")
                        .setMessage("\"" + b.nama + "\" akan dihapus dari resep produk ini "
                                + "dan HPP dihitung ulang.")
                        .setNegativeButton("Batal", null)
                        .setPositiveButton("Hapus", (dd, x) ->
                                api.costingRemoveMaterial(b.id, r -> {
                                    if (r.ok()) {
                                        Toast.makeText(this, b.nama + " dihapus",
                                                Toast.LENGTH_SHORT).show();
                                        muat();
                                    } else {
                                        Toast.makeText(this, r.message("Gagal menghapus"),
                                                Toast.LENGTH_LONG).show();
                                    }
                                }))
                        .show());
        hapus.setTextColor(Color.parseColor("#B3261E"));
        wrap.addView(hapus);
        wrap.addView(garis(this));

        baris.add(b);
        return wrap;
    }

    /**
     * Menyimpan seluruh baris yang berubah, lalu memuat ulang SEKALI.
     *
     * Yang gagal disebut namanya. Satu baris bermasalah tidak boleh
     * meninggalkan yang lain setengah tertulis tanpa ada yang tahu baris mana.
     *
     * Penghitung di bawah tidak dikunci karena callback Api selalu tiba di
     * thread utama -- kalau itu berubah, penghitung ini yang pertama rusak.
     */
    private void simpanBaris() {
        final List<BarisBahan> berubah = new ArrayList<>();
        for (BarisBahan b : baris) {
            if (Math.abs(angka(b.eQty) - b.qtyAsli) > 0.0001
                    || Math.abs(angka(b.eHarga) - b.hargaAsli) > 0.0001) {
                berubah.add(b);
            }
        }
        if (berubah.isEmpty()) {
            Toast.makeText(this, "Tidak ada yang berubah", Toast.LENGTH_SHORT).show();
            return;
        }

        final int[] selesai = {0};
        final List<String> gagal = new ArrayList<>();
        for (final BarisBahan b : berubah) {
            api.costingUpdateMaterial(b.id, angka(b.eQty), angka(b.eHarga), r -> {
                if (!r.ok()) gagal.add(b.nama);
                selesai[0]++;
                if (selesai[0] < berubah.size()) return;
                if (gagal.isEmpty()) {
                    Toast.makeText(this, berubah.size() + " bahan diperbarui",
                            Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(this, "Gagal menyimpan: "
                            + android.text.TextUtils.join(", ", gagal),
                            Toast.LENGTH_LONG).show();
                }
                muat();
            });
        }
    }

    /**
     * Memilih dari master data adalah bawaannya; membuat baru pengecualian.
     *
     * Mengetik nama yang sudah ada adalah cara "Botol" dan "botol" menjadi dua
     * bahan berbeda dengan stok dan harga masing-masing.
     */
    private void dialogTambahBahan() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (16 * d(this));
        box.setPadding(p, p, p, p);

        final List<String[]> pilihan = new ArrayList<>();   // {id, label, harga}
        List<String> labels = new ArrayList<>();
        labels.add("— pilih bahan dari master —");
        for (int i = 0; katalogBahan != null && i < katalogBahan.length(); i++) {
            JSONObject o = katalogBahan.optJSONObject(i);
            if (o == null) continue;
            String satuan = str(o, "unit", "");
            pilihan.add(new String[]{str(o, "id", ""), str(o, "name", "(tanpa nama)"),
                    String.valueOf(num(o, "unitCost"))});
            labels.add(str(o, "name", "(tanpa nama)")
                    + (satuan.isEmpty() ? "" : " (" + satuan + ")")
                    + " — " + rp(num(o, "unitCost")));
        }
        final Spinner sp = new Spinner(this);
        sp.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, labels));
        box.addView(label(this, "Dari master data"));
        box.addView(catatan(this, "Harga & stok mengikuti master data."));
        box.addView(sp);

        box.addView(label(this, "Takaran / pcs"));
        box.addView(catatan(this, "Untuk 1 pcs produk."));
        final EditText eQty = isian(this, "0", "", true);
        box.addView(eQty);

        box.addView(garis(this));
        box.addView(label(this, "Atau bahan baru — nama"));
        final EditText eNama = isian(this, "mis. Biji Kopi Arabika", "", false);
        box.addView(eNama);
        box.addView(label(this, "Satuan"));
        final EditText eSatuan = isian(this, "kg, gram, meter, pcs…", "", false);
        box.addView(eSatuan);
        box.addView(label(this, "Harga satuan"));
        final EditText eHarga = isian(this, "0", "", true);
        box.addView(eHarga);
        box.addView(catatan(this,
                "Kalau namanya sudah ada di master data, bahan yang lama yang dipakai "
                        + "— tidak dibuat ganda."));

        ScrollView sv = new ScrollView(this);
        sv.addView(box);

        new AlertDialog.Builder(this)
                .setTitle("Tambah bahan baku")
                .setView(sv)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Tambah", (dd, w) -> {
                    double q = angka(eQty);
                    if (q <= 0) {
                        Toast.makeText(this, "Takaran harus lebih dari nol",
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    JSONObject body = new JSONObject();
                    try {
                        body.put("quantity", q);
                        int pos = sp.getSelectedItemPosition();
                        String nama = eNama.getText().toString().trim();
                        if (pos > 0) {
                            body.put("materialId", pilihan.get(pos - 1)[0]);
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
                    api.costingAddMaterial(productId, body, r -> {
                        if (r.ok()) {
                            Toast.makeText(this, "Bahan ditambahkan", Toast.LENGTH_SHORT).show();
                            muat();
                        } else {
                            Toast.makeText(this, r.message("Gagal menambah bahan"),
                                    Toast.LENGTH_LONG).show();
                        }
                    });
                })
                .show();
    }

    /* ------------------------------------------- 2 · harga publish & profit */

    private void bagianHargaJual() {
        root.addView(judul(this, "2 · Harga Publish & Profit"));
        root.addView(catatan(this,
                "Susun komposisi biaya, lalu lihat sisa bersih yang benar-benar "
                        + "diterima seller."));

        JSONObject c = detail.optJSONObject("costing");

        root.addView(label(this, "Harga Publish"));
        root.addView(catatan(this, "Harga yang tampil di marketplace."));
        boolean adaHarga = c != null && c.has("publishPrice") && !c.isNull("publishPrice");
        eHargaPublish = isian(this, "0",
                adaHarga ? HppActivity.angkaRapi(num(c, "publishPrice")) : "", true);
        root.addView(eHargaPublish);

        for (int i = 0; i < TARIF.length; i++) {
            root.addView(label(this, TARIF[i][1] + " (%)"));
            root.addView(catatan(this, TARIF[i][2]));
            eTarif[i] = isian(this, "0",
                    pctTeks(c == null ? 0 : num(c, TARIF[i][0])), true);
            root.addView(eTarif[i]);
        }

        saranBiayaMarketplace();

        root.addView(label(this, "Iklan Tetap / pcs"));
        root.addView(catatan(this, "Rupiah, di luar persentase."));
        eIklanTetap = isian(this, "0",
                HppActivity.angkaRapi(c == null ? 0 : num(c, "adsFixedPerPcs")), true);
        root.addView(eIklanTetap);

        root.addView(label(this, "Target Margin (%)"));
        root.addView(catatan(this, "Dipakai untuk saran harga."));
        eTarget = isian(this, "0",
                pctTeks(c == null ? 0 : num(c, "targetProfitRate")), true);
        root.addView(eTarget);

        tBelumDisimpan = catatan(this, "");
        tBelumDisimpan.setTextColor(Color.parseColor(PERHATIAN));
        root.addView(tBelumDisimpan);

        root.addView(tombol(this, "Simpan komposisi harga", v -> simpanKomposisi()));

        /* ---- saran harga dari target margin ---- */
        root.addView(garis(this));
        tSaranHarga = catatan(this, "");
        root.addView(tSaranHarga);
        bPakaiSaran = tombol(this, "Pakai harga ini", v -> {
            Long sen = hitungSaranSen();
            if (sen != null) {
                eHargaPublish.setText(String.valueOf(HargaJual.rupiahDariSen(sen)));
            }
        });
        root.addView(bPakaiSaran);

        /* ---- air terjun ---- */
        root.addView(judul(this, "Rincian sampai laba bersih"));
        String[] labelAir = {
            "Harga Publish", "Biaya Marketplace", "Biaya Event", "Biaya Affiliator",
            "Diterima dari Marketplace", "Sedekah", "Reseller / Sub-seller",
            "Bagian Seller", "Harga Pokok Produksi", "Biaya Iklan",
        };
        airLabel = new TextView[labelAir.length];
        airNilai = new TextView[labelAir.length];
        for (int i = 0; i < labelAir.length; i++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, (int) (7 * d(this)), 0, (int) (7 * d(this)));
            airLabel[i] = new TextView(this);
            airLabel[i].setText(labelAir[i]);
            airLabel[i].setTextSize(13);
            boolean tebal = i == 0 || i == 4 || i == 7;
            airLabel[i].setTextColor(Color.parseColor(tebal ? INK : INK2));
            if (tebal) {
                airLabel[i].setTypeface(airLabel[i].getTypeface(), Typeface.BOLD);
            }
            airLabel[i].setLayoutParams(new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            row.addView(airLabel[i]);
            airNilai[i] = new TextView(this);
            airNilai[i].setTextSize(13);
            airNilai[i].setTextColor(Color.parseColor(INK));
            row.addView(airNilai[i]);
            root.addView(row);
            root.addView(garis(this));
        }

        LinearLayout bawah = new LinearLayout(this);
        bawah.setOrientation(LinearLayout.HORIZONTAL);
        bawah.setPadding(0, (int) (12 * d(this)), 0, (int) (4 * d(this)));
        LinearLayout kiri = new LinearLayout(this);
        kiri.setOrientation(LinearLayout.VERTICAL);
        kiri.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView jl = new TextView(this);
        jl.setText("Profit Bersih Seller");
        jl.setTextSize(14);
        jl.setTextColor(Color.parseColor(INK));
        jl.setTypeface(jl.getTypeface(), Typeface.BOLD);
        kiri.addView(jl);
        kiri.addView(catatan(this, "per pcs terjual"));
        bawah.addView(kiri);

        LinearLayout kanan = new LinearLayout(this);
        kanan.setOrientation(LinearLayout.VERTICAL);
        kanan.setGravity(Gravity.END);
        tLaba = new TextView(this);
        tLaba.setTextSize(19);
        tLaba.setTextColor(Color.parseColor(INK));
        kanan.addView(tLaba);
        tMargin = new TextView(this);
        tMargin.setTextSize(12);
        kanan.addView(tMargin);
        bawah.addView(kanan);
        root.addView(bawah);

        tRugi = catatan(this, "");
        tRugi.setTextColor(Color.parseColor("#B3261E"));
        root.addView(tRugi);

        TextWatcher w = new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c2) {}
            public void onTextChanged(CharSequence s, int a, int b, int c2) {}
            public void afterTextChanged(Editable s) { hitungUlang(); }
        };
        eHargaPublish.addTextChangedListener(w);
        for (EditText e : eTarif) e.addTextChangedListener(w);
        eIklanTetap.addTextChangedListener(w);
        eTarget.addTextChangedListener(w);
        hitungUlang();
    }

    private HargaJual.Tarif tarifDariLayar() {
        HargaJual.Tarif t = new HargaJual.Tarif();
        t.marketplace = angka(eTarif[0]) / 100;
        t.event = angka(eTarif[1]) / 100;
        t.affiliator = angka(eTarif[2]) / 100;
        t.iklan = angka(eTarif[3]) / 100;
        t.sedekah = angka(eTarif[4]) / 100;
        t.reseller = angka(eTarif[5]) / 100;
        t.iklanTetapSen = HargaJual.senDariRupiah(angka(eIklanTetap));
        return t;
    }

    private long hppSen() {
        JSONObject hpp = detail.optJSONObject("hpp");
        return HargaJual.senDariRupiah(hpp == null ? 0 : num(hpp, "total"));
    }

    private Long hitungSaranSen() {
        return HargaJual.hargaPublishDiperlukanSen(
                hppSen(), tarifDariLayar(), angka(eTarget) / 100);
    }

    /** Dihitung ulang tiap ketukan; tidak ada perjalanan ke server di sini. */
    private void hitungUlang() {
        HargaJual.Tarif t = tarifDariLayar();
        long hpp = hppSen();
        long hargaSen = HargaJual.senDariRupiah(angka(eHargaPublish));
        HargaJual.Rincian r = HargaJual.hitung(hargaSen, hpp, t);

        airLabel[1].setText("Biaya Marketplace " + potong(eTarif[0]) + "%");
        airLabel[2].setText("Biaya Event " + potong(eTarif[1]) + "%");
        airLabel[3].setText("Biaya Affiliator " + potong(eTarif[2]) + "%");
        airLabel[5].setText("Sedekah " + potong(eTarif[4]) + "%");
        airLabel[6].setText("Reseller / Sub-seller " + potong(eTarif[5]) + "%");

        airNilai[0].setText(rp(r.hargaPublishSen / 100.0));
        setMinus(airNilai[1], r.biayaMarketplaceSen);
        setMinus(airNilai[2], r.eventSen);
        setMinus(airNilai[3], r.affiliatorSen);
        airNilai[4].setText(rp(r.cairSen / 100.0));
        setMinus(airNilai[5], r.sedekahSen);
        setMinus(airNilai[6], r.resellerSen);
        airNilai[7].setText(rp(r.bagianSellerSen / 100.0));
        setMinus(airNilai[8], r.hppSen);
        setMinus(airNilai[9], r.iklanSen);

        tLaba.setText(rp(r.labaBersihSen / 100.0));
        tLaba.setTextColor(Color.parseColor(r.labaBersihSen < 0 ? "#B3261E" : INK));
        tMargin.setText(String.format(Locale.US, "margin %.1f%%", r.marginBersih * 100));
        tMargin.setTextColor(Color.parseColor(r.marginBersih < 0
                ? "#B3261E" : (r.marginBersih < 0.10 ? PERHATIAN : OK)));

        if (r.labaBersihSen < 0 && hargaSen > 0) {
            tRugi.setText("Harga publish saat ini membuat seller rugi per pcs. "
                    + "Naikkan harga, tekan biaya, atau turunkan HPP.");
            tRugi.setVisibility(View.VISIBLE);
        } else {
            tRugi.setVisibility(View.GONE);
        }

        // Saran harga: sebelum ada harga sama sekali, air terjunnya tidak
        // punya apa pun untuk digambar, jadi yang ditawarkan titik awal.
        Long saran = hitungSaranSen();
        String target = potong(eTarget);
        if (saran == null) {
            tSaranHarga.setText("Target " + target + "% tidak tercapai dengan komposisi "
                    + "biaya saat ini — total potongan sudah menghabiskan harga jual. "
                    + "Turunkan target atau kurangi persentase biaya.");
            tSaranHarga.setTextColor(Color.parseColor(PERHATIAN));
            bPakaiSaran.setVisibility(View.GONE);
        } else {
            long rupiah = HargaJual.rupiahDariSen(saran);
            tSaranHarga.setText("Saran harga publish: " + rp(rupiah)
                    + " — dari HPP " + rp(hpp / 100.0) + " agar profit bersih ≈ "
                    + target + "%.");
            tSaranHarga.setTextColor(Color.parseColor(INK));
            bPakaiSaran.setText("Pakai harga " + rp(rupiah));
            bPakaiSaran.setVisibility(
                    HargaJual.senDariRupiah(rupiah) == hargaSen ? View.GONE : View.VISIBLE);
        }

        tBelumDisimpan.setText(adaPerubahan()
                ? "Angka di atas dihitung dari isian terbaru — tekan Simpan agar tersimpan."
                : "");
    }

    private void setMinus(TextView v, long sen) {
        if (sen == 0) {
            v.setText(rp(0));
            v.setTextColor(Color.parseColor(INK));
            return;
        }
        v.setText("− " + rp(sen / 100.0));
        v.setTextColor(Color.parseColor("#B3261E"));
    }

    /** Isi kotak persen apa adanya, untuk ditulis di label air terjun. */
    private static String potong(EditText e) {
        String s = e.getText().toString().trim();
        return s.isEmpty() ? "0" : s;
    }

    private boolean adaPerubahan() {
        JSONObject c = detail.optJSONObject("costing");
        if (c == null) return false;
        boolean adaHarga = c.has("publishPrice") && !c.isNull("publishPrice");
        double hargaAsli = adaHarga ? num(c, "publishPrice") : 0;
        if (Math.abs(angka(eHargaPublish) - hargaAsli) > 0.0001) return true;
        if (Math.abs(angka(eIklanTetap) - num(c, "adsFixedPerPcs")) > 0.0001) return true;
        if (Math.abs(angka(eTarget) / 100 - num(c, "targetProfitRate")) > 0.000001) return true;
        for (int i = 0; i < TARIF.length; i++) {
            if (Math.abs(angka(eTarif[i]) / 100 - num(c, TARIF[i][0])) > 0.000001) return true;
        }
        return false;
    }

    private void simpanKomposisi() {
        JSONObject body = new JSONObject();
        try {
            String h = eHargaPublish.getText().toString().trim();
            // Kosong berarti "belum ada harga", bukan "harganya nol". Nol
            // adalah harga; kosong adalah keadaan yang berbeda, dan daftar
            // produk menampilkannya sebagai "—".
            if (h.isEmpty()) body.put("publishPrice", JSONObject.NULL);
            else body.put("publishPrice", angka(eHargaPublish));
            body.put("adsFixedPerPcs", angka(eIklanTetap));
            body.put("targetProfitRate", angka(eTarget) / 100);
            for (int i = 0; i < TARIF.length; i++) {
                body.put(TARIF[i][0], angka(eTarif[i]) / 100);
            }
        } catch (Exception ignored) {}
        api.costingUpdate(productId, body, r -> {
            if (r.ok()) {
                Toast.makeText(this, "Komposisi harga disimpan", Toast.LENGTH_SHORT).show();
                muat();
            } else {
                Toast.makeText(this, r.message("Gagal menyimpan"), Toast.LENGTH_LONG).show();
            }
        });
    }

    /* ------------------------------ saran biaya marketplace yang sebenarnya */

    /**
     * Berapa persen yang SEBENARNYA dipotong marketplace.
     *
     * Kolom di atas berisi angka yang diketik sendiri, dan bawaannya 15%.
     * Diukur pada laporan penyelesaian sungguhan, yang benar-benar dipotong
     * 42% untuk pesanan TikTok Shop dan 36% untuk Tokopedia. Selisih sebesar
     * itu masuk seluruhnya ke perhitungan margin.
     *
     * Yang disarankan MEDIAN per pesanan, bukan rata-rata tertimbang: satu
     * pesanan besar dengan biaya tak lazim menggeser yang tertimbang, tidak
     * yang median. Keduanya tetap ditampilkan -- menyembunyikan salah satunya
     * berarti memilihkan kesimpulan tanpa memperlihatkan dasarnya.
     */
    private void saranBiayaMarketplace() {
        if (saranBiaya == null) return;
        JSONArray cukup = saranBiaya.optJSONArray("cukup");
        JSONArray belum = saranBiaya.optJSONArray("belumCukup");
        int n = (cukup == null ? 0 : cukup.length()) + (belum == null ? 0 : belum.length());
        if (n == 0) return;

        root.addView(catatan(this,
                "Biaya marketplace yang sebenarnya, dari laporan pencairan:"));

        for (int bagian = 0; bagian < 2; bagian++) {
            JSONArray a = bagian == 0 ? cukup : belum;
            final boolean layak = bagian == 0;
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                final double median = num(o, "persenMedian");

                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setPadding(0, (int) (6 * d(this)), 0, (int) (6 * d(this)));

                LinearLayout kiri = new LinearLayout(this);
                kiri.setOrientation(LinearLayout.VERTICAL);
                kiri.setLayoutParams(new LinearLayout.LayoutParams(
                        0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                TextView t1 = new TextView(this);
                t1.setText(str(o, "toko", "(tanpa toko)") + " · " + str(o, "sumber", "-")
                        + "   " + String.format(Locale.US, "%.1f%%", median * 100));
                t1.setTextSize(13);
                t1.setTextColor(Color.parseColor(INK));
                kiri.addView(t1);
                TextView t2 = new TextView(this);
                t2.setText(String.format(Locale.US,
                        "tertimbang %.1f%%, rentang %.1f%%–%.1f%%, %d pesanan %s–%s",
                        num(o, "persenTertimbang") * 100,
                        num(o, "persenTerendah") * 100,
                        num(o, "persenTertinggi") * 100,
                        (int) num(o, "pesanan"),
                        str(o, "dari", "?"), str(o, "sampai", "?")));
                t2.setTextSize(11);
                t2.setTextColor(Color.parseColor(INK3));
                kiri.addView(t2);
                row.addView(kiri);

                if (layak) {
                    row.addView(tombol(this, "Pakai", v -> {
                        eTarif[0].setText(String.format(Locale.US, "%.1f", median * 100));
                        hitungUlang();
                    }));
                } else {
                    // Angkanya tetap ditampilkan -- menyembunyikan data yang
                    // ada membuat orang mengira fiturnya rusak -- tapi tidak
                    // ditawarkan, karena satu-dua pesanan dengan ongkir tak
                    // lazim menggeser persentasenya belasan angka.
                    TextView bl = new TextView(this);
                    bl.setText("datanya belum cukup");
                    bl.setTextSize(11);
                    bl.setTextColor(Color.parseColor(INK3));
                    row.addView(bl);
                }
                root.addView(row);
            }
        }
        root.addView(catatan(this,
                "Angka utama adalah median tiap pesanan. Impor laporan lain di menu "
                        + "Rekonsiliasi untuk memperkuat dasarnya."));
    }

    /* ------------------------------------------------------------ pembantu */

    private View rincian(String kiri, String kanan, boolean tebal) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, (int) (6 * d(this)), 0, (int) (6 * d(this)));
        TextView a = new TextView(this);
        a.setText(kiri);
        a.setTextSize(tebal ? 14 : 13);
        a.setTextColor(Color.parseColor(tebal ? INK : INK2));
        if (tebal) a.setTypeface(a.getTypeface(), Typeface.BOLD);
        a.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(a);
        TextView b = new TextView(this);
        b.setText(kanan);
        b.setTextSize(tebal ? 16 : 13);
        b.setTextColor(Color.parseColor(INK));
        if (tebal) b.setTypeface(b.getTypeface(), Typeface.BOLD);
        row.addView(b);
        return row;
    }

    /**
     * Pecahan 0,025 jadi "2.5"; 0,42 jadi "42".
     *
     * Tanpa desimal bila memang bulat: kolom bertuliskan "42.0" mengundang
     * orang mengetik ulang, dan setiap pengetikan ulang adalah kesempatan
     * salah ketik.
     */
    private static String pctTeks(double pecahan) {
        double p = pecahan * 100;
        if (Math.abs(p - Math.round(p)) < 0.0005) return String.valueOf(Math.round(p));
        return String.format(Locale.US, "%.1f", p);
    }
}
