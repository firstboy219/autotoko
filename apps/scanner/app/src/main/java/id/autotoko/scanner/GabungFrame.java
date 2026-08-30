package id.autotoko.scanner;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * Menggabungkan bidikan-bidikan satu resi menjadi SATU gambar utuh.
 *
 * MASALAHNYA. Panduan bertahap memotret empat kali -- nomor pesanan, toko,
 * kurir, daftar produk -- masing-masing dari dekat. Keempatnya lalu disimpan
 * terpisah: yang pertama jadi foto utama, sisanya menyusul sebagai halaman.
 * Satu paket karena itu tidak punya satu pun gambar yang menunjukkan seluruh
 * labelnya; yang ada empat potongan yang harus dibuka satu per satu.
 *
 * YANG DIKERJAKAN. Keempatnya disusun dalam satu kanvas berkisi, masing-masing
 * diberi nama tahapnya, lalu dikeluarkan sebagai satu JPEG. Itulah yang jadi
 * foto utama paket tersebut.
 *
 * SATU HAL YANG PERLU DIKATAKAN TERUS TERANG. Menyatukan gambar TIDAK
 * menambah ketajaman -- ia justru mengecilkan tiap bidikan supaya muat dalam
 * satu bingkai. Yang membuat nomor pesanan tetap terbaca saat diperbesar
 * berkali-kali bukan penggabungannya, melainkan fakta bahwa tiap bidikan
 * diambil DARI DEKAT: nomor yang memenuhi layar menghasilkan ribuan piksel
 * pada tulisan itu sendiri, jauh lebih banyak daripada satu foto seluruh label
 * dari jauh betapa pun besar ukurannya.
 *
 * Karena itu keduanya disimpan: gambar gabungan sebagai pandangan menyeluruh,
 * dan tiap bidikan aslinya tetap dikirim utuh sebagai halaman terpisah. Yang
 * ingin memperbesar sampai ke serat kertasnya membuka bidikan aslinya, dan di
 * situ tidak ada satu piksel pun yang hilang.
 */
final class GabungFrame {

    private GabungFrame() {}

    /**
     * Anggaran piksel kanvas gabungan.
     *
     * Sembilan megapiksel: lebih dari empat kali Full HD, dan pada RGB_565
     * memakan sekitar 18 MB -- masih aman di ponsel kelas bawah yang dipakai
     * di meja packing. Menaikkannya menukar sesuatu yang tidak terlihat
     * (ketajaman melebihi yang bisa ditampilkan) dengan sesuatu yang terlihat
     * (aplikasi mati kehabisan memori saat paket sedang dipegang).
     */
    static final int MAKS_PIKSEL = 9_000_000;

    /** Sisi terpanjang kanvas gabungan. */
    static final int MAKS_SISI = 4096;

    /** Tinggi jalur nama tahap, dalam piksel, relatif terhadap lebar sel. */
    private static final float TINGGI_JUDUL = 0.055f;

    // -----------------------------------------------------------------------
    // Tata letak: bagian yang murni hitungan, jadi bisa diuji tanpa Android
    // -----------------------------------------------------------------------

    /** Berapa kolom untuk n bidikan. */
    static int kolom(int n) {
        if (n <= 1) return 1;
        if (n <= 2) return 2;
        if (n <= 4) return 2;
        if (n <= 6) return 3;
        return 3;
    }

    /** Berapa baris untuk n bidikan. */
    static int baris(int n) {
        int k = kolom(n);
        return (n + k - 1) / k;
    }

