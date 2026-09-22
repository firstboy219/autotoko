package id.autotoko.scanner;

import android.app.Application;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

/**
 * Satu tempat menangani sesi yang habis (token 12 jam, tanpa refresh).
 *
 * Didaftarkan di sini -- bukan di satu Activity -- supaya permintaan yang
 * balik 401 dari layar MANA PUN selalu melempar staf ke halaman login, bukan
 * menampilkan daftar kosong tanpa penjelasan. Handler yang dulu dipasang di
 * ScanActivity ikut mati saat Activity itu selesai; yang ini tidak.
 */
public final class App extends Application {
    private static volatile long lastKick = 0L;

    @Override public void onCreate() {
        super.onCreate();
        final Handler main = new Handler(Looper.getMainLooper());
        Api.onUnauthorised(() -> {
            long now = System.currentTimeMillis();
            // Redam lonjakan: banyak request bisa balik 401 nyaris bersamaan.
            if (now - lastKick < 3000L) return;
            lastKick = now;
            main.post(() -> {
                Toast.makeText(this, "Sesi berakhir. Silakan masuk lagi.", Toast.LENGTH_LONG).show();
                // Hanya hapus token aktif; daftar akun + sandi tersimpan tetap
                // ada supaya staf cukup ketuk akun untuk masuk lagi.
                new Session(this).clear();
                Intent i = new Intent(this, LoginActivity.class);
                i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(i);
            });
        });
    }
}
