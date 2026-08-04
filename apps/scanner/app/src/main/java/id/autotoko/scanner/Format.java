package id.autotoko.scanner;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Turns the API's ISO timestamps into something a packer can read at a glance. */
public final class Format {

    private Format() {}

    public static Date parseIso(String iso) {
        if (iso == null || iso.isEmpty() || "null".equals(iso)) return null;
        String[] patterns = {
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'"
        };
        for (String p : patterns) {
            try {
                SimpleDateFormat f = new SimpleDateFormat(p, Locale.US);
                if (p.endsWith("'Z'")) f.setTimeZone(TimeZone.getTimeZone("UTC"));
                return f.parse(iso);
            } catch (Exception ignored) {}
        }
        return null;
    }

    /** "2 menit lalu" / "kemarin 14:05" / "3 Agu 14:05". */
    public static String humanTime(String iso) {
        Date d = parseIso(iso);
        if (d == null) return null;
        long diff = System.currentTimeMillis() - d.getTime();
        if (diff < 60_000) return "barusan";
        if (diff < 3_600_000) return (diff / 60_000) + " menit lalu";
        if (diff < 86_400_000) return (diff / 3_600_000) + " jam lalu";
        return new SimpleDateFormat("d MMM HH:mm", new Locale("id", "ID")).format(d);
    }

    public static String clock(String iso) {
        Date d = parseIso(iso);
        if (d == null) return "";
        return new SimpleDateFormat("d MMM HH:mm", new Locale("id", "ID")).format(d);
    }
}
