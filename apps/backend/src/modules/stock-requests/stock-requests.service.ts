import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { convertUnit, unitsCompatible } from "@autotoko/shared";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  materials,
  stockRequestItems,
  stockRequests,
} from "../../database/schema/index.js";
import { pesanRequest, totalDari, type ItemRequest } from "./stock-request-wa.js";
import type { SimpanRequestDto } from "./dto.js";

/**
 * Permintaan pembelian stok (non-COD), dikirim ke pemasok lewat WhatsApp.
 *
 * MENGGANTIKAN rekap stok. Rekap menjawab "apa yang ada di rak"; yang
 * dibutuhkan justru langkah sesudahnya -- "apa yang harus dibeli, berapa
 * banyak, berapa harganya". Rekap berakhir di layar; permintaan berakhir di
 * WhatsApp pemasok.
 *
 * TIDAK MENYENTUH STOK. Permintaan bukan pembelian: barangnya belum datang.
 * Stok baru bertambah lewat scan bahan baku datang, sama seperti sebelumnya.
 * Menaikkan stok saat permintaan dibuat berarti angka yang salah di rak dan di
 * HPP sekaligus, dan salahnya baru terlihat saat ada yang menghitung fisik.
 */
@Injectable()
export class StockRequestsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Menerjemahkan satuan penjual ke satuan rak.
   *
   * "2 botol, tiap botol 1 liter" pada bahan yang dicatat dalam ml menjadi
   * 2.000 ml. Selama ini terjemahan itu dikerjakan orang di kepalanya, ke
   * dalam kolom yang hanya berlabel "ml" -- dan mengetik 2 untuk dua botol
   * satu liter adalah pembacaan yang wajar, yang mengkredit rak dengan
   * seperseribu dari yang datang.
   *
   * Mengembalikan null kalau satuannya tidak sepadan (mis. isi "liter" untuk
   * bahan yang dicatat per "pcs"). Null berarti tidak diterjemahkan, BUKAN nol
   * -- dan layar menampilkannya sebagai peringatan, bukan sebagai angka.
   */
  private terjemahkan(
    qtyPack: number,
    contentPerPack: number | null,
    contentUnit: string | null,
    baseUnit: string | null,
  ): number | null {
    if (!Number.isFinite(qtyPack) || qtyPack <= 0) return null;
    // Tanpa isi kemasan, satu kemasan dihitung satu satuan rak: 50 pcs kardus
    // memang 50 pcs.
    if (contentPerPack == null || !contentUnit) return qtyPack;
    if (!baseUnit) return null;
    if (!unitsCompatible(contentUnit, baseUnit)) return null;
    const seKemasan = convertUnit(contentPerPack, contentUnit, baseUnit);
    if (seKemasan == null || !Number.isFinite(seKemasan)) return null;
    return qtyPack * seKemasan;
  }

  async list(userId: string) {
    const rows = await this.db
      .select()
      .from(stockRequests)
      .where(eq(stockRequests.userId, userId))
      .orderBy(desc(stockRequests.createdAt));
    return rows;
  }

  async get(userId: string, id: string) {
    const [req] = await this.db
      .select()
      .from(stockRequests)
      .where(and(eq(stockRequests.userId, userId), eq(stockRequests.id, id)))
      .limit(1);
    if (!req) throw new NotFoundException("Permintaan tidak ditemukan.");

    const items = await this.db
      .select({
        id: stockRequestItems.id,
        materialId: stockRequestItems.materialId,
        namaMaster: materials.name,
        satuanMaster: materials.unit,
        rawName: stockRequestItems.rawName,
        qtyPack: stockRequestItems.qtyPack,
        packLabel: stockRequestItems.packLabel,
        contentPerPack: stockRequestItems.contentPerPack,
        contentUnit: stockRequestItems.contentUnit,
        qtyBase: stockRequestItems.qtyBase,
        baseUnit: stockRequestItems.baseUnit,
        unitPrice: stockRequestItems.unitPrice,
        totalPrice: stockRequestItems.totalPrice,
      })
      .from(stockRequestItems)
      .leftJoin(materials, eq(materials.id, stockRequestItems.materialId))
      .where(eq(stockRequestItems.requestId, id));

    return { ...req, items };
  }

  /** Simpan seluruh permintaan sekaligus: kepala dan barisnya satu tarikan. */
  async simpan(userId: string, dto: SimpanRequestDto, id?: string) {
    if (!dto.screenshotUrl?.trim()) {
      throw new BadRequestException(
        "Tangkapan layar wajib diunggah — tanpa itu permintaan ini tidak bisa "
          + "diperiksa ulang oleh siapa pun sesudahnya.",
      );
    }

    // Satuan tiap bahan diambil dari master, bukan dari layar: layar bisa
    // mengirim satuan yang sudah berubah sejak halamannya dibuka.
    const idBahan = dto.items.map((i) => i.materialId).filter(Boolean) as string[];
    const master = idBahan.length
      ? await this.db
          .select({ id: materials.id, unit: materials.unit, name: materials.name })
          .from(materials)
          .where(eq(materials.userId, userId))
      : [];
    const satuanDari = new Map(master.map((m) => [m.id, m.unit]));

    const baris = dto.items.map((i) => {
      const baseUnit = i.materialId ? (satuanDari.get(i.materialId) ?? null) : null;
      const qtyBase = this.terjemahkan(
        Number(i.qtyPack) || 0,
        i.contentPerPack == null ? null : Number(i.contentPerPack),
        i.contentUnit ?? null,
        baseUnit,
      );
      const unitPrice = i.unitPrice == null ? null : Number(i.unitPrice);
      // Total dihitung di sini, bukan diambil dari layar: dua angka untuk satu
      // perkalian akan berbeda suatu saat, dan yang salah adalah yang dikirim
      // ke pemasok.
      const totalPrice = unitPrice == null ? null : unitPrice * (Number(i.qtyPack) || 0);
      return {
        materialId: i.materialId ?? null,
        rawName: i.rawName?.slice(0, 255) ?? null,
        qtyPack: String(Number(i.qtyPack) || 0),
        packLabel: i.packLabel?.slice(0, 32) ?? null,
        contentPerPack: i.contentPerPack == null ? null : String(Number(i.contentPerPack)),
        contentUnit: i.contentUnit?.slice(0, 16) ?? null,
        qtyBase: qtyBase == null ? null : String(qtyBase),
        baseUnit,
        unitPrice: unitPrice == null ? null : unitPrice.toFixed(2),
        totalPrice: totalPrice == null ? null : totalPrice.toFixed(2),
      };
    });

    const total = baris.reduce((a, b) => a + Number(b.totalPrice ?? 0), 0);

    let requestId = id;
    if (requestId) {
      const [ada] = await this.db
        .select({ id: stockRequests.id, status: stockRequests.status })
        .from(stockRequests)
        .where(and(eq(stockRequests.userId, userId), eq(stockRequests.id, requestId)))
        .limit(1);
      if (!ada) throw new NotFoundException("Permintaan tidak ditemukan.");
      // Yang sudah terkirim tidak diubah. Pemasok sudah memegang versinya, dan
      // mengubah catatan di sini akan membuat kedua pihak memegang daftar yang
      // berbeda tanpa ada yang tahu.
      if (ada.status === "dikirim") {
        throw new BadRequestException(
          "Permintaan ini sudah dikirim. Buat permintaan baru untuk perubahan.",
        );
      }
      await this.db
        .update(stockRequests)
        .set({
          screenshotUrl: dto.screenshotUrl,
          note: dto.note ?? null,
          totalCost: total.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(stockRequests.id, requestId));
      await this.db.delete(stockRequestItems).where(eq(stockRequestItems.requestId, requestId));
    } else {
      const [dibuat] = await this.db
        .insert(stockRequests)
        .values({
          userId,
          screenshotUrl: dto.screenshotUrl,
          note: dto.note ?? null,
          totalCost: total.toFixed(2),
        })
        .returning({ id: stockRequests.id });
      requestId = dibuat!.id;
    }

    if (baris.length) {
      await this.db
        .insert(stockRequestItems)
        .values(baris.map((b) => ({ ...b, requestId: requestId!, userId })));
    }
    return this.get(userId, requestId!);
  }

  async hapus(userId: string, id: string) {
    const [ada] = await this.db
      .select({ id: stockRequests.id })
      .from(stockRequests)
      .where(and(eq(stockRequests.userId, userId), eq(stockRequests.id, id)))
      .limit(1);
    if (!ada) throw new NotFoundException("Permintaan tidak ditemukan.");
    await this.db.delete(stockRequests).where(eq(stockRequests.id, id));
    return { ok: true };
  }

  /** Teks pesan WhatsApp, dan penandaan bahwa permintaannya sudah dikirim. */
  async wa(userId: string, id: string, tandai: boolean) {
    const req = await this.get(userId, id);
    const items: ItemRequest[] = req.items.map((i) => ({
      nama: i.namaMaster ?? i.rawName ?? "(tanpa nama)",
      qtyPack: Number(i.qtyPack) || 0,
      packLabel: i.packLabel,
      contentPerPack: i.contentPerPack == null ? null : Number(i.contentPerPack),
      contentUnit: i.contentUnit,
      qtyBase: i.qtyBase == null ? null : Number(i.qtyBase),
      baseUnit: i.baseUnit,
      unitPrice: i.unitPrice == null ? null : Number(i.unitPrice),
      totalPrice: i.totalPrice == null ? null : Number(i.totalPrice),
    }));

    const base = (process.env.APP_URL ?? "https://viewtoko.cosger.online").replace(/\/+$/, "");
    const tautan = req.screenshotUrl?.startsWith("http")
      ? req.screenshotUrl
      : base + (req.screenshotUrl?.startsWith("/") ? req.screenshotUrl : "/" + req.screenshotUrl);

    const teks = pesanRequest({
      items,
      catatan: req.note,
      tautanBukti: tautan,
      tanggal: req.createdAt,
    });

    if (tandai && req.status !== "dikirim") {
      await this.db
        .update(stockRequests)
        .set({ status: "dikirim", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(stockRequests.id, id));
    }
    return { teks, total: totalDari(items) };
  }
}
