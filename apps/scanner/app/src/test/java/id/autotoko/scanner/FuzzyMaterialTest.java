package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

/**
 * The same matcher against the raw-material catalogue.
 *
 * The delivery case is harder than the packing one and the tests say so: a
 * supplier's courier label mostly does not name what is inside. Both readings
 * below are verbatim from material_purchases.ocr_raw_result.
 */
public class FuzzyMaterialTest {

    /** The tenant's real material catalogue, as at 9 Aug. */
    private static List<ProductMatcher.Product> materials() {
        String[] names = {
            "Aquades", "Biji Kopi Arabika", "Botol", "Daun Teh Hijau", "Flavor Mint",
            "Glycerin", "Gula Aren", "Jojoba Oil", "Kardus Packing",
            "Kemasan Kraft 200gr", "Label Sticker", "Label Stiker",
            "Oil Black Pepper", "Oil Eucalyptus", "Oil Peppermint", "Oil Stress Away",
            "Oil Sweet Orange", "Shrink", "Shrink Wrap", "Siwak", "Stiker",
            "Tabung", "Tabung Inhaler Reguler", "Tali", "Tali Mini Leher",
            "Tali Reguler Leher",
        };
        List<ProductMatcher.Product> out = new ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            out.add(new ProductMatcher.Product("m" + i, names[i], ""));
        }
        return out;
    }

    /** Verbatim from a real delivery scan. */
    private static final String REAL_DELIVERY =
            "KOTA JAKARTA TIAIUR, 111 WAIB vIDEO UNBOXING 11, JATINEGARA, "
          + "No. Pesanan: 260808SCXTYSF1, Berat: 1500 gr COD: Rp0, "
          + "Master bubble, Pengirim:, AA Produk, Instant";

    @Test
    public void says_nothing_when_the_label_names_nothing() {
        // The honest outcome for most incoming parcels: the courier label
        // carries an address and a warning about filming the unboxing, and no
        // material name at all. Proposing something here would be inventing it.
        assertNull(FuzzyMatch.best(REAL_DELIVERY, materials()));
    }

    @Test
    public void says_nothing_for_a_label_with_only_a_bay_number() {
        assertNull(FuzzyMatch.best("A-319, WAJIB VIDEO, UNBOXING", materials()));
    }

    @Test
    public void finds_a_material_through_the_usual_damage() {
        // "Jojoba Oil" as these photos render it: a j read as an i, an l as I.
        FuzzyMatch.Scored s = FuzzyMatch.best("Isi: Joioba OIl 100ml", materials());
        assertNotNull(s);
        assertEquals("Jojoba Oil", s.product.name);
    }

    @Test
    public void declines_when_the_line_names_two_materials_it_holds() {
        // "Joioba OIl 100ml botol" names Jojoba Oil AND Botol, both in the
        // catalogue, both a full match. One row cannot be both, and choosing
        // would be a coin toss — so the row opens unset and the packer says.
        assertNull(FuzzyMatch.best("Isi: Joioba OIl 100ml botol", materials()));
    }

    @Test
    public void declines_between_near_identical_catalogue_entries() {
        // This catalogue holds "Label Sticker", "Label Stiker" and "Stiker" as
        // three separate rows. Nothing can tell them apart from a photograph,
        // and picking one would be a coin toss recorded as a fact.
        assertNull(FuzzyMatch.best("Label Stiker", materials()));
    }

    @Test
    public void a_distinctive_name_still_gets_through() {
        FuzzyMatch.Scored s = FuzzyMatch.best("2 pcs Kemasan Kraft 200gr", materials());
        assertNotNull(s);
        assertEquals("Kemasan Kraft 200gr", s.product.name);
    }
}
