package id.autotoko.scanner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Siapa yang sedang masuk di HP ini, dan boleh membuka apa.
 *
 * Disimpan di memori proses, bukan di Session: izin bisa dicabut kapan saja
 * dari web, dan nilai yang tersimpan di disk akan bertahan melewati pencabutan
 * itu. Yang menegakkan aturannya tetap server -- ini hanya supaya menu tidak
 * menampilkan pintu yang pasti tertutup.
 *
 * Sebelum termuat, boleh() menjawab true. Menu yang berkedip hilang lalu
 * muncul lagi lebih mengganggu daripada satu baris yang sesaat terlihat, dan
 * servernya tetap menolak.
 */
final class Access {

    private Access() {}

    private static volatile boolean termuat = false;
    private static volatile boolean pemilik = true;
    private static volatile Set<String> izin = Collections.emptySet();
    private static volatile String nama = null;

    static boolean termuat() { return termuat; }
    static boolean pemilik() { return pemilik; }
    static String nama() { return nama; }

    static boolean boleh(String kunci) {
        if (!termuat) return true;
        if (pemilik) return true;
        return izin.contains(kunci);
    }

    /** Dipanggil sekali dari layar beranda, setelah sesi dipastikan ada. */
    static void muat(Api api) {
        api.me(r -> {
            if (!r.ok() || r.data() == null) return;
            JSONObject d = r.data();
            pemilik = d.optBoolean("isOwner", true);
            nama = d.isNull("name") ? null : d.optString("name", null);
            Set<String> baru = new HashSet<>();
            JSONArray a = d.optJSONArray("permissions");
            for (int i = 0; a != null && i < a.length(); i++) baru.add(a.optString(i));
            izin = baru;
            termuat = true;
        });
    }

    /** Keluar dari aplikasi harus melupakan izin akun sebelumnya. */
    static void lupakan() {
        termuat = false;
        pemilik = true;
        izin = Collections.emptySet();
        nama = null;
    }
}
