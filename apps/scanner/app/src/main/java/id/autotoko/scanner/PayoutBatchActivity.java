package id.autotoko.scanner;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Satu batch pencairan, dengan tiga tahap yang sama seperti di web.
 *
 * Tahap 1 merekam pencairan tiap toko; tahap 2 mengunggah bukti transfer ke
 * tiap penerima; tahap 3 batch ditutup. Urutannya dijaga server, bukan di
 * sini: tombol yang tidak berlaku memang tidak ditampilkan, tapi kalaupun
 * ditekan, servernya yang menolak. Layar ini tidak memutuskan apapun sendiri.
 */
public class PayoutBatchActivity extends AppCompatActivity {

    private static final int REQ_BUKTI_CAIR = 8101;
    private static final int REQ_BUKTI_TRANSFER = 8102;
    private static final int REQ_BUKTI_FEE = 8103;
    private static final int FOTO_MAX_EDGE = 1600;
    private static final int FOTO_QUALITY = 82;

    private Api api;
    private String batchId, batchCode;
    private JSONObject batch;
    private JSONArray shops;

    private LinearLayout root;
    private TextView status;

    /** Baris yang sedang menunggu gambar dari pemilih berkas. */
    private String disbursementMenunggu = null;
    private EditText nominalMenunggu = null;
    private MaterialButton tombolMenunggu = null;
    private String urlBuktiCair = null;    /** Usulan OCR untuk pencairan yang sedang direkam; -1 berarti tidak terbaca. */
    private double ocrNominal = -1;
    private String ocrRekening = null;


    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        batchId = getIntent().getStringExtra("batchId");
        batchCode = getIntent().getStringExtra("batchCode");
        setTitle("Batch" + (batchCode == null || batchCode.isEmpty() ? "" : " #" + batchCode));
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(Color.parseColor("#6B7178"));
        root.addView(status);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);
    }

    @Override
    protected void onResume() {
        super.onResume();
        muat();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private void muat() {
        status.setText("Memuat…");
        api.payoutBatch(batchId, r -> {
            if (!r.ok() || r.data() == null) {
                status.setText(r.message("Gagal memuat batch."));
                return;
            }
            batch = r.data();
            // Diambil sekali, apa pun status batchnya: namanya bukan cuma
            // untuk merekam, tapi juga untuk pesan "Bagikan WA ke Seller"
            // yang tetap tersedia sampai batch selesai.
            if (shops == null) {
                api.payoutShops(rr -> {
                    shops = rr.dataArray();
                    gambar();
                });
            } else {
                gambar();
            }
        });
    }

    private void gambar() {
        float d = getResources().getDisplayMetrics().density;
        root.removeAllViews();
        root.addView(status);

        String st = batch.optString("status", "");
        status.setText(PayoutActivity.labelStatus(st));
        root.addView(penunjukLangkah(st));

        JSONArray mutations = batch.optJSONArray("mutations");
        JSONArray disbursements = batch.optJSONArray("disbursements");

        // ---- ringkasan, sama isinya dengan kepala halaman web ----
        double credit = 0, sedekah = 0, seller = 0, sub = 0;
        for (int i = 0; mutations != null && i < mutations.length(); i++) {
            JSONObject m = mutations.optJSONObject(i);
            if (m == null) continue;
            credit += m.optDouble("creditAmount", 0);
            sedekah += m.optDouble("sedekahAmount", 0);
            seller += m.optDouble("sellerAmount", 0);
            sub += m.optDouble("subSellerAmount", 0) + m.optDouble("subSubSellerAmount", 0);
        }
        root.addView(tombolBagikan());
        root.addView(tombolEkspor());

        root.addView(kotak("Ringkasan",
                "Total kredit " + rp(credit)
                        + "\nSedekah " + rp(sedekah)
                        + "\nSub-seller " + rp(sub)
                        + "\nSeller " + rp(seller)));

        kartuFee();        kartuBawaan();


        if ("berjalan".equals(st)) {
            gambarTahap1(mutations, d);
        } else {
            gambarTahap2(disbursements, st, d);
        }
    }

    /**
     * Tiga langkah, dengan yang sedang berjalan ditandai.
     *
     * Nama keadaan di basis data ("siap_distribusi") bukan penjelasan bagi
     * yang memakainya; yang perlu diketahui adalah sedang di mana, apa
     * berikutnya, dan bisakah mundur.
     */
    private View penunjukLangkah(String st) {
        int langkah = PayoutActivity.stepIndex(st);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (12 * getResources().getDisplayMetrics().density);
        box.setPadding(p, p, p, p);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (8 * getResources().getDisplayMetrics().density);
        box.setLayoutParams(lp);
        box.setBackgroundColor(Color.parseColor("#F6F7F8"));

        String[] nama = {"1. Rekam pencairan", "2. Transfer & bukti", "3. Selesai"};
        for (int i = 0; i < nama.length; i++) {
            TextView t = new TextView(this);
            t.setTextSize(13);
            boolean ini = (i + 1) == langkah;
            boolean lewat = (i + 1) < langkah;
            t.setTextColor(Color.parseColor(ini ? "#20242B" : "#6B7178"));
            t.setText((lewat ? "✓ " : ini ? "▶ " : "   ") + nama[i]);
            box.addView(t);
        }

        // Mundur satu langkah, hanya dari tahap transfer. Dari "selesai" tidak
        // ditawarkan karena servernya memang menolak, dan tombol yang pasti
        // ditolak lebih buruk daripada tombol yang tidak ada.
        if ("siap_distribusi".equals(st)) {
            MaterialButton mundur = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            mundur.setText("Kembali ke Langkah 1");
            mundur.setAllCaps(false);
            mundur.setOnClickListener(v -> mundurLangkah(false));
            box.addView(mundur, lebar());
        }
        return box;
    }

    /**
     * Kembali ke tahap rekam.
     *
     * Dicoba tanpa paksa dulu. Server menolak dengan 409 ketika sudah ada
     * bukti yang akan hilang, dan penolakannya menyebut berapa banyak --
     * kalimat itu yang ditanyakan ke pemakainya, bukan peringatan karangan
     * yang bisa meleset dari kenyataannya.
     */
    private void mundurLangkah(boolean paksa) {
        api.payoutReopenInput(batchId, paksa, r -> {
            if (r.ok()) {
                Toast.makeText(this, "Kembali ke langkah 1", Toast.LENGTH_LONG).show();
                muat();
                return;
            }
            if (r.code == 409 && !paksa) {
                new MaterialAlertDialogBuilder(this)
                        .setTitle("Bukti akan terhapus")
                        .setMessage(r.message("Sudah ada bukti transfer di batch ini.")
                                + "\n\nLanjutkan tetap kembali ke langkah 1?")
                        .setNegativeButton("Batal", null)
                        .setPositiveButton("Ya, hapus buktinya", (dd, w) -> mundurLangkah(true))
                        .show();
                return;
            }
            Toast.makeText(this, r.message("Gagal kembali ke langkah 1."),
                    Toast.LENGTH_LONG).show();
        });
    }

    /**
     * Fee admin batch ini, berdiri sendiri di luar pembagian pencairan.
     *
     * Sedekah dan sub-seller dipotong DARI kredit yang cair; fee ini ongkos
     * yang dibayar terpisah, satu kali per batch. Karena itu ia tidak ikut
     * ke rincian transfer maupun ke penjumlahan manapun.
     */
    private void kartuFee() {
        if (batch.isNull("adminFeeAmount")) return;
        boolean sudah = !batch.isNull("adminFeePaidAt");

        LinearLayout box = kotak("Fee admin batch ini",
                rp(batch.optDouble("adminFeeAmount", 0))
                        + "\n" + (sudah ? "Sudah ditransfer" : "BELUM ditransfer")
                        + "\nDi luar pembagian pencairan — dibayar sekali untuk batch ini.");

        MaterialButton unggah = new MaterialButton(this, null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle);
        unggah.setText(sudah ? "Ganti bukti fee" : "Unggah bukti transfer fee");
        unggah.setAllCaps(false);
        unggah.setOnClickListener(v -> {
            tombolMenunggu = unggah;
            pilihGambar(REQ_BUKTI_FEE);
        });
        box.addView(unggah, lebar());

        if (sudah) {
            MaterialButton lepas = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            lepas.setText("Lepas bukti fee");
            lepas.setAllCaps(false);
            lepas.setOnClickListener(v -> api.payoutClearFeeProof(batchId, r -> {
                Toast.makeText(this, r.ok() ? "Bukti dilepas"
                        : r.message("Gagal melepas bukti."), Toast.LENGTH_LONG).show();
                muat();
            }));
            box.addView(lepas, lebar());
        }
        root.addView(box);
    }

    /* ------------------------------------------------ tahap 1: rekam */

    private void gambarTahap1(JSONArray mutations, float d) {
        TextView h = judul("Rekam Pencairan Tiap Toko");
        root.addView(h);

        MaterialButton tambah = new MaterialButton(this);
        tambah.setText("+ Rekam Pencairan Toko");
        tambah.setAllCaps(false);
        tambah.setOnClickListener(v -> formRekam());
        root.addView(tambah, lebar());

        if (mutations != null && mutations.length() > 0) {
            for (int i = 0; i < mutations.length(); i++) {
                JSONObject m = mutations.optJSONObject(i);
                if (m == null) continue;
                final String id = m.optString("id", "");
                LinearLayout row = kotak(namaToko(m.optString("shopId", "")),
                        rp(m.optDouble("creditAmount", 0))
                                + " · " + m.optString("payoutDate", "")
                                + (m.optString("marketplaceProofUrl", "").isEmpty()
                                        ? "\n(bukti belum ada)" : ""));
                row.setOnLongClickListener(v -> {
                    new MaterialAlertDialogBuilder(this)
                            .setTitle("Hapus pencairan ini?")
                            .setNegativeButton("Batal", null)
                            .setPositiveButton("Hapus", (dd, w) ->
                                    api.payoutDeleteMutation(id, rr -> {
                                        Toast.makeText(this, rr.ok() ? "Dihapus"
                                                : rr.message("Gagal menghapus."),
                                                Toast.LENGTH_LONG).show();
                                        muat();
                                    }))
                            .show();
                    return true;
                });
                root.addView(row);
            }

            // Dipakai setelah tarif diubah di pengaturan: tanpa ini, mutasi
            // yang sudah direkam tetap memakai tarif lama dan bedanya baru
            // ketahuan di tahap transfer.
            MaterialButton hitung = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            hitung.setText("Hitung Ulang dengan Tarif Terbaru");
            hitung.setAllCaps(false);
            hitung.setOnClickListener(v -> api.payoutRecalculate(batchId, rr -> {
                Toast.makeText(this, rr.ok() ? "Dihitung ulang"
                        : rr.message("Gagal menghitung ulang."), Toast.LENGTH_LONG).show();
                muat();
            }));
            root.addView(hitung, lebar());

            MaterialButton tutup = new MaterialButton(this);
            tutup.setText("Selesai Pencairan Semua Toko");
            tutup.setAllCaps(false);
            tutup.setOnClickListener(v -> new MaterialAlertDialogBuilder(this)
                    .setTitle("Tutup input?")
                    .setMessage("Setelah ini rincian transfer dibuat dan pencairan tidak bisa "
                            + "ditambah lagi di batch ini.")
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Lanjut", (dd, w) -> api.payoutCloseInput(batchId, rr -> {
                        Toast.makeText(this, rr.ok() ? "Input ditutup"
                                : rr.message("Gagal menutup input."), Toast.LENGTH_LONG).show();
                        muat();
                    }))
                    .show());
            root.addView(tutup, lebar());
        } else {
            root.addView(catatan("Belum ada pencairan direkam di batch ini."));
        }
    }

    private void formRekam() {
        if (shops == null || shops.length() == 0) {
            Toast.makeText(this, "Daftar toko belum termuat.", Toast.LENGTH_LONG).show();
            return;
        }
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, pad);

        final List<String> ids = new ArrayList<>();
        final List<String> nama = new ArrayList<>();
        for (int i = 0; i < shops.length(); i++) {
            JSONObject s = shops.optJSONObject(i);
            if (s == null) continue;
            ids.add(s.optString("id", ""));
            String n = s.optString("displayName", "");
            if (n.isEmpty() || "null".equals(n)) n = s.optString("shopName", "(tanpa nama)");
            nama.add(n + " (" + s.optString("marketplace", "-") + ")");
        }

        // Picker yang sama dengan layar lain: daftarnya bisa dicari, karena
        // toko bisa banyak dan menggulung daftar panjang di ponsel lambat.
        final Picker pilihToko = Picker.create(this, nama, "Pilih toko", "Pilih toko");
        box.addView(pilihToko.view());

        final EditText tgl = new EditText(this);
        tgl.setHint("Tanggal cair (YYYY-MM-DD)");
        tgl.setText(new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()));
        box.addView(tgl);

        final EditText nominal = new EditText(this);
        nominal.setInputType(InputType.TYPE_CLASS_NUMBER);
        nominal.setHint("Nominal pencairan (Rp)");
        box.addView(nominal);

        final MaterialButton bukti = new MaterialButton(this, null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle);
        bukti.setText("Lampirkan bukti pencairan");
        bukti.setAllCaps(false);
        urlBuktiCair = null;
        ocrNominal = -1;
        ocrRekening = null;
        bukti.setOnClickListener(v -> {
            nominalMenunggu = nominal;
            tombolMenunggu = bukti;
            disbursementMenunggu = null;
            pilihGambar(REQ_BUKTI_CAIR);
        });
        box.addView(bukti, lebar());

        androidx.appcompat.app.AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle("Rekam Pencairan")
                .setView(box)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Simpan", null)
                .create();

        // Tombolnya dipasang setelah dialog tampil supaya kegagalan tidak
        // menutup dialog dan menghapus apa yang sudah diketik.
        dialog.setOnShowListener(dd -> dialog.getButton(
                android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(bv -> {
            int idx = pilihToko.selectedIndex();
            if (idx < 0) {
                Toast.makeText(this, "Pilih tokonya dulu.", Toast.LENGTH_LONG).show();
                return;
            }
            double amount;
            try {
                amount = Double.parseDouble(nominal.getText().toString().trim());
            } catch (Exception e) {
                Toast.makeText(this, "Nominal belum diisi.", Toast.LENGTH_LONG).show();
                return;
            }
            api.payoutRecordFull(batchId, ids.get(idx), tgl.getText().toString().trim(),
                    amount, urlBuktiCair, ocrNominal, ocrRekening, r -> {
                        if (!r.ok()) {
                            // Pesan servernya ditampilkan apa adanya: di situlah
                            // penjagaan pencairan ganda dan bukti berulang
                            // menerangkan dirinya.
                            new MaterialAlertDialogBuilder(this)
                                    .setTitle("Tidak bisa disimpan")
                                    .setMessage(r.message("Gagal menyimpan pencairan."))
                                    .setPositiveButton("Mengerti", null)
                                    .show();
                            return;
                        }
                        dialog.dismiss();
                        urlBuktiCair = null;
                        muat();
                    });
        }));
        dialog.show();
    }

    /* --------------------------------------- tahap 2 & 3: transfer */

    private void gambarTahap2(JSONArray disbursements, String st, float d) {
        root.addView(judul("Transfer & Bukti"));

        if (disbursements == null || disbursements.length() == 0) {
            root.addView(catatan("Belum ada rincian transfer."));
            return;
        }

        int selesai = 0;
        for (int i = 0; i < disbursements.length(); i++) {
            JSONObject x = disbursements.optJSONObject(i);
            if (x == null) continue;
            String v = x.optString("validationStatus", "");
            if ("cocok_otomatis".equals(v) || "override_manual".equals(v)) selesai++;
            root.addView(barisTransfer(x, st));
        }

        int pct = disbursements.length() == 0
                ? 0 : Math.round(selesai * 100f / disbursements.length());
        root.addView(catatan(selesai + " dari " + disbursements.length()
                + " transfer sudah tervalidasi (" + pct + "%)."
                + (selesai < disbursements.length()
                        ? " Batch baru bisa ditutup setelah semuanya tervalidasi atau di-override."
                        : "")));

        if ("siap_distribusi".equals(st)) {
            MaterialButton tutup = new MaterialButton(this);
            tutup.setText("Tutup Batch");
            tutup.setAllCaps(false);
            tutup.setOnClickListener(v -> api.payoutClose(batchId, rr -> {
                if (!rr.ok()) {
                    new MaterialAlertDialogBuilder(this)
                            .setTitle("Belum bisa ditutup")
                            .setMessage(rr.message("Gagal menutup batch."))
                            .setPositiveButton("Mengerti", null)
                            .show();
                    return;
                }
                Toast.makeText(this, "Batch ditutup", Toast.LENGTH_LONG).show();
                muat();
            }));
            root.addView(tutup, lebar());
        }
    }

    private View barisTransfer(JSONObject x, String st) {
        float d = getResources().getDisplayMetrics().density;
        final String id = x.optString("id", "");
        String v = x.optString("validationStatus", "");
        boolean beres = "cocok_otomatis".equals(v) || "override_manual".equals(v);

        StringBuilder isi = new StringBuilder();
        isi.append(rp(x.optDouble("expectedAmount", 0)));
        String rek = x.optString("recordedAccount", "");
        if (!rek.isEmpty() && !"null".equals(rek)) isi.append("\nke ").append(rek);
        isi.append("\n").append(labelValidasi(v));
        if ("tidak_cocok".equals(v)) {
            double ocr = x.optDouble("ocrAmount", -1);
            isi.append("\nStruk terbaca ").append(ocr < 0 ? "(tidak terbaca)" : rp(ocr));
        }

        LinearLayout row = kotak(x.optString("recipientName", "-")
                + " (" + jenis(x.optString("recipientType", "")) + ")", isi.toString());

        if (!beres && "siap_distribusi".equals(st)) {
            MaterialButton unggah = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            unggah.setText("Unggah bukti transfer");
            unggah.setAllCaps(false);
            unggah.setOnClickListener(vv -> {
                disbursementMenunggu = id;
                tombolMenunggu = unggah;
                pilihGambar(REQ_BUKTI_TRANSFER);
            });
            row.addView(unggah, lebar());

            if ("tidak_cocok".equals(v)) {
                MaterialButton override = new MaterialButton(this, null,
                        com.google.android.material.R.attr.materialButtonOutlinedStyle);
                override.setText("Override dengan alasan");
                override.setAllCaps(false);
                override.setOnClickListener(vv -> formOverride(id));
                row.addView(override, lebar());
            }
        }
        return row;
    }

    private void formOverride(String id) {
        final EditText alasan = new EditText(this);
        alasan.setHint("Alasan (wajib)");
        new MaterialAlertDialogBuilder(this)
                .setTitle("Override validasi")
                .setMessage("Dipakai kalau transfernya memang benar tapi struknya tidak terbaca. "
                        + "Alasannya tersimpan bersama batch.")
                .setView(alasan)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Simpan", (dd, w) -> {
                    String t = alasan.getText().toString().trim();
                    if (t.isEmpty()) {
                        Toast.makeText(this, "Alasan wajib diisi.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    api.payoutOverride(id, t, rr -> {
                        Toast.makeText(this, rr.ok() ? "Tersimpan"
                                : rr.message("Gagal override."), Toast.LENGTH_LONG).show();
                        muat();
                    });
                })
                .show();
    }

    /* ------------------------------------------------------ gambar */

    private void pilihGambar(int req) {
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.setType("image/*");
        try {
            startActivityForResult(Intent.createChooser(pick, "Pilih bukti"), req);
        } catch (Exception e) {
            Toast.makeText(this, "Tidak ada aplikasi galeri.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_BUKTI_CAIR && req != REQ_BUKTI_TRANSFER && req != REQ_BUKTI_FEE) return;
        if (result != RESULT_OK || data == null || data.getData() == null) return;

        final String base64;
        try {
            java.io.InputStream in = getContentResolver().openInputStream(data.getData());
            Bitmap bmp = BitmapFactory.decodeStream(in);
            if (in != null) in.close();
            if (bmp == null) throw new Exception("bukan gambar");
            base64 = keBase64(bmp);
        } catch (Exception e) {
            Toast.makeText(this, "Gambar tidak bisa dibaca.", Toast.LENGTH_LONG).show();
            return;
        }
        if (tombolMenunggu != null) tombolMenunggu.setText("Mengunggah…");

        final int reqFinal = req;
        api.uploadImage(base64, "jpg", r -> {
            if (!r.ok() || r.data() == null) {
                Toast.makeText(this, r.message("Gagal mengunggah."), Toast.LENGTH_LONG).show();
                if (tombolMenunggu != null) tombolMenunggu.setText("Coba unggah lagi");
                return;
            }
            String url = r.data().optString("url", "");
            if (reqFinal == REQ_BUKTI_FEE) {
                api.payoutFeeProof(batchId, url, rr -> {
                    if (!rr.ok()) {
                        // Pesan servernya apa adanya: di situlah penolakan
                        // bukti yang sudah dipakai batch lain menerangkan diri.
                        new MaterialAlertDialogBuilder(this)
                                .setTitle("Bukti fee ditolak")
                                .setMessage(rr.message("Gagal menyimpan bukti fee."))
                                .setPositiveButton("Mengerti", null)
                                .show();
                        muat();
                        return;
                    }
                    Toast.makeText(this, "Bukti fee tersimpan", Toast.LENGTH_LONG).show();
                    muat();
                });
                return;
            }
            if (reqFinal == REQ_BUKTI_CAIR) {
                urlBuktiCair = url;
                if (tombolMenunggu != null) tombolMenunggu.setText("Membaca struk…");
                // Titik OCR pertama, sama seperti di web: hasilnya mengisi kotak
                // nominal sebagai usulan, dan tetap bisa dikoreksi. Gagal membaca
                // bukan kegagalan mengunggah -- buktinya sudah tersimpan.
                api.payoutOcrPencairan(url, ro -> {
                    if (tombolMenunggu != null) tombolMenunggu.setText("Bukti terlampir");
                    if (!ro.ok() || ro.data() == null) {
                        Toast.makeText(this, "OCR tidak terbaca — isi nominal manual.",
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    JSONObject o = ro.data();
                    if (!o.isNull("amount")) {
                        ocrNominal = o.optDouble("amount", -1);
                        if (ocrNominal >= 0 && nominalMenunggu != null) {
                            nominalMenunggu.setText(String.valueOf((long) ocrNominal));
                        }
                    }
                    if (!o.isNull("account")) ocrRekening = o.optString("account", null);
                    Toast.makeText(this,
                            ocrNominal >= 0 || ocrRekening != null
                                    ? "Terisi dari OCR — periksa dan koreksi kalau perlu."
                                    : "OCR tidak berhasil membaca — isi manual.",
                            Toast.LENGTH_LONG).show();
                });
                return;
            }
            // Bukti transfer: langsung dikirim untuk divalidasi server, sama
            // seperti di web. Hasil cocok/tidaknya datang dari sana.
            api.payoutUploadProof(disbursementMenunggu, url, rr -> {
                if (!rr.ok()) {
                    Toast.makeText(this, rr.message("Gagal menyimpan bukti."),
                            Toast.LENGTH_LONG).show();
                    muat();
                    return;
                }
                String v = rr.data() == null ? "" : rr.data().optString("validationStatus", "");
                Toast.makeText(this, "cocok_otomatis".equals(v)
                        ? "Bukti cocok" : "Bukti tersimpan, tapi belum cocok — periksa lagi",
                        Toast.LENGTH_LONG).show();
                muat();
            });
        });
    }

    private String keBase64(Bitmap bmp) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        float scale = FOTO_MAX_EDGE / (float) Math.max(w, h);
        if (scale < 1f) {
            Bitmap kecil = Bitmap.createScaledBitmap(
                    bmp, Math.round(w * scale), Math.round(h * scale), true);
            if (kecil != bmp) bmp.recycle();
            bmp = kecil;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, FOTO_QUALITY, out);
        bmp.recycle();
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /* ------------------------------------------------------ bantu */

    /**
     * Dua tombol bagikan, syaratnya sama persis dengan web.
     *
     * Ditaruh di kartu kepala, bukan di dalam salah satu langkah. Kalau
     * ditempel per langkah, pada batch yang sedang ditransfer tidak satu pun
     * bisa dijangkau -- persis keluhan yang dulu muncul di web.
     */
    private View tombolBagikan() {
        float d = getResources().getDisplayMetrics().density;
        LinearLayout baris = new LinearLayout(this);
        baris.setOrientation(LinearLayout.HORIZONTAL);
        baris.setPadding(0, (int) (8 * d), 0, 0);

        if (PayoutShare.bisaBagikanSeller(batch)) {
            baris.addView(tombolBagi("Bagikan WA ke Seller",
                    v -> bagikanDariServer("seller")));
        }
        if (PayoutShare.bisaBagikanSubSeller(batch)) {
            baris.addView(tombolBagi("Bagikan WA ke Sub-seller",
                    v -> bagikanDariServer("sub_seller")));
        }
        return baris;
    }

    private MaterialButton tombolBagi(String teks, View.OnClickListener aksi) {
        float d = getResources().getDisplayMetrics().density;
        MaterialButton b = new MaterialButton(this);
        b.setText(teks);
        b.setAllCaps(false);
        b.setTextSize(12);
        b.setOnClickListener(aksi);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.rightMargin = (int) (4 * d);
        b.setLayoutParams(lp);
        return b;
    }

    /** Langsung ke WhatsApp kalau terpasang; pemilih aplikasi cadangannya. */
    /**
     * Meminta teks pesan ke server, lalu membagikannya.
     *
     * Kalau permintaannya gagal -- sinyal hilang di gudang adalah keadaan
     * biasa -- pesannya disusun di sini memakai susunan BAWAAN, dan orangnya
     * DIBERI TAHU bahwa template yang disetel tidak terpakai. Diam-diam
     * mengirim format lain adalah cara membuat orang mengira templatenya tidak
     * pernah bekerja.
     */
    private void bagikanDariServer(final String jenis) {
        final String id = PayoutUi.str(batch, "id", null);
        if (id == null) {
            bagikanBawaan(jenis, "Batch ini belum punya id.");
            return;
        }
        api.payoutWaText(id, jenis, r -> runOnUiThread(() -> {
            String teks = null;
            if (r.ok()) {
                org.json.JSONObject d = r.data();
                if (d != null) {
                    String t = d.optString("teks", "");
                    if (!t.isEmpty()) teks = t;
                }
            }
            if (teks != null) bagikanWa(teks);
            else bagikanBawaan(jenis, r.message("tidak bisa menghubungi server"));
        }));
    }

    /** Susunan bawaan, dipakai hanya saat server tidak terjangkau. */
    private void bagikanBawaan(String jenis, String alasan) {
        String base = new Session(this).baseUrl();
        String teks = "seller".equals(jenis)
                ? PayoutShare.pesanSeller(batch, shops, base)
                : PayoutShare.pesanSubSeller(batch, base);
        Toast.makeText(this,
                "Memakai susunan bawaan — template dari pengaturan tidak terbaca ("
                        + alasan + ").",
                Toast.LENGTH_LONG).show();
        bagikanWa(teks);
    }

    private void bagikanWa(String teks) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, teks);
        try {
            send.setPackage("com.whatsapp");
            startActivity(send);
        } catch (Exception e) {
            send.setPackage(null);
            startActivity(Intent.createChooser(send, "Bagikan lewat"));
        }
    }

    /**
     * Uang yang tertahan dan uang yang terbawa.
     *
     * Keduanya ditampilkan karena keduanya menggeser total: yang ditahan
     * membuat langkah 2 lebih kecil dari kepala halaman, yang terbawa dari
     * batch sebelumnya membuatnya lebih besar. Tanpa ini selisihnya terbaca
     * seperti salah hitung.
     */
    private void kartuBawaan() {
        JSONObject c = batch.optJSONObject("carryovers");
        if (c == null) return;
        StringBuilder isi = new StringBuilder();

        JSONArray ditahan = c.optJSONArray("held");
        if (ditahan != null && ditahan.length() > 0) {
            isi.append("Menunggu batch berikutnya:\n");
            for (int i = 0; i < ditahan.length(); i++) {
                JSONObject x = ditahan.optJSONObject(i);
                if (x == null) continue;
                isi.append("• ").append(PayoutUi.str(x, "name", "-")).append(" ")
                   .append(rp(PayoutUi.num(x, "amount"))).append("\n");
            }
            isi.append("Uangnya tidak hilang — ikut ditransfer begitu jumlahnya "
                    + "melewati batas minimum.\n");
        }

        JSONArray terbawa = c.optJSONArray("applied");
        if (terbawa != null && terbawa.length() > 0) {
            if (isi.length() > 0) isi.append("\n");
            isi.append("Dibawa dari batch sebelumnya:\n");
            for (int i = 0; i < terbawa.length(); i++) {
                JSONObject x = terbawa.optJSONObject(i);
                if (x == null) continue;
                isi.append("• ").append(PayoutUi.str(x, "name", "-")).append(" ")
                   .append(rp(PayoutUi.num(x, "amount"))).append("\n");
            }
        }

        if (isi.length() > 0) {
            root.addView(kotak("Bawaan", isi.toString().trim()));
        }

        // Mencairkan sisa yang tertahan hanya masuk akal selagi batch masih
        // menerima input.
        if ("berjalan".equals(batch.optString("status", ""))) tombolLepasBawaan();
    }

    /**
     * Cairkan sisa seseorang sekarang, tak peduli batas minimum.
     *
     * Sengaja per penerima, bukan satu tombol "lepas semua": membayar saldo di
     * bawah batas bank adalah keputusan tentang uang satu orang -- biasanya
     * karena ia berhenti berjualan -- dan tidak boleh kejadian pada tiga orang
     * lain sebagai efek samping.
     */
    private void tombolLepasBawaan() {
        api.payoutCarryovers(r -> {
            JSONArray a = r.dataArray();
            if (a == null || a.length() == 0) return;
            root.addView(judul("Sisa Tertahan dari Batch Lalu"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject c = a.optJSONObject(i);
                if (c == null) continue;
                final JSONObject item = c;
                final String nama = PayoutUi.str(c, "name", "-");
                final double nominal = PayoutUi.num(c, "amount");
                MaterialButton b = new MaterialButton(this);
                b.setText("Cairkan sisa " + nama + " " + rp(nominal));
                b.setAllCaps(false);
                b.setTextSize(12);
                b.setOnClickListener(v -> new MaterialAlertDialogBuilder(this)
                        .setTitle("Cairkan sekarang?")
                        .setMessage("Cairkan sisa " + nama + " sebesar " + rp(nominal)
                                + " sekarang?\n\nNominalnya di bawah minimum transfer, jadi "
                                + "bank mungkin menolak. Pakai ini kalau kamu memang akan "
                                + "mentransfernya dengan cara lain.")
                        .setPositiveButton("Cairkan", (dd, w) -> lepasBawaan(item, nama))
                        .setNegativeButton("Batal", null)
                        .show());
                root.addView(b, lebar());
            }
        });
    }

    private void lepasBawaan(JSONObject c, String nama) {
        JSONArray ids = c.optJSONArray("ids");
        if (ids == null || ids.length() == 0) {
            Toast.makeText(this, "Tidak ada sisa yang bisa dicairkan.", Toast.LENGTH_LONG).show();
            return;
        }
        api.payoutReleaseCarryovers(batchId, ids, r -> {
            if (!r.ok()) {
                Toast.makeText(this, r.message("Gagal mencairkan sisa."),
                        Toast.LENGTH_LONG).show();
                return;
            }
            Toast.makeText(this, "Sisa " + nama + " masuk ke daftar transfer batch ini.",
                    Toast.LENGTH_LONG).show();
            muat();
        });
    }

    /** Rekap batch sebagai berkas, isinya sama dengan tombol Excel/PNG di web. */
    private View tombolEkspor() {
        LinearLayout baris = new LinearLayout(this);
        baris.setOrientation(LinearLayout.HORIZONTAL);
        JSONArray m = batch.optJSONArray("mutations");
        if (m == null || m.length() == 0) return baris;
        baris.addView(tombolBagi("Ekspor CSV", v -> eksporCsv()));
        baris.addView(tombolBagi("Ekspor PNG", v -> eksporPng()));
        return baris;
    }

    private String kodeBatch() {
        String c = batch.optString("code", "");
        if (!c.isEmpty() && !"null".equals(c)) return c;
        String id = batch.optString("id", "batch");
        return id.substring(0, Math.min(8, id.length()));
    }

    private static String csvEscape(String v) {
        if (v == null) return "";
        return (v.contains(",") || v.contains("\"") || v.contains("\n"))
                ? "\"" + v.replace("\"", "\"\"") + "\""
                : v;
    }

    private String subDariToko(String shopId, String kunci) {
        for (int i = 0; shops != null && i < shops.length(); i++) {
            JSONObject s = shops.optJSONObject(i);
            if (s != null && shopId != null && shopId.equals(PayoutUi.str(s, "id", null))) {
                return PayoutUi.str(s, kunci, "");
            }
        }
        return "";
    }

    private void eksporCsv() {
        JSONArray m = batch.optJSONArray("mutations");
        if (m == null || m.length() == 0) return;
        String[] kepala = {"Toko", "Tanggal", "Total Kredit", "Sedekah", "Seller",
                "Sub-seller", "Nama Sub-seller", "Sub-sub-seller", "Nama Sub-sub-seller",
                "Link Bukti"};
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < kepala.length; i++) {
            b.append(i > 0 ? "," : "").append(csvEscape(kepala[i]));
        }
        b.append("\r\n");

        double tk = 0, ts = 0, tse = 0, tsub = 0, tsub2 = 0;
        String base = new Session(this).baseUrl();
        for (int i = 0; i < m.length(); i++) {
            JSONObject x = m.optJSONObject(i);
            if (x == null) continue;
            double kredit = PayoutUi.num(x, "creditAmount");
            double sed = PayoutUi.num(x, "sedekahAmount");
            double sel = PayoutUi.num(x, "sellerAmount");
            double sub = PayoutUi.num(x, "subSellerAmount");
            double sub2 = PayoutUi.num(x, "subSubSellerAmount");
            tk += kredit; ts += sed; tse += sel; tsub += sub; tsub2 += sub2;
            String shopId = PayoutUi.str(x, "shopId", null);
            String bukti = PayoutShare.absolut(PayoutUi.str(x, "marketplaceProofUrl", null), base);
            b.append(csvEscape(namaToko(shopId))).append(",")
             .append(csvEscape(PayoutUi.str(x, "payoutDate", ""))).append(",")
             .append((long) kredit).append(",").append((long) sed).append(",")
             .append((long) sel).append(",").append((long) sub).append(",")
             .append(csvEscape(subDariToko(shopId, "subSellerName"))).append(",")
             .append((long) sub2).append(",")
             .append(csvEscape(subDariToko(shopId, "subSubSellerName"))).append(",")
             .append(csvEscape(bukti == null ? "" : bukti)).append("\r\n");
        }
        b.append("TOTAL,,").append((long) tk).append(",").append((long) ts).append(",")
         .append((long) tse).append(",").append((long) tsub).append(",,")
         .append((long) tsub2).append(",,\r\n");

        try {
            java.io.File f = new java.io.File(getExternalFilesDir(null),
                    "rekap-pencairan-" + kodeBatch() + ".csv");
            java.io.FileOutputStream os = new java.io.FileOutputStream(f);
            // BOM di depan supaya Excel membuka berkas UTF-8 ini dengan benar.
            os.write(0xEF); os.write(0xBB); os.write(0xBF);
            os.write(b.toString().getBytes("UTF-8"));
            os.close();
            bagikanBerkas(f, "text/csv");
        } catch (Exception e) {
            Toast.makeText(this, "Gagal membuat CSV.", Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Gambar seluruh isi layar batch.
     *
     * Digambar dari View-nya sendiri, bukan tangkapan layar: yang di luar
     * layar ikut terekam, dan itulah yang membuat rekap panjang tetap utuh.
     */
    private void eksporPng() {
        try {
            int w = root.getWidth();
            int h = root.getHeight();
            if (w <= 0 || h <= 0) {
                Toast.makeText(this, "Halamannya belum siap digambar.",
                        Toast.LENGTH_LONG).show();
                return;
            }
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            android.graphics.Canvas kanvas = new android.graphics.Canvas(bmp);
            kanvas.drawColor(Color.WHITE);
            root.draw(kanvas);
            java.io.File f = new java.io.File(getExternalFilesDir(null),
                    "rekap-pencairan-" + kodeBatch() + ".png");
            java.io.FileOutputStream os = new java.io.FileOutputStream(f);
            bmp.compress(Bitmap.CompressFormat.PNG, 100, os);
            os.close();
            bmp.recycle();
            bagikanBerkas(f, "image/png");
        } catch (Exception e) {
            Toast.makeText(this, "Gagal membuat PNG.", Toast.LENGTH_LONG).show();
        }
    }

    private void bagikanBerkas(java.io.File f, String mime) {
        try {
            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                    this, getPackageName() + ".berkas", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, "Bagikan lewat"));
        } catch (Exception e) {
            Toast.makeText(this, "Tidak ada aplikasi yang bisa menerima berkas ini.",
                    Toast.LENGTH_LONG).show();
        }
    }

    private String namaToko(String shopId) {
        for (int i = 0; shops != null && i < shops.length(); i++) {
            JSONObject s = shops.optJSONObject(i);
            if (s != null && shopId.equals(s.optString("id"))) {
                String n = s.optString("displayName", "");
                if (n.isEmpty() || "null".equals(n)) n = s.optString("shopName", "");
                return n.isEmpty() ? shopId.substring(0, Math.min(8, shopId.length())) : n;
            }
        }
        return shopId.isEmpty() ? "-" : shopId.substring(0, Math.min(8, shopId.length()));
    }

    static String jenis(String t) {
        if ("sub_seller".equals(t)) return "Sub-seller";
        if ("sub_sub_seller".equals(t)) return "Sub-sub-seller";
        if ("sedekah".equals(t)) return "Sedekah";
        if ("bahan_baku".equals(t)) return "Bahan baku";
        return t;
    }

    static String labelValidasi(String v) {
        if ("cocok_otomatis".equals(v)) return "Bukti cocok";
        if ("override_manual".equals(v)) return "Di-override manual";
        if ("tidak_cocok".equals(v)) return "Bukti belum cocok";
        return "Belum ada bukti";
    }

    static String rp(double v) {
        return "Rp " + String.format(new Locale("id", "ID"), "%,.0f", v);
    }

    private LinearLayout.LayoutParams lebar() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (8 * getResources().getDisplayMetrics().density);
        return lp;
    }

    private TextView judul(String t) {
        float d = getResources().getDisplayMetrics().density;
        TextView v = new TextView(this);
        v.setTextSize(15);
        v.setTextColor(Color.parseColor("#20242B"));
        v.setPadding(0, (int) (16 * d), 0, (int) (6 * d));
        v.setText(t);
        return v;
    }

    private TextView catatan(String t) {
        float d = getResources().getDisplayMetrics().density;
        TextView v = new TextView(this);
        v.setTextSize(11);
        v.setTextColor(Color.parseColor("#6B7178"));
        v.setPadding(0, (int) (8 * d), 0, 0);
        v.setText(t);
        return v;
    }

    private LinearLayout kotak(String judul, String isi) {
        float d = getResources().getDisplayMetrics().density;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding((int) (12 * d), (int) (12 * d), (int) (12 * d), (int) (12 * d));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (8 * d);
        box.setLayoutParams(lp);
        box.setBackgroundColor(Color.parseColor("#F6F7F8"));

        TextView t = new TextView(this);
        t.setTextSize(14);
        t.setTextColor(Color.parseColor("#20242B"));
        t.setText(judul);
        box.addView(t);

        TextView s = new TextView(this);
        s.setTextSize(12);
        s.setTextColor(Color.parseColor("#6B7178"));
        s.setText(isi);
        box.addView(s);
        return box;
    }
}
