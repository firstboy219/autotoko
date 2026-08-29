package id.autotoko.scanner;

import android.content.Context;
import android.graphics.Color;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;

import org.json.JSONObject;

import java.util.Locale;

/**
 * Potongan tampilan yang dipakai berulang oleh layar-layar pencairan.
 *
 * Lima layar yang ditambahkan belakangan menulis form dan daftar yang bentuknya
 * sama; tanpa ini tiap layar menyalin selusin baris pembuatan View, dan
 * satu-satunya cara mengubah gayanya adalah mengubah kelimanya.
 */
final class PayoutUi {

    private PayoutUi() {}

    static final String INK = "#1B1D1F";
    static final String INK2 = "#6B7178";
    static final String INK3 = "#9AA0A6";
    static final String GARIS = "#E7E5DF";
    static final String OK = "#1B7F4B";
    static final String PERHATIAN = "#8A5A00";

    static float d(Context c) {
        return c.getResources().getDisplayMetrics().density;
    }

    static String rp(double v) {
        return "Rp " + String.format(new Locale("id", "ID"), "%,.0f", v);
    }

    /** Angka dari server bisa datang sebagai string ("0.0500"); keduanya dibaca. */
    static double num(JSONObject o, String k) {
        if (o == null || !o.has(k) || o.isNull(k)) return 0;
        return o.optDouble(k, 0);
    }

    static String str(JSONObject o, String k, String bawaan) {
        if (o == null || !o.has(k) || o.isNull(k)) return bawaan;
        String v = o.optString(k, "");
        return (v.isEmpty() || "null".equals(v)) ? bawaan : v;
    }

    /** "20%" dari 0.2 — dengan desimal hanya kalau memang ada. */
    static String persen(double pecahan) {
        double p = pecahan * 100;
        return (Math.abs(p - Math.round(p)) < 0.005)
                ? String.valueOf(Math.round(p)) + "%"
                : String.format(Locale.US, "%.2f%%", p);
    }

    static TextView judul(Context c, String t) {
        TextView v = new TextView(c);
        v.setText(t);
        v.setTextSize(15);
        v.setTextColor(Color.parseColor(INK));
        v.setTypeface(v.getTypeface(), android.graphics.Typeface.BOLD);
        v.setPadding(0, (int) (16 * d(c)), 0, (int) (6 * d(c)));
        return v;
    }

    static TextView label(Context c, String t) {
        TextView v = new TextView(c);
        v.setText(t);
        v.setTextSize(11);
        v.setTextColor(Color.parseColor(INK3));
        v.setPadding(0, (int) (10 * d(c)), 0, (int) (2 * d(c)));
        return v;
    }

    static TextView catatan(Context c, String t) {
        TextView v = new TextView(c);
        v.setText(t);
        v.setTextSize(11);
        v.setTextColor(Color.parseColor(INK2));
        v.setPadding(0, (int) (4 * d(c)), 0, (int) (4 * d(c)));
        return v;
    }

    static EditText isian(Context c, String hint, String nilai, boolean angka) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setText(nilai == null ? "" : nilai);
        e.setTextSize(14);
        e.setSingleLine(true);
        e.setInputType(angka
                ? (InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL)
                : InputType.TYPE_CLASS_TEXT);
        return e;
    }

    static MaterialButton tombol(Context c, String teks, View.OnClickListener aksi) {
        MaterialButton b = new MaterialButton(c);
        b.setText(teks);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setOnClickListener(aksi);
        return b;
    }

    static LinearLayout.LayoutParams lebar(Context c) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (8 * d(c));
        return lp;
    }

    /** Satu blok berbingkai: judul kecil di atas, isi di bawahnya. */
    static LinearLayout kotak(Context c, String judul, String isi) {
        LinearLayout box = new LinearLayout(c);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (12 * d(c));
        box.setPadding(p, p, p, p);
        box.setBackgroundColor(Color.parseColor("#FFFFFF"));

        TextView t = new TextView(c);
        t.setText(judul);
        t.setTextSize(11);
        t.setTextColor(Color.parseColor(INK3));
        box.addView(t);

        TextView i = new TextView(c);
        i.setText(isi);
        i.setTextSize(14);
        i.setTextColor(Color.parseColor(INK));
        box.addView(i);

        box.setLayoutParams(lebar(c));
        return box;
    }

    /** Baris daftar yang bisa diketuk: judul, keterangan, dan nilai di kanan. */
    static LinearLayout baris(Context c, String kiriAtas, String kiriBawah, String kanan,
                              View.OnClickListener aksi) {
        LinearLayout row = new LinearLayout(c);
        row.setOrientation(LinearLayout.HORIZONTAL);
        int p = (int) (10 * d(c));
        row.setPadding(0, p, 0, p);

        LinearLayout kiri = new LinearLayout(c);
        kiri.setOrientation(LinearLayout.VERTICAL);
        kiri.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView a = new TextView(c);
        a.setText(kiriAtas);
        a.setTextSize(14);
        a.setTextColor(Color.parseColor(INK));
        kiri.addView(a);
        if (kiriBawah != null && !kiriBawah.isEmpty()) {
            TextView b = new TextView(c);
            b.setText(kiriBawah);
            b.setTextSize(11);
            b.setTextColor(Color.parseColor(INK2));
            kiri.addView(b);
        }
        row.addView(kiri);

        if (kanan != null && !kanan.isEmpty()) {
            TextView k = new TextView(c);
            k.setText(kanan);
            k.setTextSize(14);
            k.setTextColor(Color.parseColor(INK));
            row.addView(k);
        }
        if (aksi != null) row.setOnClickListener(aksi);
        return row;
    }

    static View garis(Context c) {
        View v = new View(c);
        v.setBackgroundColor(Color.parseColor(GARIS));
        v.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, (int) d(c))));
        return v;
    }

    /** Isi kotak angka jadi double; kosong dianggap 0. */
    static double angka(EditText e) {
        try {
            String s = e.getText().toString().trim().replace(",", ".");
            return s.isEmpty() ? 0 : Double.parseDouble(s);
        } catch (Exception ex) {
            return 0;
        }
    }
}
