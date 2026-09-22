package id.autotoko.scanner;

import android.content.Context;
import android.provider.Settings;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Enkripsi ringan untuk menyimpan password akun DI PERANGKAT SENDIRI, demi
 * fitur "ingat akun" (staf gudang tak perlu ketik ulang tiap sesi habis).
 *
 * Kunci diturunkan dari ANDROID_ID perangkat + salt aplikasi (tidak disimpan
 * di prefs), jadi dump SharedPreferences yang bocor tidak langsung terbaca.
 * Ini AES/GCM di dalam sandbox app (MODE_PRIVATE) -- setara level proteksi
 * token bearer yang sudah lama disimpan app ini, bukan Keystore perangkat
 * keras. Proporsional untuk HP milik toko.
 */
final class Secret {
    private Secret() {}
    private static final String SALT = "atk#scanner#cred#v1";
    private static final int IV = 12;

    private static SecretKeySpec key(Context ctx) throws Exception {
        String id = null;
        try {
            id = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
        } catch (Exception ignored) {}
        if (id == null) id = "";
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] k = md.digest((SALT + "|" + id).getBytes(StandardCharsets.UTF_8));
        return new SecretKeySpec(k, "AES");
    }

    static String enc(Context ctx, String plain) {
        if (plain == null) return null;
        try {
            byte[] iv = new byte[IV];
            new SecureRandom().nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key(ctx), new GCMParameterSpec(128, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return Base64.encodeToString(out, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    static String dec(Context ctx, String blob) {
        if (blob == null || blob.isEmpty()) return null;
        try {
            byte[] all = Base64.decode(blob, Base64.NO_WRAP);
            if (all.length <= IV) return null;
            byte[] iv = new byte[IV];
            System.arraycopy(all, 0, iv, 0, IV);
            byte[] ct = new byte[all.length - IV];
            System.arraycopy(all, IV, ct, 0, ct.length);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(ctx), new GCMParameterSpec(128, iv));
            return new String(c.doFinal(ct), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
