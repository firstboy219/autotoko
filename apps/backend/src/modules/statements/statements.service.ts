import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  marketplaceSkuMap,
  marketplaceStatementLines,
  marketplaceStatements,
  masterProducts,
  payoutMutations,
  resiScans,
  shops,
} from "../../database/schema/index.js";
import { normaliseOrderId } from "../resi/order-id.js";
import { uraiLaporanTiktok } from "./tiktok-statement.js";

import { biayaPerPesanan, cukupUntukDisarankan, ringkasBiaya } from "./biaya-marketplace.js";
/**
 * Laporan marketplace, dan pembandingannya dengan catatan manual.
 *
 * Inti gagasannya: apa yang dikatakan marketplace disimpan APA ADANYA dan
 * tidak pernah menyentuh payout_mutations. Yang dibandingkan belakangan adalah
 * keduanya. Manual tetap jadi sumber yang dipakai menghitung uang; laporan
 * marketplace jadi alat memeriksanya.
 *
 * Urutannya sengaja begitu, bukan sebaliknya. Yang direkam manusia sudah
 * melewati mata seseorang yang memegang struk; yang datang dari mesin belum.
 * Ketika keduanya berbeda, yang perlu dijawab adalah "kenapa berbeda", dan itu
 * hanya bisa dijawab kalau kedua angka masih utuh masing-masing.
 */
