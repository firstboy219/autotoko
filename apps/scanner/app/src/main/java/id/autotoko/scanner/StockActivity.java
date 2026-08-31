package id.autotoko.scanner;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Base64;
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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Request Pembelian Stok (non-COD), dikirim ke pemasok lewat WhatsApp.
 *
 * MENGGANTIKAN "Kontrol Stok Bahan Baku". Rekap itu menjawab "apa yang ada di
 * rak" lalu berakhir di layar. Yang dibutuhkan langkah sesudahnya -- "apa yang
 * harus dibeli, berapa banyak, berapa harganya" -- dan itu berakhir di
 * WhatsApp pemasok.
 *
 * DI PONSEL, bukan hanya di web, karena tangkapan layar Shopee ada di ponsel.
 * Menyuruh orang memindahkannya ke komputer dulu adalah cara membuat fitur ini
 * tidak dipakai.
 *
 * DUA SATUAN DI SETIAP BARIS, dan itu inti layarnya. Pemasok menjual "2
 * botol"; rak menghitung "2.000 ml". Selama ini terjemahan itu dikerjakan
 * orang di kepalanya ke dalam kolom yang hanya berlabel "ml" -- dan mengetik 2
 * untuk dua botol satu liter adalah pembacaan yang wajar, yang mengkredit rak
 * dengan seperseribu dari yang datang. Di sini keduanya diketik dan
 * terjemahannya diperlihatkan sambil mengetik.
 *
 * TIDAK MENYENTUH STOK. Permintaan bukan pembelian: barangnya belum datang.
 * Stok tetap bertambah lewat scan bahan baku datang.
 */
public class StockActivity extends AppCompatActivity {

    private static final int REQ_TANGKAPAN = 7401;
    /** Lebih dari ini di satu permintaan, layarnya jadi gulungan tanpa ujung. */
    private static final int MAKS_BARIS = 12;

    private Session session;
    private Api api;

    private LinearLayout kotakBaris;
    private TextView statusGambar;
    private TextView totalView;
    private MaterialButton tombolKirim;
    private EditText catatan;

    private String screenshotUrl = null;
    private final List<Bahan> katalog = new ArrayList<>();
    private final List<Baris> baris = new ArrayList<>();

    private static final class Bahan {
        final String id, nama, satuan;
        Bahan(String id, String nama, String satuan) {
            this.id = id; this.nama = nama; this.satuan = satuan;
        }
        @Override public String toString() {
            return nama + (satuan == null || satuan.isEmpty() ? "" : " (" + satuan + ")");
        }
    }

    /** Satu baris permintaan beserta kolom-kolomnya di layar. */
    private static final class Baris {
        Spinner bahan;
        EditText namaMentah, jumlah, kemasan, isi, satuanIsi, harga;
        TextView terjemahan;
        View akar;
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);

        ScrollView gulung = new ScrollView(this);
        LinearLayout akar = new LinearLayout(this);
        akar.setOrientation(LinearLayout.VERTICAL);
        akar.setPadding(pad, pad, pad, pad);
        gulung.addView(akar);
        setContentView(gulung);

        TextView judul = new TextView(this);
        judul.setText("Request Pembelian Stok");
        judul.setTextSize(20);
        judul.setTextColor(Color.parseColor("#1B1D1F"));
        akar.addView(judul);

        TextView sub = new TextView(this);
        sub.setText("Lampirkan tangkapan layar marketplace, petakan ke master bahan baku, "
                + "lalu kirim ke pemasok lewat WhatsApp. Pembayaran transfer (non-COD).");
        sub.setTextSize(12);
        sub.setTextColor(Color.parseColor("#6B7178"));
        sub.setPadding(0, (int) (4 * d), 0, (int) (14 * d));
        akar.addView(sub);

        MaterialButton pilihGambar = new MaterialButton(this);
        pilihGambar.setText("Pilih tangkapan layar");
        pilihGambar.setAllCaps(false);
        pilihGambar.setOnClickListener(v -> {
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.setType("image/*");
            startActivityForResult(Intent.createChooser(pick, "Pilih tangkapan layar"),
                    REQ_TANGKAPAN);
        });
        akar.addView(pilihGambar);

