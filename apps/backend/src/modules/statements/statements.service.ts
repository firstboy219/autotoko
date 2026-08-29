import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  marketplaceStatementLines,
  marketplaceStatements,
  payoutMutations,
  shops,
} from "../../database/schema/index.js";
import { uraiLaporanTiktok } from "./tiktok-statement.js";

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
    let masuk = 0;
    let dilewati = 0;
    for (const l of urai.lines) {
      const hasil = await this.db
        .insert(marketplaceStatementLines)
        .values({
          statementId: statement.id,
          userId,
          kind: l.kind,
          externalRef: l.externalRef,
          occurredOn: l.occurredOn,
          amount: l.amount.toString(),
          bankAccount: l.bankAccount,
          status: l.status,
          raw: l.raw,
        })
        .onConflictDoNothing()
        .returning({ id: marketplaceStatementLines.id });
      if (hasil.length) masuk += 1;
      else dilewati += 1;
    }

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
}