@Injectable()
export class StatementsService {
  private readonly logger = new Logger(StatementsService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /* ------------------------------------------------------------- impor */

  async import(
    userId: string,
    input: { fileBase64?: string; fileName?: string; shopId?: string | null },
  ) {
    if (!input.fileBase64) throw new BadRequestException("Berkas laporan belum dilampirkan.");

    let buf: Buffer;
    try {
      buf = Buffer.from(input.fileBase64.replace(/^data:[^,]*,/, ""), "base64");
    } catch {
      throw new BadRequestException("Berkas tidak terbaca.");
    }
    if (buf.length < 100) throw new BadRequestException("Berkas kosong atau rusak.");
    if (buf.length > 25 * 1024 * 1024) {
      throw new BadRequestException("Berkas lebih dari 25 MB.");
    }

    const hash = createHash("sha256").update(buf).digest("hex");
    const [kembar] = await this.db
      .select({ id: marketplaceStatements.id, fileName: marketplaceStatements.fileName })
      .from(marketplaceStatements)
      .where(
        and(eq(marketplaceStatements.userId, userId), eq(marketplaceStatements.fileHash, hash)),
      )
      .limit(1);
    if (kembar) {
      // Isi berkasnya, bukan namanya: laporan yang sama diunduh ulang mendapat
      // nama berbeda, dan mengimpornya dua kali melipatgandakan barisnya.
      throw new ConflictException(
        `Laporan ini sudah pernah diimpor (${kembar.fileName ?? "tanpa nama"}).`,
      );
    }

    const urai = uraiLaporanTiktok(buf);
    if (!urai.lines.length) {
      throw new BadRequestException("Tidak ada satu pun baris penarikan di laporan ini.");
    }

    let shopId = input.shopId ?? null;
    if (shopId) {
      const [toko] = await this.db
        .select({ id: shops.id })
        .from(shops)
        .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
        .limit(1);
      if (!toko) throw new NotFoundException("Toko tidak ditemukan.");
    }

    const [statement] = await this.db
      .insert(marketplaceStatements)
      .values({
        userId,
        shopId,
        marketplace: urai.marketplace,
        source: "report_import",
        periodFrom: urai.periodFrom,
        periodTo: urai.periodTo,
        currency: urai.currency,
        fileName: input.fileName ?? null,
        fileHash: hash,
        settlementAmount: urai.settlementAmount?.toString() ?? null,
        totalIncome: urai.totalIncome?.toString() ?? null,
        totalFees: urai.totalFees?.toString() ?? null,
        rawSummary: urai.rawSummary,
      })
      .returning();
    // returning() bertipe array, jadi tsc benar menuntut ini diperiksa --
    // insert yang tidak mengembalikan baris berarti ada yang jauh lebih salah
    // daripada sekadar field kosong.
    if (!statement) throw new Error("Laporan gagal disimpan.");

    // Baris yang nomor referensinya sudah pernah masuk dilewati, bukan
    // digagalkan: dua laporan dengan periode yang tumpang tindih adalah hal
    // biasa, dan menolak seluruh berkas karena satu baris beririsan akan
    // membuat impor bulanan mustahil.
    // Disisipkan berkelompok: satu laporan bulanan toko yang ramai bisa
    // memuat ribuan pesanan, dan seribu perjalanan pulang-pergi ke database
    // membuat unggahan terasa menggantung.
    let masuk = 0;
    const KELOMPOK = 200;
    for (let i = 0; i < urai.lines.length; i += KELOMPOK) {
      const potongan = urai.lines.slice(i, i + KELOMPOK).map((l) => ({
        statementId: statement.id,
        userId,
        kind: l.kind,
        externalRef: l.externalRef,
        occurredOn: l.occurredOn,
        amount: l.amount.toString(),
        bankAccount: l.bankAccount,
        status: l.status,
        raw: l.raw,
      }));
      const hasil = await this.db
        .insert(marketplaceStatementLines)
        .values(potongan)
        .onConflictDoNothing()
        .returning({ id: marketplaceStatementLines.id });
      masuk += hasil.length;
    }
    const dilewati = urai.lines.length - masuk;

    this.logger.log(
      `Laporan ${urai.marketplace} diimpor untuk ${userId}: ${masuk} baris baru, ${dilewati} dilewati`,
    );
    return {
      id: statement.id,
      marketplace: statement.marketplace,
      periodFrom: statement.periodFrom,
      periodTo: statement.periodTo,
      linesImported: masuk,
      linesSkipped: dilewati,
      withdrawals: urai.lines.filter((l) => l.kind === "withdrawal").length,
      orders: urai.lines.filter((l) => l.kind === "order").length,
      summary: urai.rawSummary,
    };
  }

  async list(userId: string) {
    return this.db
      .select({
        id: marketplaceStatements.id,
        shopId: marketplaceStatements.shopId,
        marketplace: marketplaceStatements.marketplace,
        source: marketplaceStatements.source,
        periodFrom: marketplaceStatements.periodFrom,
        periodTo: marketplaceStatements.periodTo,
        fileName: marketplaceStatements.fileName,
        settlementAmount: marketplaceStatements.settlementAmount,
        importedAt: marketplaceStatements.importedAt,
        lines: sql<number>`(
          SELECT count(*)::int FROM marketplace_statement_lines l
           WHERE l.statement_id = ${marketplaceStatements.id}
        )`,
      })
      .from(marketplaceStatements)
      .where(eq(marketplaceStatements.userId, userId))
      .orderBy(desc(marketplaceStatements.importedAt));
  }

  async remove(userId: string, id: string) {
    const hapus = await this.db
      .delete(marketplaceStatements)
      .where(and(eq(marketplaceStatements.id, id), eq(marketplaceStatements.userId, userId)))
      .returning({ id: marketplaceStatements.id });
    if (!hapus.length) throw new NotFoundException("Laporan tidak ditemukan.");
    // Barisnya ikut terhapus lewat ON DELETE CASCADE. payout_mutations TIDAK
    // tersentuh -- itulah sebabnya tautannya sengaja tanpa foreign key.
    return { deleted: true };
  }

  /* ------------------------------------------------------ audit pesanan */

  /**
   * Pesanan yang sudah dipacking lawan pesanan yang sudah dicairkan.
   *
   * Pertanyaan yang dijawab: mana yang sudah diserahkan ke kurir tapi uangnya
   * belum masuk, dan sudah berapa lama menggantung. Scan resi packing berarti
   * picker sudah menyiapkan pesanan dan menyerahkannya ke kurir, jadi umur
   * dihitung dari saat itu -- bukan dari tanggal pesanan dibuat, yang tidak
   * mengatakan apa-apa tentang kewajiban marketplace.
   *
   * Kuncinya order id. Resi yang order id-nya tidak terbaca TIDAK dianggap
   * hilang -- ia dilaporkan terpisah sebagai "tidak bisa diaudit", karena
   * mencampurnya ke daftar "belum cair" akan menuduh marketplace atas
   * kegagalan OCR sendiri.
   */
  async auditOrders(
    userId: string,
    q: { shopId?: string; from: string; to: string },
  ) {
    const syaratScan = [
      eq(resiScans.userId, userId),
      gte(resiScans.scannedAt, new Date(q.from + "T00:00:00Z")),
      lte(resiScans.scannedAt, new Date(q.to + "T23:59:59Z")),
    ];
    if (q.shopId) syaratScan.push(eq(resiScans.shopId, q.shopId));

    const scans = await this.db
      .select({
        id: resiScans.id,
        resi: resiScans.resi,
        orderNo: resiScans.labelOrderNo,
        shopId: resiScans.shopId,
        scannedAt: resiScans.scannedAt,
      })
      .from(resiScans)
      .where(and(...syaratScan))
      .orderBy(asc(resiScans.scannedAt));

    const syaratOrder = [
      eq(marketplaceStatementLines.userId, userId),
      eq(marketplaceStatementLines.kind, "order"),
      // Disaring per tanggal seperti scan-nya. Tanpa ini, laporan yang
      // periodenya lebih panjang dari jendela audit menyumbang ratusan
      // "pesanan belum discan" dari bulan ketika memang belum ada yang discan.
      gte(marketplaceStatementLines.occurredOn, q.from),
      lte(marketplaceStatementLines.occurredOn, q.to),
    ];
    if (q.shopId) syaratOrder.push(eq(marketplaceStatements.shopId, q.shopId));

    const pesanan = await this.db
      .select({
        id: marketplaceStatementLines.id,
        externalRef: marketplaceStatementLines.externalRef,
        occurredOn: marketplaceStatementLines.occurredOn,
        amount: marketplaceStatementLines.amount,
        shopId: marketplaceStatements.shopId,
        // Kolom mentah laporan: di sinilah "Total Pendapatan" dan "Total
        // Biaya" tertulis, dan tanpa keduanya persentase potongan per pesanan
        // tidak bisa dihitung sama sekali.
        raw: marketplaceStatementLines.raw,
        marketplace: marketplaceStatements.marketplace,
        periodeDari: marketplaceStatements.periodFrom,
        periodeSampai: marketplaceStatements.periodTo,
      })
      .from(marketplaceStatementLines)
      .innerJoin(
        marketplaceStatements,
        eq(marketplaceStatements.id, marketplaceStatementLines.statementId),
      )
      .where(and(...syaratOrder));

    const perRef = new Map<string, (typeof pesanan)[number]>();
    for (const p of pesanan) if (p.externalRef) perRef.set(p.externalRef, p);

    const hariIni = Date.now();
    const umur = (d: Date) => Math.floor((hariIni - d.getTime()) / 86400000);

    const cocok: unknown[] = [];
    const belumCair: unknown[] = [];
    const tanpaOrderId: unknown[] = [];
    const terpakai = new Set<string>();

    for (const s of scans) {
      // Nilai tersimpan diperiksa ulang di sini, bukan dipercaya begitu saja.
      // Data lama memuat kode sortir dan nomor pengiriman di kolom ini, dan
      // memperlakukannya sebagai order id akan melaporkannya sebagai pesanan
      // yang belum dibayar -- kesalahan kita, dituduhkan ke marketplace.
      const orderNo = normaliseOrderId(s.orderNo);
      if (!orderNo) {
        tanpaOrderId.push({
          scanId: s.id,
          resi: s.resi,
          shopId: s.shopId,
          scannedAt: s.scannedAt,
          umurHari: umur(s.scannedAt),
          // Dibedakan supaya jelas mana yang labelnya tidak terbaca dan mana
          // yang terbaca tapi hasilnya mustahil -- dua masalah yang berbeda.
          tersimpanTapiTidakSah: s.orderNo ?? null,
        });
        continue;
      }
      const p = perRef.get(orderNo);
      if (p) {
        terpakai.add(orderNo);
        const cair = new Date(p.occurredOn + "T00:00:00Z").getTime();
        cocok.push({
          scanId: s.id,
          resi: s.resi,
          orderNo,
          scannedAt: s.scannedAt,
          tanggalCair: p.occurredOn,
          nominal: Number(p.amount) || 0,
          hariSampaiCair: Math.max(0, Math.round((cair - s.scannedAt.getTime()) / 86400000)),
        });
      } else {
        belumCair.push({
          scanId: s.id,
          resi: s.resi,
          orderNo,
          shopId: s.shopId,
          scannedAt: s.scannedAt,
          umurHari: umur(s.scannedAt),
        });
      }
    }

    // Sisi sebaliknya: marketplace membayar sesuatu yang tidak pernah discan.
    // Bisa berarti pesanan digital, bisa berarti paket yang lolos dari meja
    // packing -- dua-duanya perlu dilihat orang.
    const belumDiscan = pesanan
      .filter((p) => p.externalRef && !terpakai.has(p.externalRef))
      .map((p) => ({
        lineId: p.id,
        orderNo: p.externalRef,
        shopId: p.shopId,
        tanggalCair: p.occurredOn,
        nominal: Number(p.amount) || 0,
      }));

    const jumlahNominal = (xs: { nominal: number }[]) =>
      xs.reduce((a, b) => a + b.nominal, 0);

    const umurBelumCair = (belumCair as { umurHari: number }[]).map((x) => x.umurHari);

    // ------------------------------------------- produk di tiap pesanan
    //
    // Laporan menyebut isi pesanan sebagai ID SKU, bukan nama. Nama hanya bisa
    // muncul lewat peta yang dibuat penggunanya sendiri -- lihat detail-produk.ts
    // untuk alasan kenapa harga TIDAK dipakai untuk menebaknya.
    const marketplaces = [
      ...new Set(pesanan.map((p) => p.marketplace).filter((m): m is string => !!m)),
    ];
    const barisPeta = marketplaces.length
      ? await this.db
          .select({
            sku: marketplaceSkuMap.sku,
            produkId: marketplaceSkuMap.masterProductId,
            nama: masterProducts.name,
          })
          .from(marketplaceSkuMap)
          .innerJoin(masterProducts, eq(masterProducts.id, marketplaceSkuMap.masterProductId))
          .where(and(
            eq(marketplaceSkuMap.userId, userId),
            inArray(marketplaceSkuMap.marketplace, marketplaces),
          ))
      : [];
    const peta = new Map(
      barisPeta.map((r) => [r.sku, { id: r.produkId, nama: r.nama }] as const),
    );

    const katalog = await this.db
      .select({
        id: masterProducts.id,
        nama: masterProducts.name,
        sku: masterProducts.sku,
        hargaDasar: masterProducts.basePrice,
      })
      .from(masterProducts)
      .where(eq(masterProducts.userId, userId))
      .orderBy(asc(masterProducts.name));

    const biayaPesanan = biayaPerPesanan(
      pesanan.map((p) => ({
        raw: p.raw,
        namaToko: null,
        marketplace: p.marketplace ?? null,
        periodeDari: p.periodeDari ?? null,
        periodeSampai: p.periodeSampai ?? null,
      })),
      peta,
    );

    // Saran, bukan keputusan. Calon diurutkan dari yang harganya paling dekat
    // dengan harga jual yang teramati, dan yang persis sama ditandai -- tapi
    // tidak satu pun dipasang sendiri, karena satu harga di katalog ini
    // dipakai beberapa produk sekaligus dan tebakan yang keliru akan terbaca
    // sama meyakinkannya dengan yang benar.
    const skuBelumDipetakan = biayaPesanan.skuBelumDipetakan.map((s) => ({
      ...s,
      saran: s.hargaSatuan == null
        ? []
        : katalog
            .map((p) => ({
              id: p.id,
              nama: p.nama,
              hargaDasar: p.hargaDasar == null ? null : Number(p.hargaDasar),
            }))
            .filter((p) => p.hargaDasar != null)
            .map((p) => ({ ...p, selisih: Math.abs(p.hargaDasar! - s.hargaSatuan!) }))
            .sort((a, b) => a.selisih - b.selisih)
            .slice(0, 5)
            .map((p) => ({
              id: p.id,
              nama: p.nama,
              hargaDasar: p.hargaDasar,
              hargaSama: p.selisih < 1,
            })),
    }));

    return {
      range: { from: q.from, to: q.to },
      shopId: q.shopId ?? null,
      totals: {
        discan: scans.length,
        bisaDiaudit: scans.length - tanpaOrderId.length,
        cocok: cocok.length,
        belumCair: belumCair.length,
        belumDiscan: belumDiscan.length,
        tanpaOrderId: tanpaOrderId.length,
        nilaiCocok: jumlahNominal(cocok as { nominal: number }[]),
        nilaiBelumDiscan: jumlahNominal(belumDiscan),
        umurTertua: umurBelumCair.length ? Math.max(...umurBelumCair) : 0,
        umurRata: umurBelumCair.length
          ? Math.round((umurBelumCair.reduce((a, b) => a + b, 0) / umurBelumCair.length) * 10) / 10
          : 0,
      },
      // Tanpa laporan sama sekali, "semua belum cair" bukan temuan -- itu
      // hanya berarti belum ada yang diunggah.
      adaPembanding: pesanan.length > 0,
      /**
       * Berapa persen yang sebenarnya dipotong pada TIAP nomor pesanan.
       *
       * Halaman HPP bertanya "berapa biasanya dipotong"; menu audit bertanya
       * "pesanan MANA yang dipotong tidak seperti biasanya". Yang kedua itulah
       * yang bisa ditanyakan ke marketplace-nya satu per satu, dan itu
       * pekerjaan sebuah menu audit.
       */
      biayaPesanan: { ...biayaPesanan, skuBelumDipetakan },
      /** Untuk memilih produk saat memetakan SKU, tanpa panggilan terpisah. */
      produkKatalog: katalog.map((p) => ({
        id: p.id,
        nama: p.nama,
        sku: p.sku,
        hargaDasar: p.hargaDasar == null ? null : Number(p.hargaDasar),
      })),
      cocok,
      belumCair,
      belumDiscan,
      tanpaOrderId,
    };
  }

  /**
   * Menyimpan terjemahan satu ID SKU marketplace ke satu produk di katalog.
   *
   * Pemetaan ini keputusan manusia. Sistem hanya menyarankan calon berdasarkan
   * harga, dan harga saja tidak cukup membedakan produk di katalog nyata --
   * satu angka bisa dipakai tiga produk. Karena itu tidak ada jalur otomatis
   * ke fungsi ini: yang memutuskan selalu penggunanya.
   */
  async petakanSku(
    userId: string,
    b: { marketplace: string; sku: string; masterProductId: string | null },
  ) {
    const marketplace = (b.marketplace ?? "").trim();
    const sku = (b.sku ?? "").trim();
    if (!marketplace || !sku) {
      throw new BadRequestException("marketplace dan sku wajib diisi");
    }

    // Membatalkan pemetaan berarti kembali ke "belum dipetakan", bukan ke
    // sebuah nama kosong yang tetap terlihat seperti sudah dipetakan.
    if (!b.masterProductId) {
      await this.db
        .delete(marketplaceSkuMap)
        .where(and(
          eq(marketplaceSkuMap.userId, userId),
          eq(marketplaceSkuMap.marketplace, marketplace),
          eq(marketplaceSkuMap.sku, sku),
        ));
      return { sku, marketplace, masterProductId: null };
    }

    const [produk] = await this.db
      .select({ id: masterProducts.id })
      .from(masterProducts)
      .where(and(
        eq(masterProducts.id, b.masterProductId),
        // Diperiksa kepemilikannya di sini, bukan dipercaya dari badan
        // permintaan: tanpa ini sebuah SKU bisa dipetakan ke produk milik
        // tenant lain, dan namanya akan muncul di layar audit yang salah.
        eq(masterProducts.userId, userId),
      ))
      .limit(1);
    if (!produk) throw new NotFoundException("Produk tidak ditemukan");

    await this.db
      .insert(marketplaceSkuMap)
      .values({
        userId,
        marketplace,
        sku,
        masterProductId: produk.id,
        mappedBy: userId,
      })
      .onConflictDoUpdate({
        target: [marketplaceSkuMap.userId, marketplaceSkuMap.marketplace, marketplaceSkuMap.sku],
        set: { masterProductId: produk.id, mappedBy: userId, updatedAt: new Date() },
      });

    return { sku, marketplace, masterProductId: produk.id };
  }

  /* ------------------------------------------------------ rekonsiliasi */

  /**
   * Bandingkan pencairan yang direkam manual dengan penarikan yang dilaporkan
   * marketplace, pada satu toko dan satu rentang.
   *
   * Pencocokannya dua tahap dan sengaja tidak lebih pintar dari itu. Tahap
   * pertama: tanggal dan nominal sama persis. Tahap kedua: nominal sama, beda
   * tanggal paling banyak tiga hari -- selisih yang wajar antara "uang keluar
   * dari saldo" dan "uang sampai di rekening". Sisanya dibiarkan tidak cocok.
   *
   * Pencocokan yang lebih longgar akan menghasilkan lebih banyak "cocok" dan
   * lebih sedikit kebenaran: dua penarikan bernominal mirip di minggu yang
   * sama akan saling dipasangkan, dan justru selisih semacam itulah yang
   * seharusnya dilihat orang.
   */
  async reconcile(
    userId: string,
    q: { shopId?: string; from: string; to: string },
  ) {
    const syaratManual = [
      eq(payoutMutations.userId, userId),
      gte(payoutMutations.payoutDate, q.from),
      lte(payoutMutations.payoutDate, q.to),
    ];
    if (q.shopId) syaratManual.push(eq(payoutMutations.shopId, q.shopId));

    const manual = await this.db
      .select({
        id: payoutMutations.id,
        shopId: payoutMutations.shopId,
        payoutDate: payoutMutations.payoutDate,
        amount: payoutMutations.creditAmount,
        batchId: payoutMutations.batchId,
        dataSource: payoutMutations.dataSource,
      })
      .from(payoutMutations)
      .where(and(...syaratManual))
      .orderBy(asc(payoutMutations.payoutDate));

    const syaratLaporan = [
      eq(marketplaceStatementLines.userId, userId),
      eq(marketplaceStatementLines.kind, "withdrawal"),
      gte(marketplaceStatementLines.occurredOn, q.from),
      lte(marketplaceStatementLines.occurredOn, q.to),
    ];
    if (q.shopId) syaratLaporan.push(eq(marketplaceStatements.shopId, q.shopId));

    const laporan = await this.db
      .select({
        id: marketplaceStatementLines.id,
        occurredOn: marketplaceStatementLines.occurredOn,
        amount: marketplaceStatementLines.amount,
        externalRef: marketplaceStatementLines.externalRef,
        bankAccount: marketplaceStatementLines.bankAccount,
        shopId: marketplaceStatements.shopId,
        statementId: marketplaceStatements.id,
      })
      .from(marketplaceStatementLines)
      .innerJoin(
        marketplaceStatements,
        eq(marketplaceStatements.id, marketplaceStatementLines.statementId),
      )
      .where(and(...syaratLaporan))
      .orderBy(asc(marketplaceStatementLines.occurredOn));

    // Penarikan tercatat negatif di laporan (keluar dari saldo); yang
    // dibandingkan adalah besarnya.
    const sisaLaporan = laporan.map((l) => ({
      ...l,
      nominal: Math.abs(Number(l.amount) || 0),
      terpakai: false,
    }));
    const sisaManual = manual.map((m) => ({
      ...m,
      nominal: Number(m.amount) || 0,
      terpakai: false,
    }));

    const cocok: unknown[] = [];
    const bedaTanggal: unknown[] = [];

    const rupiahSama = (a: number, b: number) => Math.abs(a - b) < 1;
    const selisihHari = (a: string, b: string) =>
      Math.abs(
        (new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000,
      );

    for (const m of sisaManual) {
      const l = sisaLaporan.find(
        (x) => !x.terpakai && x.occurredOn === m.payoutDate && rupiahSama(x.nominal, m.nominal),
      );
      if (l) {
        l.terpakai = true;
        m.terpakai = true;
        cocok.push({
          manualId: m.id,
          lineId: l.id,
          tanggal: m.payoutDate,
          nominal: m.nominal,
          externalRef: l.externalRef,
        });
      }
    }

    for (const m of sisaManual.filter((x) => !x.terpakai)) {
      const l = sisaLaporan.find(
        (x) =>
          !x.terpakai &&
          rupiahSama(x.nominal, m.nominal) &&
          selisihHari(x.occurredOn, m.payoutDate) <= 3,
      );
      if (l) {
        l.terpakai = true;
        m.terpakai = true;
        bedaTanggal.push({
          manualId: m.id,
          lineId: l.id,
          tanggalManual: m.payoutDate,
          tanggalLaporan: l.occurredOn,
          nominal: m.nominal,
          externalRef: l.externalRef,
        });
      }
    }

    const hanyaManual = sisaManual
      .filter((m) => !m.terpakai)
      .map((m) => ({
        manualId: m.id,
        shopId: m.shopId,
        tanggal: m.payoutDate,
        nominal: m.nominal,
        batchId: m.batchId,
      }));
    const hanyaLaporan = sisaLaporan
      .filter((l) => !l.terpakai)
      .map((l) => ({
        lineId: l.id,
        shopId: l.shopId,
        tanggal: l.occurredOn,
        nominal: l.nominal,
        externalRef: l.externalRef,
        bankAccount: l.bankAccount,
      }));

    const jml = (xs: { nominal: number }[]) => xs.reduce((a, b) => a + b.nominal, 0);
    const totalManual = jml(sisaManual);
    const totalLaporan = jml(sisaLaporan);

    return {
      range: { from: q.from, to: q.to },
      shopId: q.shopId ?? null,
      totals: {
        manual: totalManual,
        marketplace: totalLaporan,
        selisih: totalManual - totalLaporan,
        manualRows: sisaManual.length,
        marketplaceRows: sisaLaporan.length,
      },
      cocok,
      bedaTanggal,
      hanyaManual,
      hanyaLaporan,
      // Tanpa laporan sama sekali, "tidak ada selisih" akan terbaca sebagai
      // lolos audit padahal tidak ada yang diaudit.
      adaPembanding: sisaLaporan.length > 0,
    };
  }

  /**
   * Berapa persen sebenarnya yang dipotong marketplace, per toko dan sumber.
   *
   * Dibaca dari laporan penyelesaian, bukan disimpulkan dari selisih apa pun:
   * tiap baris pesanan membawa "Total Pendapatan" dan "Total Biaya" yang
   * ditulis marketplace-nya sendiri.
   *
   * Dipakai halaman HPP untuk menyarankan angka pada kolom "Biaya
   * Marketplace", yang bawaannya 15% -- sementara yang benar-benar dipotong
   * pada data toko ini 42% untuk TikTok Shop dan 36% untuk Tokopedia.
   */
  async biayaMarketplace(userId: string) {
    const rows = await this.db.execute(sql`
      SELECT l.raw AS raw,
             COALESCE(sh.shop_name, sh.display_name) AS nama_toko,
             s.marketplace AS marketplace,
             s.period_from AS dari,
             s.period_to   AS sampai
        FROM marketplace_statement_lines l
        JOIN marketplace_statements s ON s.id = l.statement_id
        LEFT JOIN shops sh ON sh.id = s.shop_id
       WHERE l.user_id = ${userId} AND l.kind = 'order'
    `);
    const baris = (rows as unknown as Record<string, unknown>[]).map((r) => ({
      raw: r.raw,
      namaToko: (r.nama_toko as string) ?? null,
      marketplace: (r.marketplace as string) ?? null,
      periodeDari: (r.dari as string) ?? null,
      periodeSampai: (r.sampai as string) ?? null,
    }));
    const ringkas = ringkasBiaya(baris);
    return {
      // Yang layak dipakai langsung, dan yang datanya masih terlalu sedikit --
      // dipisah supaya layar tidak perlu tahu ambangnya.
      cukup: ringkas.filter(cukupUntukDisarankan),
      belumCukup: ringkas.filter((r) => !cukupUntukDisarankan(r)),
    };
  }
}
