package id.autotoko.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

/**
 * The collector runs for as long as a camera is pointed at something, which on
 * this screen can be the whole time a mapping sheet is open. What it must not
 * do is grow while it does that.
 */
public class TextCollectorTest {

    @Test
    public void a_line_seen_twice_is_kept_and_one_seen_once_is_not() {
        TextCollector c = new TextCollector();
        c.addFrame("Aquades Teknis 1 Liter");
        c.addFrame("Aquades Teknis 1 Liter");
        c.addFrame("bayangan acak di kardus");
        List<String> lines = c.lines();
        assertEquals(1, lines.size());
        assertTrue(lines.get(0).contains("Aquades"));
    }

    @Test
    public void keeps_lines_that_have_no_long_words() {
        // "100 ML" has no word of three letters. Without the fallback key every
        // reading of it was its own cluster and none ever reached the threshold.
        TextCollector c = new TextCollector();
        c.addFrame("100 ML");
        c.addFrame("100 ML");
        assertEquals(1, c.lines().size());
    }

    @Test
    public void does_not_grow_without_bound_while_the_camera_runs() {
        TextCollector c = new TextCollector();
        // Every frame a fresh misreading sharing NO words with the others. An
        // earlier version of this test reused a common phrase and the
        // clusterer, correctly, folded all five thousand into one line.
        for (int i = 0; i < 5000; i++) {
            c.addFrame("qwe" + i + " zxc" + i + " plm" + i + " ujm" + i);
        }
        assertEquals(5000, c.frames());
        // Nothing was seen twice, so nothing is reportable...
        assertTrue(c.lines().isEmpty());
        // ...and a real line read after all that noise still gets through.
        c.addFrame("Botol Spray Putih 100ml");
        c.addFrame("Botol Spray Putih 100ml");
        assertEquals(1, c.lines().size());
    }

    @Test
    public void reset_clears_everything() {
        TextCollector c = new TextCollector();
        c.addFrame("Lakban Coklat Besar");
        c.addFrame("Lakban Coklat Besar");
        c.reset();
        assertEquals(0, c.frames());
        assertTrue(c.lines().isEmpty());
    }

    @Test
    public void survives_junk_input() {
        TextCollector c = new TextCollector();
        c.addFrame(null);
        c.addFrame("   ");
        c.addFrame("123456");
        assertTrue(c.lines().isEmpty());
    }
}