    /**
     * Ukuran kanvas gabungan: {lebar, tinggi, lebarSel, tinggiSel}.
     *
     * Setiap sel berbentuk sama supaya kisinya rapi; bidikan yang rasionya
     * berbeda dimuat di dalamnya tanpa dipotong (lihat muat()). Kalau tiap sel
     * diukur sendiri-sendiri, kisinya akan bergerigi dan mata harus bekerja
     * mencari batas antar bidikan.
     */
    static int[] ukuran(int n, int lebarSumber, int tinggiSumber) {
        if (n <= 0 || lebarSumber <= 0 || tinggiSumber <= 0) return new int[]{0, 0, 0, 0};
        int k = kolom(n), b = baris(n);
        float rasio = (float) tinggiSumber / lebarSumber;
        // Tinggi sel = tinggi gambar + jalur nama di atasnya.
        float tinggiSelPerLebar = rasio + TINGGI_JUDUL;

        // Mulai dari lebar terbesar yang diizinkan, lalu turunkan sampai muat
        // dalam KEDUA batas: sisi terpanjang dan jumlah piksel.
        float lebarSel = (float) MAKS_SISI / k;
        if (lebarSel * tinggiSelPerLebar * b > MAKS_SISI) {
            lebarSel = MAKS_SISI / (tinggiSelPerLebar * b);
        }
        float piksel = (lebarSel * k) * (lebarSel * tinggiSelPerLebar * b);
        if (piksel > MAKS_PIKSEL) {
            lebarSel *= (float) Math.sqrt(MAKS_PIKSEL / piksel);
        }

        // Dibulatkan ke BAWAH, lalu diturunkan sampai benar-benar muat.
        //
        // Penskalaan akar tadi menghitung dalam pecahan; begitu dibulatkan,
        // sisa pembulatan tiap sel dikalikan jumlah kolom dan barisnya dan
        // hasilnya bisa melewati anggaran. Terukur: 2560x1920 dengan satu
        // bidikan keluar 3344x2692 = 9.002.048 piksel, lewat tipis. Selisih
        // sekecil itu tidak terlihat di gambar, tapi anggarannya ada supaya
        // ponsel kelas bawah tidak mati kehabisan memori -- dan batas yang
        // hampir ditaati bukan batas.
        int ls = Math.max(1, (int) Math.floor(lebarSel));
        int ts = Math.max(1, (int) Math.floor(lebarSel * tinggiSelPerLebar));
        while ((long) ls * k * (long) ts * b > MAKS_PIKSEL && ls > 1) {
            ls -= 1;
            ts = Math.max(1, (int) Math.floor(ls * tinggiSelPerLebar));
        }
        return new int[]{ls * k, ts * b, ls, ts};
    }

    /**
     * Persegi tempat sebuah bidikan digambar di dalam selnya, tanpa dipotong.
     *
     * Memotong untuk memenuhi sel akan membuang tepi label -- dan tepi itulah
     * yang sering memuat nomor pesanannya.
     */
    static int[] muat(int lebarSel, int tinggiSel, int lebarGambar, int tinggiGambar) {
        if (lebarGambar <= 0 || tinggiGambar <= 0) return new int[]{0, 0, 0, 0};
        float s = Math.min((float) lebarSel / lebarGambar, (float) tinggiSel / tinggiGambar);
        int w = Math.max(1, Math.round(lebarGambar * s));
        int h = Math.max(1, Math.round(tinggiGambar * s));
        return new int[]{(lebarSel - w) / 2, (tinggiSel - h) / 2, w, h};
    }

    // -----------------------------------------------------------------------
    // Perakitan
    // -----------------------------------------------------------------------

