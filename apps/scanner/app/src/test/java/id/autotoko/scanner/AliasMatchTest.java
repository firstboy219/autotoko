package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

/**
 * Matching on the name the marketplace prints, not the one the seller uses.
 *
 * A listing title is written to be found by shoppers — "Mouthspray Siwak
 * Original 100ml Penyegar Nafas Halal" — and the label carries that, not
 * "Mouthspray Siwak 100ml". Without aliases the matcher is comparing against a
 * name that was never printed.
 *
 * Worth saying plainly: at the time of writing not one of the 31 products has
 * an alias filled in, so this changes nothing until they are. It is the single
 * cheapest thing the seller can do to make the guessing work.
 */
public class AliasMatchTest {

    private static List<ProductMatcher.Product> catalogue() {
        return new ArrayList<>(Arrays.asList(
                new ProductMatcher.Product("p1", "Mouthspray Siwak 100ml", "",
                        "Siwak Spray Penyegar Nafas Herbal 100ml"),
                new ProductMatcher.Product("p2", "Cool Mint 100ml", "",
                        "Coolmint Freshener Spray"),
                new ProductMatcher.Product("p3", "Inhaler Duo", "", ""),
                new ProductMatcher.Product("p4", "Kopi Robusta 500gr", "", "")));
    }

    @Test
    public void finds_a_product_by_its_listing_title() {
        // The label prints the marketplace title; the internal name appears
        // nowhere on it.
        FuzzyMatch.Scored s = FuzzyMatch.best(
                "Nama Produk: Penyegar Nafas Herbal 100ml qty 1", catalogue());
        assertNotNull(s);
        assertEquals("Mouthspray Siwak 100ml", s.product.name);
    }

    @Test
    public void the_internal_name_still_works() {
        FuzzyMatch.Scored s = FuzzyMatch.best("Mouthspray Siwak 100ml", catalogue());
        assertNotNull(s);
        assertEquals("Mouthspray Siwak 100ml", s.product.name);
    }

    @Test
    public void an_alias_survives_the_usual_ocr_damage() {
        // "Freshener" read with the r lost and the e doubled.
        FuzzyMatch.Scored s = FuzzyMatch.best("Coolmint Fresheneer Spray", catalogue());
        assertNotNull(s);
        assertEquals("Cool Mint 100ml", s.product.name);
    }

    @Test
    public void closest_always_answers_even_with_nothing_to_go_on() {
        // What "jangan sampai tidak tertebak" means in code: a weak answer
        // rather than none. The caller marks it, and best() still declines.
        FuzzyMatch.Scored weak = FuzzyMatch.closest("zzzz qqqq", catalogue());
        assertNotNull(weak);
        assertTrue("harus ditandai lemah", !FuzzyMatch.isConfident(weak.score));
    }

    @Test
    public void closest_gives_nothing_only_when_the_catalogue_is_empty() {
        assertEquals(null, FuzzyMatch.closest("apa saja", new ArrayList<>()));
    }
}
