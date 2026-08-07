package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

/**
 * Cases taken from this seller's actual catalogue and actual labels, because
 * the pairs that matter are specific: "Cool Mint 100ml" against "Cool Mint
 * Spray 50ml" is not a hypothetical, it is two rows in their master data whose
 * names differ in the one place OCR is least reliable.
 */
public class ProductMatcherTest {

    /** The real catalogue, abbreviated to the products that can be confused. */
    private static List<ProductMatcher.Product> catalogue() {
        return new ArrayList<>(Arrays.asList(
                new ProductMatcher.Product("p-cm100", "Cool Mint 100ml", "CM100ML"),
                new ProductMatcher.Product("p-cm50", "Cool Mint Spray 50ml", "CM50ML"),
                new ProductMatcher.Product("p-swk", "Mouthspray Siwak 100ml", "SPSWK100ML"),
                new ProductMatcher.Product("p-swk50", "Siwak Spray 50ml", "SWKSPRY50ML"),
                new ProductMatcher.Product("p-inh-ppm", "Inhaler Regular Peppermint", "RegPPM"),
                new ProductMatcher.Product("p-ref-ppm", "Refill Peppermint", "RefillPPM"),
                new ProductMatcher.Product("p-inh-ng", "Inhaler Anti Ngantuk", "RegAntiNgantuk"),
                new ProductMatcher.Product("p-ref-ng", "Refill Anti Ngantuk", "RefillAntiNgntk"),
                new ProductMatcher.Product("p-mozzy", "Mozzy Gel", "Mozzy")));
    }

    /** A real Tokopedia line: listing title plus the SKU column beside it. */
    private static final String COOL_MINT_100 =
            "Renature - Cool Mint Mouthspray wangi 24jam hilangkan bau mulut spray "
                    + "perawatan penghilang untuk Cairan Penyegar   Life. 100ML";

    @Test
    public void picks_the_right_product_from_a_marketing_title() {
        ProductMatcher.Match m = ProductMatcher.best(COOL_MINT_100, catalogue());
        assertNotNull(m);
        assertEquals("p-cm100", m.product.id);
        assertTrue("harus cukup yakin, skor=" + m.score, m.confident);
    }

    @Test
    public void a_contradicting_size_rules_a_product_out_completely() {
        // The pair this rule exists for. Same words, different volume.
        List<ProductMatcher.Match> ranked = ProductMatcher.rank(COOL_MINT_100, catalogue(), 5);
        for (ProductMatcher.Match m : ranked) {
            assertFalse("50ml tidak boleh muncul untuk label 100ml", "p-cm50".equals(m.product.id));
        }
    }

    @Test
    public void the_50ml_listing_picks_the_50ml_product() {
        String line = "Renature - Cool Mint Mouthspray spray alami perawatan  Bold, 50ML";
        ProductMatcher.Match m = ProductMatcher.best(line, catalogue());
        assertNotNull(m);
        assertEquals("p-cm50", m.product.id);
    }

    @Test
    public void asks_rather_than_guesses_when_two_products_are_close() {
        // "Refill Peppermint" and "Inhaler Regular Peppermint" share their only
        // distinguishing word with the label; neither may be taken unattended.
        String line = "Renature Peppermint Inhaler Jack Heule Aromatherapy minyak angin "
                + "hidung tersumbat  Refill 5ml Peppermint";
        List<ProductMatcher.Match> ranked = ProductMatcher.rank(line, catalogue(), 5);
        assertTrue("harus ada kandidat", ranked.size() >= 2);
        assertFalse("tidak boleh diterima otomatis", ranked.get(0).confident);
    }

    @Test
    public void a_product_whose_words_are_absent_is_not_offered() {
        // Nothing in this catalogue is coffee. An empty answer is the right one.
        ProductMatcher.Match m = ProductMatcher.best("Kopi Arabika Gayo 200gr biji utuh", catalogue());
        assertNull("tidak ada produk yang cocok, jadi jangan menawarkan apa pun", m);
    }

    @Test
    public void one_shared_word_is_coincidence_not_a_match() {
        // "gel" alone must not carry Mozzy Gel.
        ProductMatcher.Match m = ProductMatcher.best("hand sanitizer gel antiseptik", catalogue());
        if (m != null) {
            assertFalse("skor kebetulan tidak boleh yakin", m.confident);
        }
    }

    @Test
    public void survives_junk_and_empty_input() {
        assertNull(ProductMatcher.best("", catalogue()));
        assertNull(ProductMatcher.best("!!! ??? ...", catalogue()));
        assertNull(ProductMatcher.best(COOL_MINT_100, new ArrayList<>()));
        assertNull(ProductMatcher.best(null, catalogue()));
    }

    @Test
    public void sizes_are_normalised_however_they_are_printed() {
        assertTrue(ProductMatcher.sizesOf("isi 100 ML").contains("100ml"));
        assertTrue(ProductMatcher.sizesOf("100ml").contains("100ml"));
        assertTrue(ProductMatcher.sizesOf("berat 200 gram").contains("200gr"));
    }

    @Test
    public void marketing_padding_does_not_lift_every_score_equally() {
        // READY STOCK / FREE / PROMO appear on most listings; if they counted,
        // the gap between the right product and the wrong one would shrink.
        assertFalse(ProductMatcher.tokensOf("READY STOCK FREE PROMO").contains("ready"));
        assertFalse(ProductMatcher.tokensOf("READY STOCK FREE PROMO").contains("promo"));
    }
}
