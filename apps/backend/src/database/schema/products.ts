import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  unique,
  date,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { shopCategories } from "./shops.js";
import { shops } from "./shops";
import {
  productStatusEnum,
  healthScoreEnum,
  postingStatusEnum,
  restockMethodEnum,
} from "./enums";

// PRD Bagian 6 — Master Produk = single source of truth, linked to marketplace
// postings via SKU.
export const masterProducts = pgTable(
  "master_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sku: varchar("sku", { length: 128 }).notNull(), // primary SKU — links to postings
    name: varchar("name", { length: 255 }).notNull(),
    /**
     * Which business this belongs to.
     *
     * A shop category is a brand in the seller's own words — renature sells
     * health and beauty, foodfarm sells food — and they do not share a
     * cupboard or a catalogue. Null means unassigned, and those still show in
     * the lists: something that vanishes because nobody categorised it is how
     * a filter becomes data loss.
     *
     * NOT the existing categoryId on masterProducts, which is an integer
     * marketplace taxonomy id from the posting flow with no foreign key here.
     */
    shopCategoryId: uuid("shop_category_id").references(() => shopCategories.id, {
      onDelete: "set null",
    }),
    /**
     * Other names this product is sold under, one per line.
     *
     * A shipping label carries the marketplace listing title, not this name,
     * and the scanner matches the two on shared words. Where the listing is
     * named something else entirely there are no shared words to find, and an
     * alias is the only thing that can bridge it.
     */
    marketplaceAliases: text("marketplace_aliases"),
    description: text("description"),
    categoryId: integer("category_id"),
    basePrice: numeric("base_price", { precision: 15, scale: 2 }),
    weightGram: integer("weight_gram"),
    images: jsonb("images").$type<string[]>().default([]),
    status: productStatusEnum("status").notNull().default("draft"),
    healthScore: healthScoreEnum("health_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userSkuUnique: unique("master_products_user_sku_unique").on(t.userId, t.sku),
    userIdx: index("master_products_user_idx").on(t.userId),
  }),
);

export const masterProductVariants = pgTable("master_product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  masterProductId: uuid("master_product_id")
    .notNull()
    .references(() => masterProducts.id, { onDelete: "cascade" }),
  sku: varchar("sku", { length: 128 }).notNull(), // e.g. BBP-001-RED-XL
  variantName: varchar("variant_name", { length: 255 }),
  price: numeric("price", { precision: 15, scale: 2 }),
  stock: integer("stock").notNull().default(0),
  images: jsonb("images").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


/**
 * Shared material catalog — ONE row per physical material per tenant.
 *
 * bom_items is keyed per product, so the same material used by two products
 * produced two rows each with their own currentStock. Buying stock then had no
 * correct answer: adding to both double-counts, adding to one leaves the other
 * stale. This table is the single source of truth for stock and cost; bom_items
 * keeps only the per-product recipe quantity (takaran).
 */
export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    // Lowercased/collapsed name used for matching OCR text and preventing
    // near-duplicates like "Biji Kopi " vs "biji kopi".
    normalizedName: varchar("normalized_name", { length: 255 }).notNull(),
    unit: varchar("unit", { length: 32 }),
    /**
     * Which business this belongs to.
     *
     * A shop category is a brand in the seller's own words — renature sells
     * health and beauty, foodfarm sells food — and they do not share a
     * cupboard or a catalogue. Null means unassigned, and those still show in
     * the lists: something that vanishes because nobody categorised it is how
     * a filter becomes data loss.
     *
     * NOT the existing categoryId on masterProducts, which is an integer
     * marketplace taxonomy id from the posting flow with no foreign key here.
     */
    shopCategoryId: uuid("shop_category_id").references(() => shopCategories.id, {
      onDelete: "set null",
    }),
    currentStock: numeric("current_stock", { precision: 14, scale: 3 }).notNull().default("0"),
    // Weighted-average cost, recomputed on every purchase so HPP reflects what
    // the stock on hand actually cost rather than only the latest price.
    unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull().default("0"),
    /**
     * When the price above last changed — not when the row did.
     *
     * updatedAt moves for a rename or a stock count as well, so it cannot
     * answer the question a seller actually asks of a costing sheet: is this
     * price still current? Null means never priced.
     */
    unitCostUpdatedAt: timestamp("unit_cost_updated_at", { withTimezone: true }),
    /**
     * What the shelf looks like: habis | hampir_habis | cukup | normal | banyak.
     *
     * Beside currentStock, not instead of it. That one is what the books say
     * and is only as good as the counting behind it; nobody weighs the
     * glycerine before packing. This is what somebody standing at the rack can
     * state without counting anything, which is why it is the reading that
     * actually gets kept up to date.
     */
    stockLevel: varchar("stock_level", { length: 16 }),
    stockLevelAt: timestamp("stock_level_at", { withTimezone: true }),
    minimumThreshold: numeric("minimum_threshold", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("materials_user_idx").on(t.userId),
    userNameUnique: unique("materials_user_normalized_unique").on(t.userId, t.normalizedName),
  }),
);