        statusGambar = new TextView(this);
        statusGambar.setTextSize(11);
        statusGambar.setTextColor(Color.parseColor("#B8860B"));
        statusGambar.setText("Belum ada tangkapan layar — permintaan belum bisa dikirim.");
        statusGambar.setPadding(0, (int) (6 * d), 0, (int) (14 * d));
        akar.addView(statusGambar);

        kotakBaris = new LinearLayout(this);
        kotakBaris.setOrientation(LinearLayout.VERTICAL);
        akar.addView(kotakBaris);

        MaterialButton tambah = new MaterialButton(this);
        tambah.setText("+ Tambah bahan");
        tambah.setAllCaps(false);
        tambah.setOnClickListener(v -> {
            if (baris.size() >= MAKS_BARIS) {
                Toast.makeText(this, "Sudah " + MAKS_BARIS + " bahan — kirim dulu yang ini.",
                        Toast.LENGTH_SHORT).show();
                return;
            }
            tambahBaris();
        });
        akar.addView(tambah);

        catatan = new EditText(this);
        catatan.setHint("Catatan untuk pemasok (opsional)");
        catatan.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        akar.addView(catatan);

        totalView = new TextView(this);
        totalView.setTextSize(16);
        totalView.setTextColor(Color.parseColor("#1B1D1F"));
        totalView.setPadding(0, (int) (12 * d), 0, (int) (8 * d));
        akar.addView(totalView);

        tombolKirim = new MaterialButton(this);
        tombolKirim.setText("Request via WhatsApp");
        tombolKirim.setAllCaps(false);
        tombolKirim.setEnabled(false);
        tombolKirim.setOnClickListener(v -> kirim());
        akar.addView(tombolKirim);

        MaterialButton tutup = new MaterialButton(this);
        tutup.setText("Tutup");
        tutup.setAllCaps(false);
        tutup.setOnClickListener(v -> finish());
        akar.addView(tutup);

