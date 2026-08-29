package id.autotoko.scanner;

import android.os.Bundle;
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

import org.json.JSONObject;

/**
 * Pengaturan pencairan, isinya sama dengan halaman pengaturan di web.
 *
 * Sedekah dan bagian sub-seller berbagi SATU setelan urutan, bukan dua: mana
 * pun yang diambil lebih dulu dipotong dari kredit penuh dan yang lain
 * dipotong dari sisanya. Dua pilihan terpisah akan membolehkan "sedekah dari
 * sisa setelah sub-seller" sekaligus "sub-seller dari sisa setelah sedekah",
 * yang berputar dan tidak punya jawaban.
 */
public class PayoutSettingsActivity extends AppCompatActivity {

    /** Urutan nilai HARUS sama dengan urutan labelnya di bawah. */
    private static final String[] BASIS = {
        "total_credit", "after_subseller_split", "both_from_total",
    };
    private static final String[] BASIS_LABEL = {
        "Sedekah dari total kredit, sub-seller dari sisanya",
        "Sub-seller dari total kredit, sedekah dari sisanya",
        "Keduanya dihitung dari total kredit",
    };

    private Api api;
    private LinearLayout root;
    private TextView status;

    private EditText sedekah, subSeller, bahan, minTransfer, rekSedekah, rekBahan, feeNominal;
    private Spinner basis;
    private CheckBox feeAktif;
    private boolean sibuk = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        api = new Api(new Session(this));
        setTitle("Pengaturan Pencairan");
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

    private void muat() {
        api.payoutSettings(r -> {
            if (!r.ok() || r.data() == null) {
                status.setText(r.message("Gagal memuat pengaturan."));
                return;
            }
            gambar(r.data());
        });
    }

    private void gambar(JSONObject s) {
        status.setText("");
        root.removeAllViews();
        root.addView(status);

        root.addView(PayoutUi.judul(this, "Sedekah"));
        root.addView(PayoutUi.label(this, "Persentase (%)"));
        sedekah = PayoutUi.isian(this, "5", angkaPersen(PayoutUi.num(s, "sedekahRate")), true);
        root.addView(sedekah);
        root.addView(PayoutUi.label(this, "Rekening tujuan sedekah"));
        rekSedekah = PayoutUi.isian(this, "Nomor rekening + bank",
                PayoutUi.str(s, "sedekahBankAccount", ""), false);
        root.addView(rekSedekah);

        root.addView(PayoutUi.judul(this, "Urutan Pemotongan"));
        basis = new Spinner(this);
        ArrayAdapter<String> ad = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, BASIS_LABEL);
        ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        basis.setAdapter(ad);
        String kini = PayoutUi.str(s, "sedekahBasis", "both_from_total");
        for (int i = 0; i < BASIS.length; i++) {
            if (BASIS[i].equals(kini)) basis.setSelection(i);
        }
        root.addView(basis);
        root.addView(PayoutUi.catatan(this,
                "Satu setelan untuk sedekah dan sub-seller sekaligus. Yang diambil lebih "
                        + "dulu dipotong dari kredit penuh, yang lain dari sisanya."));

        root.addView(PayoutUi.judul(this, "Sub-seller"));
        root.addView(PayoutUi.label(this, "Rate bawaan (%)"));
        subSeller = PayoutUi.isian(this, "20",
                angkaPersen(PayoutUi.num(s, "defaultSubSellerRate")), true);
        root.addView(subSeller);
        root.addView(PayoutUi.catatan(this,
                "Dipakai untuk sub-seller yang tidak punya rate sendiri."));

        root.addView(PayoutUi.judul(this, "Sisihkan untuk Bahan Baku"));
        root.addView(PayoutUi.label(this, "Porsi dari bagian seller (%)"));
        bahan = PayoutUi.isian(this, "50",
                angkaPersen(PayoutUi.num(s, "materialReserveRate")), true);
        root.addView(bahan);
        root.addView(PayoutUi.label(this, "Rekening tujuan bahan baku"));
        rekBahan = PayoutUi.isian(this, "Nomor rekening + bank",
                PayoutUi.str(s, "materialBankAccount", ""), false);
        root.addView(rekBahan);