/** One recorded stock purchase (usually one uploaded receipt screenshot). */
export const materialPurchases = pgTable(
  "material_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purchasedAt: date("purchased_at").notNull(),
    supplierName: varchar("supplier_name", { length: 255 }),
    note: text("note"),
    /** The screenshot this was recapped from, kept as the audit trail. */
    receiptUrl: text("receipt_url"),
    /**
     * The marketplace order detail, as photographed or screenshotted.
     *
     * Separate from receiptUrl, which holds the parcel's label: one says what
     * arrived, the other what was ordered and for how much. A courier label
     * carries neither a quantity nor a price, which is why a delivery scanned
     * alone has no cost to record.
     */
    orderPhotoUrl: text("order_photo_url"),
    /** Waybill of the parcel that arrived, when this came from the scanner. */
    resi: varchar("resi", { length: 64 }),
    /** manual | delivery_scan */
    source: varchar("source", { length: 16 }).notNull().default("manual"),
    /** Paid to the courier on arrival. */
    isCod: boolean("is_cod").notNull().default(false),
    /**
     * What the courier was owed for the whole parcel.
     *
     * Deliberately not spread across the materials inside: no rule for that
     * split exists, and a wrong one quietly mis-states the HPP of everything
     * built from them. It reaches a line only when the parcel holds one
     * material, where it is exact rather than apportioned.
     */
    codAmount: numeric("cod_amount", { precision: 15, scale: 2 }),
    /** Raw OCR text + parsed candidates, for correcting the parser later. */
    ocrRawResult: jsonb("ocr_raw_result"),
    totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("material_purchases_user_idx").on(t.userId),
  }),
);

/**
 * A line on a purchase. Stock movements are derived from these rows, so a
 * mis-typed purchase can be traced and reversed rather than silently baked
 * into a running total.
 */
export const materialPurchaseItems = pgTable(
  "material_purchase_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => materialPurchases.id, { onDelete: "cascade" }),
    // Denormalised so the user_id-keyed RLS policy covers this table too —
    // same approach payout_disbursements already uses.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    /** In the MATERIAL's unit — qtyPcs x contentPerPcs. What stock moves by. */
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    /**
     * How the quantity was arrived at, kept in both halves.
     *
     * A delivery is counted in packages while the catalogue holds millilitres,
     * because that is what a recipe consumes. Storing only the product means a
     * mis-typed content size can never be found again, only its wrong total.
     */
    /**
     * What the supplier's resi called it, beside the material it was mapped to.
     *
     * The same arrangement resi_scan_items has: when a mapping turns out
     * wrong, the text the machine was looking at is the only way to see why —
     * and it is what the OCR memory learns from.
     */
    rawName: varchar("raw_name", { length: 255 }),
    qtyPcs: numeric("qty_pcs", { precision: 14, scale: 3 }),
    contentPerPcs: numeric("content_per_pcs", { precision: 14, scale: 3 }),
    /**
     * What the packer typed, before it was converted into the line above.
     *
     * contentPerPcs is in the material's unit because that is the only thing
     * stock can move by. But "1" against a catalogue in grams reads afterwards
     * as either a 1 gram sachet or a mis-entered 1 kg jug, and nobody can tell
     * which. Keeping the entry as made is what makes a wrong one findable.
     */
    enteredContent: numeric("entered_content", { precision: 14, scale: 3 }),
    enteredUnit: varchar("entered_unit", { length: 32 }),
    /**
     * Total paid for this line; unitCost is derived as total / quantity.
     *
     * NULL means nobody said — the person receiving a parcel at the door does
     * not know what it cost. That is not the same as zero, and the difference
     * matters: a zero would drag the weighted average down and quietly wreck
     * the HPP of every product using the material.
     */
    totalCost: numeric("total_cost", { precision: 15, scale: 2 }).default("0"),
    unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).default("0"),
    /** True when this line created the material rather than topping one up. */
    createdMaterial: boolean("created_material").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    purchaseIdx: index("material_purchase_items_purchase_idx").on(t.purchaseId),
    materialIdx: index("material_purchase_items_material_idx").on(t.materialId),
  }),
);

