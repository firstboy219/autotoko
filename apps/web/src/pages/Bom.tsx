import { Layout } from "../components/Layout";
import { MaterialsCatalogCard } from "../components/MaterialsCatalog";
import { InlineAlert } from "../components/ui";

/**
 * The material catalogue, and nothing else.
 *
 * This page used to carry a second table underneath: one row per
 * product-and-material pair, with its own name, price and stock typed in by
 * hand. Two tables both called master data, and the lower one was the older
 * idea — it created a separate material for every product that used it, so a
 * price change had to be repeated once per product and was silently missed
 * wherever it was not. Eight recipe lines were still costing from those
 * private copies when it was removed.
 *
 * What lived there now lives where it belongs: a product's own recipe is on
 * that product's HPP page, and stock arrives through Pembelian Stok.
 */
export function Bom() {
  return (
    <Layout title="BOM / Bahan Baku">
      <MaterialsCatalogCard />

      <InlineAlert tone="info">
        Takaran tiap bahan untuk sebuah produk diatur di halaman{" "}
        <strong>HPP &amp; Harga Jual</strong> produk tersebut. Stok bertambah lewat{" "}
        <strong>Pembelian Stok</strong>. Harga di tabel ini dipakai bersama — mengubahnya
        langsung mengubah HPP semua produk yang memakai bahan itu.
      </InlineAlert>
    </Layout>
  );
}
