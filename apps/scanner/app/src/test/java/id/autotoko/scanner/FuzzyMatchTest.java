package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

/**
 * Driven by text copied out of the database, not invented for the test.
 *
 * Both blocks below are what the phone actually read off a parcel on 9 Aug. The
 * previous matcher scored zero on both, which is why the contents sheet had
 * been opening empty since it was built.
 */
public class FuzzyMatchTest {

    /** The tenant's real catalogue, as at 9 Aug. */
    private static List<ProductMatcher.Product> catalogue() {
        String[] names = {
            "Cool Mint 100ml", "Cool Mint Spray 50ml", "Inhaler Anti Ngantuk",
            "Inhaler Anxiety", "Inhaler Citrus", "Inhaler DeepSleep",
            "Inhaler Depresi", "Inhaler Duo", "Inhaler Minimalis Peppermint",
            "Inhaler Regular Peppermint", "Inhaler Regular Rokok",
            "Inhaler Vertigo Sakit Kepala", "Mouthspray Siwak 100ml",
            "Kopi Arabika Premium 200gr", "Kopi Robusta 500gr",
        };
        List<ProductMatcher.Product> out = new ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            out.add(new ProductMatcher.Product("id" + i, names[i], ""));
        }
        return out;
    }

    /** Verbatim from resi_scans.device_text for JY1317198848. */
    private static final String REAL_TOKOPEDIA =
            "EZ\nJ&Twess\nPeeg ulk\n2Nesteeg\nJatipiring Kel., Jalan Kh Zainal Arifin\n"
          + "COD\nltab p hata ng L, l00\nJALAN KH ZAINAL ARIFIN\n390-SMB11B-0IB\n"
          + "JY1317198848\nOrder 14 1 5854712653|70950o4\nSeller SKU\nSKU\n"
          + "Prudset Nerne\n100ML\nReralus Swak Spey Mih\nQly Tata1\nShop\ntokopedia";

    @Test
    public void finds_the_siwak_spray_in_a_badly_read_label() {
        FuzzyMatch.Scored s = FuzzyMatch.best(REAL_TOKOPEDIA, catalogue());
        assertNotNull("tidak ada yang cocok sama sekali", s);
        assertEquals("Mouthspray Siwak 100ml", s.product.name);
    }

    @Test
    public void a_dropped_letter_still_counts_as_the_word() {
        // "Siwak" came back as "Swak"; "100ml" survived because digits do.
        assertTrue(FuzzyMatch.similarity("siwak", "swak") >= 0.72);
        assertEquals(1.0, FuzzyMatch.similarity("100ml", "100ml"), 0.0001);
    }

    @Test
    public void the_old_rule_of_every_word_intact_would_have_failed_here() {
        // The reason this class exists: not one whole word of the product name
        // survived except the size.
        List<String> hay = FuzzyMatch.tokens(REAL_TOKOPEDIA);
        assertTrue(!hay.contains("siwak"));
        assertTrue(!hay.contains("mouthspray"));
        assertTrue(hay.contains("100ml"));
    }

    @Test
    public void refuses_when_two_products_fit_equally_well() {
        // "Inhaler ... Peppermint" matches two catalogue entries on two words
        // of three. A confident wrong answer is the failure this screen exists
        // to avoid, so it declines instead.
        assertNull(FuzzyMatch.best("Inhaler Peppermint", catalogue()));
    }

    @Test
    public void says_nothing_about_an_address() {
        assertNull(FuzzyMatch.best(
                "JALAN KH ZAINAL ARIFIN Jatipiring Kel. rumah desa dusun gang mawar",
                catalogue()));
    }

    @Test
    public void survives_empty_and_junk_input() {
        assertNull(FuzzyMatch.best(null, catalogue()));
        assertNull(FuzzyMatch.best("", catalogue()));
        assertNull(FuzzyMatch.best("xx yy zz", catalogue()));
        assertNull(FuzzyMatch.best(REAL_TOKOPEDIA, new ArrayList<>()));
    }
}