    /**
     * Satu JPEG base64 dari beberapa bidikan base64, atau null kalau gagal.
     *
     * Mengembalikan null, bukan melempar: gambar gabungan itu kenyamanan, dan
     * paket yang fisiknya sudah siap berangkat tidak boleh tertahan karena
     * penyusunan gambar gagal.
     */
    static String rakit(List<String> bidikan, String[] nama, int kualitas) {
        if (bidikan == null || bidikan.isEmpty()) return null;
        if (bidikan.size() == 1) return bidikan.get(0);

        Bitmap kanvasBmp = null;
        try {
            int n = bidikan.size();
            int[] dim0 = dimensi(bidikan.get(0));
            if (dim0 == null) return null;

            int[] u = ukuran(n, dim0[0], dim0[1]);
            if (u[0] <= 0 || u[1] <= 0) return null;

            kanvasBmp = Bitmap.createBitmap(u[0], u[1], Bitmap.Config.RGB_565);
            Canvas c = new Canvas(kanvasBmp);
            c.drawColor(Color.parseColor("#111315"));

            Paint judul = new Paint(Paint.ANTI_ALIAS_FLAG);
            judul.setColor(Color.parseColor("#C8CDD2"));
            judul.setTextSize(u[3] * TINGGI_JUDUL * 0.62f);
            Paint garis = new Paint();
            garis.setColor(Color.parseColor("#2A2E33"));

            int k = kolom(n);
            int jalur = Math.round(u[3] * TINGGI_JUDUL);
            for (int i = 0; i < n; i++) {
                int sx = (i % k) * u[2];
                int sy = (i / k) * u[3];

                String label = (nama != null && i < nama.length && nama[i] != null)
                        ? nama[i] : ("Bidikan " + (i + 1));
                c.drawText(label, sx + jalur * 0.35f, sy + jalur * 0.72f, judul);
                c.drawRect(sx, sy + jalur - 1, sx + u[2], sy + jalur, garis);

                Bitmap bm = muatBidikan(bidikan.get(i), u[2], u[3] - jalur);
                if (bm == null) continue;
                int[] r = muat(u[2], u[3] - jalur, bm.getWidth(), bm.getHeight());
                c.drawBitmap(bm, null,
                        new Rect(sx + r[0], sy + jalur + r[1], sx + r[0] + r[2], sy + jalur + r[1] + r[3]),
                        new Paint(Paint.FILTER_BITMAP_FLAG));
                bm.recycle();
            }

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            kanvasBmp.compress(Bitmap.CompressFormat.JPEG, kualitas, out);
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable t) {
            // Termasuk OutOfMemoryError: ponsel di meja packing sering sudah
            // penuh, dan gagal menyusun gambar tidak boleh menjatuhkan scan.
            return null;
        } finally {
            if (kanvasBmp != null) kanvasBmp.recycle();
        }
    }

    /** Lebar dan tinggi sebuah bidikan tanpa memuat pikselnya. */
    private static int[] dimensi(String b64) {
        try {
            byte[] b = Base64.decode(b64, Base64.NO_WRAP);
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(b, 0, b.length, o);
            return o.outWidth > 0 && o.outHeight > 0 ? new int[]{o.outWidth, o.outHeight} : null;
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * Memuat bidikan sudah dikecilkan mendekati ukuran selnya.
     *
     * inSampleSize dipakai supaya bitmap seukuran penuh tidak pernah ada di
     * memori sekaligus dengan kanvasnya -- di situlah aplikasi mati kalau
     * gambar dimuat utuh dulu baru dikecilkan.
     */
    private static Bitmap muatBidikan(String b64, int lebarSel, int tinggiSel) {
        try {
            byte[] b = Base64.decode(b64, Base64.NO_WRAP);
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(b, 0, b.length, o);
            o.inSampleSize = sampel(o.outWidth, o.outHeight, lebarSel, tinggiSel);
            o.inJustDecodeBounds = false;
            o.inPreferredConfig = Bitmap.Config.RGB_565;
            return BitmapFactory.decodeByteArray(b, 0, b.length, o);
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * Pembagi dua terbesar yang MASIH menyisakan piksel lebih banyak daripada
     * selnya. Turun satu tingkat lagi berarti gambar diperbesar saat digambar,
     * dan pengecilan yang berlebihan tidak bisa dibatalkan.
     */
    static int sampel(int lebar, int tinggi, int lebarSel, int tinggiSel) {
        int s = 1;
        if (lebar <= 0 || tinggi <= 0 || lebarSel <= 0 || tinggiSel <= 0) return 1;
        while (lebar / (s * 2) >= lebarSel && tinggi / (s * 2) >= tinggiSel) s *= 2;
        return s;
    }
}