// PRD Bagian 8.6 — Bill of Materials with full restock config.
/**
 * Packing materials — box, tape, bubble wrap — consumed once per SHIPMENT and
 * shared by every product.
 *
 * Separate from bom_items, which is a per-product recipe. A packing list that
 * had to be copied onto every product would drift the moment one product was
 * edited and the others were not, and adding a new product would silently ship
 * with no packing cost at all.
 *
 * Quantity is per shipment (per resi), the same basis as
 * costing_settings.packing_cost_per_order, and the two ADD UP: this covers
 * what comes out of the material catalogue, that one covers everything else
 * (handling, labour). Neither replaces the other, so an existing tenant with
 * no packing materials sees no change to their HPP.
 */
export const packingMaterials = pgTable(
  "packing_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    /**
     * Starting amount for a product that has not set its own.
     *
     * The LIST of packing materials is shared by every product, but the AMOUNT
     * is not — a large item takes a bigger box and more tape than a small one.
     * So this is only a default, and product_packing_quantities below holds
     * what each product actually uses.
     */
    defaultQuantity: numeric("default_quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One line per material: two rows for "Kardus" would be an editing
    // mistake, never an intent, and would quietly double the cost.
    userMaterialUnique: unique("packing_materials_user_material_unique").on(
      t.userId,
      t.materialId,
    ),
    userIdx: index("packing_materials_user_idx").on(t.userId),
  }),
);

/**
 * What ONE product uses of a shared packing material.
 *
 * Absent means "use the default". Storing only the differences keeps adding a
 * packing material from having to write a row for every product that exists,
 * and keeps changing the default meaningful for the products that never
 * needed their own figure.
 */
export const productPackingQuantities = pgTable(
  "product_packing_quantities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    masterProductId: uuid("master_product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" }),
    packingMaterialId: uuid("packing_material_id")
      .notNull()
      .references(() => packingMaterials.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  },
  (t) => ({
    productMaterialUnique: unique("product_packing_qty_unique").on(
      t.masterProductId,
      t.packingMaterialId,
    ),
    productIdx: index("product_packing_qty_product_idx").on(t.masterProductId),
  }),
);

/**
 * Every change to a material's stock, signed, in the material's own unit.
 *
 * current_stock is a running total and a running total cannot be corrected.
 * A packer re-maps a wrongly matched product several times a shift, and each
 * time the shelf has to give back exactly what that line took — which is only
 * knowable if it was written down. The total is maintained beside the ledger
 * for speed; the ledger is what makes it auditable.
 */
export const materialMovements = pgTable(
  "material_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    /** Positive arrived, negative shipped. */
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    /** purchase | delivery | resi_scan | adjustment | reversal */
    reason: varchar("reason", { length: 24 }).notNull(),
    /** What caused it, so it can be found again and undone. */
    refTable: varchar("ref_table", { length: 32 }),
    refId: uuid("ref_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("material_movements_user_idx").on(t.userId),
    materialIdx: index("material_movements_material_idx").on(t.materialId, t.createdAt),
    refIdx: index("material_movements_ref_idx").on(t.refTable, t.refId),
  }),
);

