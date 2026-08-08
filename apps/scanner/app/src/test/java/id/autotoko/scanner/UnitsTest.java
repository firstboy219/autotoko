package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

/**
 * The phone converts while the packer types, so this table is what stands
 * between "1 kg" on a jug and a shelf credited with one gram.
 */
public class UnitsTest {

    @Test
    public void the_case_this_was_built_for() {
        // Glycerine arrives as a 1 kg jug and a 5 kg jug. The catalogue holds
        // glycerine in gram. Six kilos should reach the shelf as 6000 gram.
        Double a = Units.convert(1, "kg", "gram");
        Double b = Units.convert(5, "kg", "gram");
        assertEquals(1000.0, a, 0.001);
        assertEquals(5000.0, b, 0.001);
        assertEquals(6000.0, a + b, 0.001);
    }

    @Test
    public void refuses_to_guess_across_kinds() {
        // There is a real bom_items row asking for glycerine in ml against a
        // catalogue in gram. Without a density the honest answer is no answer.
        assertNull(Units.convert(50, "ml", "gram"));
        assertNull(Units.convert(1, "kg", "pcs"));
    }

    @Test
    public void does_not_care_how_it_was_spelled() {
        assertEquals(2000.0, Units.convert(2, "KG", "Gram"), 0.001);
        assertEquals(2000.0, Units.convert(2, " Kilogram ", "gr"), 0.001);
        assertEquals(1000.0, Units.convert(1, "Lt", "ML"), 0.001);
    }

    @Test
    public void passes_through_when_there_is_nothing_to_convert_to() {
        // Materials exist with no unit recorded.
        assertEquals(7.0, Units.convert(7, "kg", null), 0.001);
        assertEquals(7.0, Units.convert(7, null, "gram"), 0.001);
        assertEquals(7.0, Units.convert(7, "pcs", "pcs"), 0.001);
    }

    @Test
    public void an_unknown_unit_is_still_usable_as_itself() {
        assertNull(Units.convert(1, "sachet", "gram"));
        assertEquals(3.0, Units.convert(3, "sachet", "sachet"), 0.001);
        assertEquals(List.of("sachet"), Units.compatible("sachet"));
    }

    @Test
    public void offers_the_catalogues_own_unit_first() {
        List<String> opts = Units.compatible("gram");
        assertEquals("gram", opts.get(0));
        assertTrue(opts.contains("kg"));
        assertTrue(!opts.contains("ml"));
    }

    @Test
    public void does_not_offer_to_turn_bottles_into_rolls() {
        assertEquals(List.of("botol"), Units.compatible("botol"));
    }

    @Test
    public void a_dozen_is_twelve() {
        assertEquals(24.0, Units.convert(2, "lusin", "pcs"), 0.001);
    }

    @Test
    public void spells_out_what_the_shelf_receives() {
        assertEquals("6.000 gram", Units.describe(6000.0, "gram"));
        assertEquals("2 pcs", Units.describe(2.0, "pcs"));
    }
}