        muatBahan();
        hitungTotal();
    }

    // ------------------------------------------------------------- katalog

    private void muatBahan() {
        api.materials(r -> runOnUiThread(() -> {
            katalog.clear();
            JSONArray arr = r.ok() ? r.dataArray() : null;
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o == null) continue;
                    katalog.add(new Bahan(o.optString("id", ""), o.optString("name", ""),
                            PayoutUi.str(o, "unit", "")));
                }
            }
            if (katalog.isEmpty()) {
                Toast.makeText(this,
                        "Master bahan baku belum termuat. Bahan tetap bisa diketik namanya.",
                        Toast.LENGTH_LONG).show();
            }
            if (baris.isEmpty()) tambahBaris();
            else for (Baris b : baris) isiSpinner(b);
        }));
    }

    private void isiSpinner(Baris b) {
        List<String> nama = new ArrayList<>();
        nama.add("— belum dipetakan —");
        for (Bahan x : katalog) nama.add(x.toString());
        ArrayAdapter<String> ad = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, nama);
        ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        b.bahan.setAdapter(ad);
    }

    // --------------------------------------------------------------- baris

    private void tambahBaris() {
        float d = getResources().getDisplayMetrics().density;
        final Baris b = new Baris();

        LinearLayout kotak = new LinearLayout(this);
        kotak.setOrientation(LinearLayout.VERTICAL);
        kotak.setPadding((int) (10 * d), (int) (10 * d), (int) (10 * d), (int) (10 * d));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = (int) (10 * d);
        kotak.setLayoutParams(lp);
        b.akar = kotak;

        b.bahan = new Spinner(this);
        kotak.addView(b.bahan);
        isiSpinner(b);

        b.namaMentah = new EditText(this);
        b.namaMentah.setHint("Nama di marketplace (opsional)");
        kotak.addView(b.namaMentah);

        LinearLayout r1 = new LinearLayout(this);
        r1.setOrientation(LinearLayout.HORIZONTAL);
        b.jumlah = angka("Jumlah", "1");
        b.kemasan = teks("Kemasan (botol)");
        r1.addView(b.jumlah, isiRata());
        r1.addView(b.kemasan, isiRata());
        kotak.addView(r1);

        LinearLayout r2 = new LinearLayout(this);
        r2.setOrientation(LinearLayout.HORIZONTAL);
        b.isi = angka("Isi per kemasan", "");
        b.satuanIsi = teks("Satuan isi (liter)");
        r2.addView(b.isi, isiRata());
        r2.addView(b.satuanIsi, isiRata());
        kotak.addView(r2);

        b.harga = angka("Harga per kemasan", "");
        kotak.addView(b.harga);

        b.terjemahan = new TextView(this);
        b.terjemahan.setTextSize(11);
        b.terjemahan.setTextColor(Color.parseColor("#6B7178"));
        kotak.addView(b.terjemahan);

        MaterialButton hapus = new MaterialButton(this);
        hapus.setText("Hapus baris");
        hapus.setAllCaps(false);
        hapus.setOnClickListener(v -> {
            kotakBaris.removeView(kotak);
            baris.remove(b);
            hitungTotal();
        });
        kotak.addView(hapus);

        TextWatcher w = new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int c, int d2) {}
            @Override public void onTextChanged(CharSequence s, int a, int c, int d2) {}
            @Override public void afterTextChanged(Editable e) { hitungTotal(); }
        };
        b.jumlah.addTextChangedListener(w);
        b.isi.addTextChangedListener(w);
        b.satuanIsi.addTextChangedListener(w);
        b.harga.addTextChangedListener(w);
        b.bahan.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> p, View v,
                                                 int pos, long id) { hitungTotal(); }
            @Override public void onNothingSelected(android.widget.AdapterView<?> p) {}
        });

        kotakBaris.addView(kotak);
        baris.add(b);
        hitungTotal();
    }

    private LinearLayout.LayoutParams isiRata() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    }

    private EditText angka(String hint, String awal) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        if (awal != null && !awal.isEmpty()) e.setText(awal);
        return e;
    }

    private EditText teks(String hint) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setInputType(InputType.TYPE_CLASS_TEXT);
        return e;
    }

    private static double num(EditText e) {
        try {
            String s = e.getText().toString().trim().replace(",", ".");
            return s.isEmpty() ? 0 : Double.parseDouble(s);
        } catch (Exception ignored) {
            return 0;
        }
    }

    private Bahan bahanDari(Baris b) {
        int pos = b.bahan.getSelectedItemPosition();
        // Posisi 0 adalah "belum dipetakan".
        if (pos <= 0 || pos - 1 >= katalog.size()) return null;
        return katalog.get(pos - 1);
    }

    /**
     * Terjemahan yang diperlihatkan sambil mengetik.
     *
     * Dihitung di sini HANYA untuk diperlihatkan; yang disimpan tetap hitungan
     * server. Dua penghitung untuk satu angka akan berbeda suatu saat, dan yang
     * benar adalah yang tersimpan.
     */
    private void hitungTotal() {
        double total = 0;
        for (Baris b : baris) {
            double qty = num(b.jumlah);
            double harga = num(b.harga);
            total += qty * harga;

            Bahan m = bahanDari(b);
            String isiSat = b.satuanIsi.getText().toString().trim();
            double isi = num(b.isi);
            if (m == null || m.satuan == null || m.satuan.isEmpty()) {
                b.terjemahan.setText("Pilih bahan baku untuk melihat terjemahannya");
                b.terjemahan.setTextColor(Color.parseColor("#9AA0A6"));
            } else if (isi <= 0 || isiSat.isEmpty()) {
                b.terjemahan.setText("Masuk ke stok sebagai " + Units.describe(qty, m.satuan));
                b.terjemahan.setTextColor(Color.parseColor("#6B7178"));
            } else {
                Double per = Units.convert(isi, isiSat, m.satuan);
                if (per == null) {
                    // Tidak sepadan: liter untuk bahan yang dicatat per pcs.
                    // Ditandai, bukan dihitung jadi nol -- nol akan tersimpan
                    // sebagai "tidak ada yang datang".
                    b.terjemahan.setText("Satuan \"" + isiSat + "\" tidak sepadan dengan \""
                            + m.satuan + "\"");
                    b.terjemahan.setTextColor(Color.parseColor("#B8860B"));
                } else {
                    b.terjemahan.setText("Masuk ke stok sebagai "
                            + Units.describe(qty * per, m.satuan));
                    b.terjemahan.setTextColor(Color.parseColor("#1B7F4B"));
                }
            }
        }
        totalView.setText("Total: " + PayoutShare.rp(total));
        boolean adaIsi = false;
        for (Baris b : baris) {
            if (bahanDari(b) != null || !b.namaMentah.getText().toString().trim().isEmpty()) {
                adaIsi = true;
                break;
            }
        }
        tombolKirim.setEnabled(screenshotUrl != null && adaIsi);
    }

    // ---------------------------------------------------------- tangkapan

    @Override protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_TANGKAPAN || result != Activity.RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null) return;
        statusGambar.setText("Mengunggah tangkapan layar…");
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            Bitmap bmp = BitmapFactory.decodeStream(in);
            if (bmp == null) throw new IllegalStateException("gambar tidak terbaca");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
            String b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            api.uploadImage(b64, "jpg", r -> runOnUiThread(() -> {
                JSONObject d = r.ok() ? r.data() : null;
                String url = d == null ? null : PayoutUi.str(d, "url", null);
                if (url == null) {
                    screenshotUrl = null;
                    statusGambar.setText("Gagal mengunggah: " + r.message("coba lagi"));
                    statusGambar.setTextColor(Color.parseColor("#C1121F"));
                } else {
                    screenshotUrl = url;
                    statusGambar.setText("Tangkapan layar siap.");
                    statusGambar.setTextColor(Color.parseColor("#1B7F4B"));
                }
                hitungTotal();
            }));
        } catch (Exception e) {
            statusGambar.setText("Gagal membaca gambar: " + e.getMessage());
            statusGambar.setTextColor(Color.parseColor("#C1121F"));
        }
    }

    // -------------------------------------------------------------- kirim

    private void kirim() {
        if (screenshotUrl == null) return;
        tombolKirim.setEnabled(false);
        tombolKirim.setText("Mengirim…");
        try {
            JSONObject body = new JSONObject();
            body.put("screenshotUrl", screenshotUrl);
            String cat = catatan.getText().toString().trim();
            if (!cat.isEmpty()) body.put("note", cat);

            JSONArray items = new JSONArray();
            for (Baris b : baris) {
                Bahan m = bahanDari(b);
                String mentah = b.namaMentah.getText().toString().trim();
                if (m == null && mentah.isEmpty()) continue;
                JSONObject o = new JSONObject();
                if (m != null) o.put("materialId", m.id);
                if (!mentah.isEmpty()) o.put("rawName", mentah);
                o.put("qtyPack", num(b.jumlah));
                String kem = b.kemasan.getText().toString().trim();
                if (!kem.isEmpty()) o.put("packLabel", kem);
                double isi = num(b.isi);
                String isiSat = b.satuanIsi.getText().toString().trim();
                if (isi > 0 && !isiSat.isEmpty()) {
                    o.put("contentPerPack", isi);
                    o.put("contentUnit", isiSat);
                }
                double harga = num(b.harga);
                if (harga > 0) o.put("unitPrice", harga);
                items.put(o);
            }
            body.put("items", items);

            api.stockRequestCreate(body, r -> runOnUiThread(() -> {
                JSONObject d = r.ok() ? r.data() : null;
                String id = d == null ? null : PayoutUi.str(d, "id", null);
                if (id == null) {
                    tombolKirim.setEnabled(true);
                    tombolKirim.setText("Request via WhatsApp");
                    Toast.makeText(this, "Gagal menyimpan: " + r.message("coba lagi"),
                            Toast.LENGTH_LONG).show();
                    return;
                }
                // Teksnya diminta ke server, bukan disusun di sini: satu sumber
                // kebenaran untuk yang akan terkirim ke pemasok.
                api.stockRequestWa(id, true, r2 -> runOnUiThread(() -> {
                    tombolKirim.setEnabled(true);
                    tombolKirim.setText("Request via WhatsApp");
                    JSONObject d2 = r2.ok() ? r2.data() : null;
                    String teks = d2 == null ? null : PayoutUi.str(d2, "teks", null);
                    if (teks == null) {
                        Toast.makeText(this,
                                "Permintaan tersimpan, tapi pesannya gagal disusun: "
                                        + r2.message("coba bagikan dari web"),
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, teks);
                    startActivity(Intent.createChooser(send, "Kirim permintaan lewat"));
                    finish();
                }));
            }));
        } catch (Exception e) {
            tombolKirim.setEnabled(true);
            tombolKirim.setText("Request via WhatsApp");
            Toast.makeText(this, "Gagal menyusun permintaan: " + e.getMessage(),
                    Toast.LENGTH_LONG).show();
        }
    }
}