// masterProducts gains the same brand column; see materials above for why it
// is not the existing categoryId, which is an integer marketplace taxonomy id.
export const bomItems = pgTable("bom_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  masterProductId: uuid("master_product_id")
    .notNull()
    .references(() => masterProducts.id, { onDelete: "cascade" }),
  // Links this recipe line to the shared material catalog, which owns the
  // STOCK and COST. Nullable so pre-catalog rows keep working; when set it
  // wins over the legacy per-row currentStock/unitCost below.
  materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
  materialName: varchar("material_name", { length: 255 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(), // per 1 product
  // Cost of ONE unit of this material, used to compute Harga Pokok Produksi.
  // Separate from restockPrice/restockQty below, which describe a supplier
  // purchase order rather than the costing basis.
  unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  unit: varchar("unit", { length: 32 }), // meter, gram, pcs
  currentStock: numeric("current_stock", { precision: 10, scale: 3 }).notNull().default("0"),
  minimumThreshold: numeric("minimum_threshold", { precision: 10, scale: 3 }).notNull().default("0"),
  restockMethod: restockMethodEnum("restock_method").notNull().default("wa_owner"),
  supplierName: varchar("supplier_name", { length: 255 }),
  supplierShopeeUrl: varchar("supplier_shopee_url", { length: 1000 }),
  supplierWaNumber: varchar("supplier_wa_number", { length: 32 }),
  supplierApiUrl: varchar("supplier_api_url", { length: 1000 }),
  supplierApiKey: text("supplier_api_key"), // encrypted
  restockQty: numeric("restock_qty", { precision: 10, scale: 3 }),
  restockPrice: numeric("restock_price", { precision: 15, scale: 2 }),
  paymentMethod: varchar("payment_method", { length: 32 }), // QRIS / COD / Transfer
  shippingAddress: text("shipping_address"),
  receiverName: varchar("receiver_name", { length: 255 }),
  receiverPhone: varchar("receiver_phone", { length: 32 }),
  notesForSupplier: text("notes_for_supplier"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// PRD Bagian 6 — postings (marketplace listings) linked to a master product.
export const productPostings = pgTable(
  "product_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    masterProductId: uuid("master_product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    marketplaceItemId: varchar("marketplace_item_id", { length: 128 }), // item_id / product_id
    marketplaceSku: varchar("marketplace_sku", { length: 128 }), // SKU used on the marketplace
    title: varchar("title", { length: 500 }),
    price: numeric("price", { precision: 15, scale: 2 }),
    stock: integer("stock"),
    status: postingStatusEnum("status").notNull().default("active"),
    views7d: integer("views_7d").notNull().default(0),
    sold7d: integer("sold_7d").notNull().default(0),
    gmv7d: numeric("gmv_7d", { precision: 15, scale: 2 }).notNull().default("0"),
    reviewScore: numeric("review_score", { precision: 3, scale: 2 }),
    reviewCount: integer("review_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    masterIdx: index("postings_master_idx").on(t.masterProductId),
    shopIdx: index("postings_shop_idx").on(t.shopId),
    // SKU matching is the heart of master<->posting linking (PRD Bagian 17.4)
    skuIdx: index("postings_mp_sku_idx").on(t.marketplaceSku),
  }),
);

// Harga Pokok Produksi + publish-price composition, one row per master
// product. Rates are stored per product (not read from payout settings) so a
// seller can model different marketplace/affiliator terms per item; the
// sedekah/reseller defaults mirror the tenant's payout settings for
// convenience but are independently editable.
export const productCosting = pgTable(
  "product_costing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    masterProductId: uuid("master_product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" })
      .unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Biaya jasa produksi per pcs, added on top of the material cost.
    serviceCostPerPcs: numeric("service_cost_per_pcs", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    // Packing/handling paid once per shipment (per resi). HPP is per product,
    // so this is divided by avgUnitsPerOrder to get the per-unit share.
    packingCostPerOrder: numeric("packing_cost_per_order", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    // Average units shipped per resi. 1 = every order ships a single unit.
    avgUnitsPerOrder: numeric("avg_units_per_order", { precision: 10, scale: 2 })
      .notNull()
      .default("1"),

    // The price listed on the marketplace. Null until the seller sets one.
    publishPrice: numeric("publish_price", { precision: 15, scale: 2 }),

    // Withheld by the marketplace, each as a share of the publish price.
    marketplaceFeeRate: numeric("marketplace_fee_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.1500"),
    eventRate: numeric("event_rate", { precision: 5, scale: 4 }).notNull().default("0.0500"),
    affiliatorRate: numeric("affiliator_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.0500"),

    // Borne by the seller, not withheld by the marketplace.
    adsRate: numeric("ads_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    adsFixedPerPcs: numeric("ads_fixed_per_pcs", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),

    // Applied when the seller withdraws the payout (mirrors the Pencairan module).
    sedekahRate: numeric("sedekah_rate", { precision: 5, scale: 4 }).notNull().default("0.0500"),
    resellerRate: numeric("reseller_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.2000"),

    // Used by the "hitung harga publish dari target" helper.
    targetProfitRate: numeric("target_profit_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.2000"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("product_costing_user_idx").on(t.userId),
  }),
);

/**
 * Kategori sebuah produk, boleh lebih dari satu.
 *
 * masterProducts.shopCategoryId tetap ada dan menjadi kategori UTAMA -- yang
 * pertama dari daftar ini. Penyaring lama di halaman produk dan di
 * shop-insights membaca kolom itu; membuangnya akan mengubah arti kueri yang
 * sudah berjalan, jadi yang ditambahkan adalah tabelnya, bukan penggantinya.
 */
export const masterProductCategories = pgTable(
  "master_product_categories",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => masterProducts.id, { onDelete: "cascade" }),
    shopCategoryId: uuid("shop_category_id")
      .notNull()
      .references(() => shopCategories.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.productId, t.shopCategoryId] }),
    userIdx: index("master_product_categories_user_idx").on(t.userId, t.shopCategoryId),
  }),
);