        root.addView(PayoutUi.judul(this, "Minimum Transfer"));
        minTransfer = PayoutUi.isian(this, "10000",
                bulat(PayoutUi.num(s, "minTransferAmount")), true);
        root.addView(minTransfer);
        root.addView(PayoutUi.catatan(this,
                "Bagian di bawah nominal ini tidak ditransfer, tapi ditahan dan ikut "
                        + "dibayarkan di batch berikutnya."));

        root.addView(PayoutUi.judul(this, "Fee Admin per Batch"));
        feeAktif = new CheckBox(this);
        feeAktif.setText("Catat fee admin di tiap batch");
        feeAktif.setTextSize(14);
        feeAktif.setChecked(s.optBoolean("adminFeeEnabled", false));
        root.addView(feeAktif);
        root.addView(PayoutUi.label(this, "Nominal fee (Rp)"));
        feeNominal = PayoutUi.isian(this, "20000", bulat(PayoutUi.num(s, "adminFeeAmount")), true);
        root.addView(feeNominal);
        root.addView(PayoutUi.catatan(this,
                "Fee tidak dipotong dari pencairan; ia dibayar terpisah. Nominalnya "
                        + "direkam saat batch dibuat, jadi mengubahnya di sini tidak "
                        + "mengubah batch yang sudah jalan."));

        root.addView(PayoutUi.tombol(this, "Simpan Pengaturan", v -> simpan()),
                PayoutUi.lebar(this));
    }

    private static String angkaPersen(double pecahan) {
        double p = pecahan * 100;
        return (Math.abs(p - Math.round(p)) < 0.005)
                ? String.valueOf(Math.round(p))
                : String.valueOf(p);
    }

    private static String bulat(double v) {
        return String.valueOf(Math.round(v));
    }

    private void simpan() {
        if (sibuk) return;
        double sed = PayoutUi.angka(sedekah);
        double sub = PayoutUi.angka(subSeller);
        double bah = PayoutUi.angka(bahan);
        // Dijaga di sini juga, bukan cuma di server: pesan 400 dari validator
        // tidak menyebut kotak mana yang salah.
        if (salah(sed) || salah(sub) || salah(bah)) {
            Toast.makeText(this, "Persentase harus antara 0 dan 100.", Toast.LENGTH_LONG).show();
            return;
        }
        int pilih = basis.getSelectedItemPosition();
        String pilihan = BASIS[pilih < 0 || pilih >= BASIS.length ? 2 : pilih];
        // Hanya mode paralel yang bisa menjatah lebih dari yang ada.
        if ("both_from_total".equals(pilihan) && sed + sub > 100) {
            Toast.makeText(this,
                    "Sedekah + sub-seller lebih dari 100% dari total kredit.",
                    Toast.LENGTH_LONG).show();
            return;
        }

        JSONObject body = new JSONObject();
        try {
            body.put("sedekahRate", sed / 100);
            body.put("defaultSubSellerRate", sub / 100);
            body.put("materialReserveRate", bah / 100);
            body.put("sedekahBasis", pilihan);
            body.put("sedekahBankAccount", rekSedekah.getText().toString().trim());
            body.put("materialBankAccount", rekBahan.getText().toString().trim());
            body.put("minTransferAmount", Math.round(PayoutUi.angka(minTransfer)));
            body.put("adminFeeEnabled", feeAktif.isChecked());
            body.put("adminFeeAmount", Math.round(PayoutUi.angka(feeNominal)));
        } catch (Exception ignored) {}

        sibuk = true;
        status.setText("Menyimpan…");
        api.payoutSaveSettings(body, r -> {
            sibuk = false;
            if (!r.ok()) {
                status.setText(r.message("Gagal menyimpan."));
                Toast.makeText(this, r.message("Gagal menyimpan."), Toast.LENGTH_LONG).show();
                return;
            }
            status.setText("Tersimpan.");
            Toast.makeText(this, "Pengaturan tersimpan.", Toast.LENGTH_SHORT).show();
        });
    }

    private static boolean salah(double persen) {
        return persen < 0 || persen > 100 || Double.isNaN(persen);
    }
}
