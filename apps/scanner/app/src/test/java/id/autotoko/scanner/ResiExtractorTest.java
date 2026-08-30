package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import static org.junit.Assert.assertNull;
import org.junit.Test;

/**
 * OCR itself cannot be exercised in a JVM test, so the parsing that turns its
 * output into a resi is the part that must be proven. The label texts below
 * are written the way real Indonesian courier labels come out of OCR:
 * spaced digit groups, a phone number sitting right next to the number we
 * actually want, and the odd stray word.
 */
public class ResiExtractorTest {

    private static String top(String text) {
        List<ResiExtractor.Candidate> c = ResiExtractor.extract(text);
        return c.isEmpty() ? null : c.get(0).value;
    }

    @Test public void normalizeMatchesTheServerRule() {
        assertEquals("JX1234567890", ResiExtractor.normalize("JX 1234-5678 90"));
        assertEquals("JX1234567890", ResiExtractor.normalize("jx1234567890"));
        assertEquals("", ResiExtractor.normalize(null));
    }

    @Test public void picksTheResiNotTheBuyersPhoneNumber() {
        String label =
            "J&T EXPRESS\n" +
            "No. Resi : JX 1234 5678 90\n" +
            "Penerima : Budi Santoso\n" +
            "Telp : 081234567890\n" +
            "Alamat : Jl. Merdeka No. 5, Jakarta 12345\n";
        assertEquals("JX1234567890", top(label));
    }

    @Test public void aPhoneNumberAloneIsNeverPromoted() {
        // No resi on this fragment at all — the phone must not be offered as
        // the best guess just because it is the only long number present.
        List<ResiExtractor.Candidate> c = ResiExtractor.extract("Telp 081234567890\n");
        if (!c.isEmpty()) {
            assertTrue("phone should score below a plain candidate", c.get(0).score < 10);
        }
        assertTrue(ResiExtractor.isPhoneLike("081234567890"));
        assertFalse(ResiExtractor.isPhoneLike("JX1234567890"));
    }

    @Test public void readsSpacedGroupsAsOneNumber() {
        assertEquals("SPXID043212345678", top("SPX Express\nSPXID 0432 1234 5678\n"));
    }

    @Test public void worksWithoutAnyKeywordOnTheLabel() {
        assertEquals("10000123456789", top("ANTERAJA\n10000123456789\nJakarta Selatan\n"));
    }

    @Test public void labelsTheCourier() {
        assertEquals("J&T", ResiExtractor.courierOf("JX1234567890"));
        assertEquals("SPX", ResiExtractor.courierOf("SPXID0432123456"));
        assertEquals("Ninja", ResiExtractor.courierOf("NLID12345678"));
        assertEquals(null, ResiExtractor.courierOf("ZZ99999999"));
    }

    @Test public void offersAlternativesRatherThanOneGuess() {
        String label =
            "No Resi JX1234567890\n" +
            "Order ID 887766554433\n" +
            "Telp 081298765432\n";
        List<ResiExtractor.Candidate> c = ResiExtractor.extract(label);
        assertEquals("JX1234567890", c.get(0).value);
        assertTrue("the packer needs something to fall back on", c.size() > 1);
    }

    @Test public void ignoresShortNumbersLikePostcodes() {
        assertEquals(null, top("Kode Pos 40123\nQty 2\n"));
    }

    @Test public void datesAreNotMistakenForWaybills() {
        assertTrue(ResiExtractor.looksLikeDate("20260803"));
        assertFalse(ResiExtractor.looksLikeDate("12345678"));
    }

    @Test public void emptyAndGarbageInputAreSafe() {
        assertTrue(ResiExtractor.extract("").isEmpty());
        assertTrue(ResiExtractor.extract(null).isEmpty());
        assertTrue(ResiExtractor.extract("!!! ??? ...").isEmpty());
    }

    // --- dari 312 scan sungguhan ---------------------------------------
    //
    //   282  JY1328393153     J&T (dikonfirmasi manusia 241 kali)
    //    17  CM67961230459    J&T 8x / JNE 6x -- ambigu
    //     3  JX8000643600     J&T
    //     1  MY1516662593     J&T
    //     9  260814B62PDTY8   NOMOR PESANAN, tersimpan di kolom resi

    @Test public void awalan_yang_benar_benar_dipakai_dikenali() {
        // Sebelum ini hanya JX yang dikenali -- 3 dari 312 scan.
        assertEquals("J&T", ResiExtractor.courierOf("JY1328393153"));
        assertEquals("J&T", ResiExtractor.courierOf("MY1516662593"));
        assertEquals("J&T", ResiExtractor.courierOf("JX8000643600"));
    }

    /**
     * CM muncul 17 kali dan manusia menyebutnya J&T delapan kali dan JNE enam
     * kali. Menebak salah satunya menuliskan kurir yang salah pada hampir
     * separuh paket; yang bisa dipastikan hanya bahwa ia nomor pengiriman.
     */
    @Test public void awalan_ambigu_diakui_bentuknya_tanpa_menebak_kurirnya() {
        assertNull(ResiExtractor.courierOf("CM67961230459"));
        assertTrue(ResiExtractor.berawalanResi("CM67961230459"));
    }

    @Test public void nomor_pesanan_bukan_awalan_resi() {
        assertFalse(ResiExtractor.berawalanResi("260814B62PDTY8"));
        assertFalse(ResiExtractor.berawalanResi("585527219881477623"));
    }

    @Test public void resi_terbaca_dari_tulisan_label_shopee() {
        // Dari tangkapan layar hasil tes: barcode-nya terlipat, tulisannya
        // terbaca jelas.
        String teks = "Shopee ECO\n"
                + "PDO-B-04    Resi: SPXID064183635268\n"
                + "BW-33\n"
                + "Penerima: Ziza\n"
                + "Pengirim: LKCARE Official Store\n"
                + "No.Pesanan: 260827EXWKKVDE\n";
        java.util.List<ResiExtractor.Candidate> c = ResiExtractor.extract(teks);
        assertFalse("tidak ada kandidat sama sekali", c.isEmpty());
        assertEquals("SPXID064183635268", c.get(0).value);
        assertEquals("SPX", c.get(0).courier);
    }

    @Test public void resi_jnt_terbaca_dari_tulisan() {
        String teks = "J&T EXPRESS\n"
                + "No. Resi : JY1328393153\n"
                + "Penerima: Budi   Telp 081234567890\n";
        java.util.List<ResiExtractor.Candidate> c = ResiExtractor.extract(teks);
        assertFalse(c.isEmpty());
        assertEquals("JY1328393153", c.get(0).value);
        assertEquals("J&T", c.get(0).courier);
    }

    /**
     * Nomor telepon pembeli selalu ada di label dan panjangnya mirip. Kalau ia
     * yang menang, setiap paket tercatat dengan resi yang salah -- dan karena
     * server menolak duplikat, nomor keliru itu membakar kunci yang mungkin
     * dibutuhkan paket yang benar nanti.
     */
    @Test public void nomor_telepon_tidak_pernah_menang_atas_resi() {
        String teks = "Penerima: Ziza\nTelp: 081234567890\nResi: JY1328393153\n";
        java.util.List<ResiExtractor.Candidate> c = ResiExtractor.extract(teks);
        assertEquals("JY1328393153", c.get(0).value);
    }
}
