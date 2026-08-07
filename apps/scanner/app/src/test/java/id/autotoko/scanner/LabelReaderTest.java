package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

/**
 * The claim being tested is the one the whole design rests on: several
 * imperfect readings of the same label reconstruct a correct one, and no
 * single frame had to be right.
 */
public class LabelReaderTest {

    private static final String TRUE_ORDER = "585358045683221740";

    @Test
    public void rebuilds_an_order_number_no_single_frame_got_right() {
        LabelReader r = new LabelReader();
        // Each frame has one digit wrong, in a different place. Majority per
        // position recovers the number none of them reported.
        r.addFrame("Order Id : 585358045683221741");
        r.addFrame("Order Id : 585358045683221740");
        r.addFrame("Order Id : 585358045683221740");
        r.addFrame("Order Id : 985358045683221740");
        assertEquals(TRUE_ORDER, r.orderNo());
    }

    @Test
    public void reads_the_number_without_its_label_too() {
        LabelReader r = new LabelReader();
        r.addFrame("tokopedia Shop\n585358045683221740\nPackage ID 1205938906612515436");
        r.addFrame("tokopedia Shop\n585358045683221740\nPackage ID 1205938906612515436");
        assertEquals(TRUE_ORDER, r.orderNo());
    }

    @Test
    public void spaces_inside_the_number_do_not_break_it() {
        LabelReader r = new LabelReader();
        r.addFrame("Order Id : 58535804 5683221740");
        r.addFrame("Order Id : 585358045683221740");
        assertEquals(TRUE_ORDER, r.orderNo());
    }

    @Test
    public void one_sighting_is_not_a_reading() {
        LabelReader r = new LabelReader();
        r.addFrame("Order Id : 585358045683221740");
        assertNull("satu frame saja belum cukup untuk dipercaya", r.orderNo());
    }

    @Test
    public void refuses_when_the_frames_never_saw_a_number() {
        LabelReader r = new LabelReader();
        r.addFrame("bos IT] sdr Mb Ba\nPengirim sda Ai RTHANTRIK");
        r.addFrame("iy bo | histor 1d AANG A11 ness)");
        assertNull(r.orderNo());
    }

    @Test
    public void the_same_title_spelled_differently_is_one_line() {
        LabelReader r = new LabelReader();
        r.addFrame("Renature - Cool Mint Mouthspray wangi 24jam hilangkan bau mulut");
        r.addFrame("Renature - Cool Mint Mouthsprav wangi 24iam hilangkan bau mulut spray");
        r.addFrame("Renatura - Cool Mint Mouthspray wangi 24jam hilangkan bau mulut");
        List<LabelReader.Line> lines = r.productLines();
        assertEquals("tiga ejaan yang sama harus jadi satu baris", 1, lines.size());
        assertEquals(3, lines.get(0).sightings);
        assertTrue("ejaan terpanjang yang disimpan", lines.get(0).text.contains("spray"));
    }

    @Test
    public void a_line_seen_once_is_dropped_as_noise() {
        LabelReader r = new LabelReader();
        r.addFrame("Renature Cool Mint Mouthspray wangi hilangkan bau mulut");
        r.addFrame("Renature Cool Mint Mouthspray wangi hilangkan bau mulut");
        r.addFrame("sampah acak dari tekstur kardus yang terbaca sekali saja");
        List<LabelReader.Line> lines = r.productLines();
        assertEquals(1, lines.size());
    }

    @Test
    public void the_labels_own_furniture_is_not_a_product() {
        LabelReader r = new LabelReader();
        for (int i = 0; i < 3; i++) {
            r.addFrame("Product Name          SKU        Seller SKU     Qty\n"
                    + "Penerima : Budi Santoso pelanggan setia\n"
                    + "Jl. Anak Air No.60 Kelurahan Pulai Anak Air Kecamatan\n"
                    + "Package ID: 1205938906612515436\n"
                    + "Renature Cool Mint Mouthspray wangi hilangkan bau mulut");
        }
        List<LabelReader.Line> lines = r.productLines();
        assertEquals("hanya judul produknya yang lolos", 1, lines.size());
        assertTrue(lines.get(0).text.contains("Cool Mint"));
    }

    @Test
    public void counts_frames_and_keeps_the_fullest_one() {
        LabelReader r = new LabelReader();
        r.addFrame("pendek");
        r.addFrame("jauh lebih panjang dan lengkap isinya daripada yang tadi");
        assertEquals(2, r.frames());
        assertTrue(r.rawText().startsWith("jauh lebih panjang"));
    }

    /**
     * Read off a real parcel by the scanner, misspellings and all. Kept exactly
     * as it came back so the tests fail the way the warehouse does.
     */
    private static final String SHOPEE_TEXT = String.join("\n",
            "S Shopee",
            "Resi:SPXIDO62006572945",
            "Pengirim: Bulanja.com",
            "Penerima: Erma",
            "COD Cek Dulu: Tidak",
            "Berat: 20 gr",
            "No.Pesanan:",
            "260504GDA9EMG5",
            "Variasi",
            "SKU",
            "Nama Produk",
            "Perghilang Bau",
            "Kaki Cooling Foot Spray",
            "Deodorant Kaki FOOT SPRAY",
            "PENGHILANG BAU KAKI BY",
            "PHARMACIE ORGANICO");

    @Test
    public void reads_a_shopee_order_number_from_the_line_below_its_label() {
        LabelReader r = new LabelReader();
        r.addFrame(SHOPEE_TEXT);
        r.addFrame(SHOPEE_TEXT);
        // Letters and digits, and printed under "No.Pesanan:" rather than
        // beside it. A digits-only same-line reader found nothing here.
        assertEquals("260504GDA9EMG5", r.orderNo());
    }

    @Test
    public void votes_across_letters_too() {
        LabelReader r = new LabelReader();
        r.addFrame("No.Pesanan:\n260504GDA9EMG5");
        r.addFrame("No.Pesanan:\n260504G0A9EMGS");
        r.addFrame("No.Pesanan:\n260504GDA9EMG5");
        assertEquals("260504GDA9EMG5", r.orderNo());
    }

    @Test
    public void does_not_mistake_the_waybill_for_the_order_number() {
        LabelReader r = new LabelReader();
        r.addFrame(SHOPEE_TEXT);
        r.addFrame(SHOPEE_TEXT);
        assertNotEquals("SPXIDO62006572945", r.orderNo());
    }

    @Test
    public void keeps_product_lines_in_reading_order() {
        LabelReader r = new LabelReader();
        r.addFrame(SHOPEE_TEXT);
        r.addFrame(SHOPEE_TEXT);
        List<LabelReader.Line> lines = r.productLines();
        // One product's name, split across consecutive lines. Whoever matches
        // these has to be able to try neighbours together, which is only
        // possible while they are still adjacent.
        int first = -1, last = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).text.contains("Perghilang")) first = i;
            if (lines.get(i).text.contains("PHARMACIE")) last = i;
        }
        assertTrue("kedua baris harus ada", first >= 0 && last >= 0);
        assertTrue("urutannya harus terjaga", last > first);
    }

    @Test
    public void survives_empty_input() {
        LabelReader r = new LabelReader();
        r.addFrame(null);
        r.addFrame("   ");
        assertEquals(0, r.frames());
        assertNull(r.orderNo());
        assertTrue(r.productLines().isEmpty());
    }
}
