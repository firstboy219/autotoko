import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import { staffAccounts, users } from "../../database/schema/index.js";
import { MIN_PASSWORD_LENGTH, hashPassword } from "../auth/password.util.js";
import { STAFF_PERMISSIONS, STAFF_PERMISSION_KEYS } from "./permissions.js";
import { invalidateStaffCache } from "../auth/jwt-auth.guard.js";

/**
 * Akun karyawan milik satu pemilik toko.
 *
 * Yang dijaga di sini bukan cuma "bisa membuat akun", melainkan bahwa mencabut
 * akses benar-benar mencabut: menonaktifkan akun atau mengubah izinnya harus
 * berlaku pada sesi yang SEDANG berjalan, bukan menunggu tokennya kedaluwarsa.
 * Karena itu izin tidak pernah ditanam di dalam token -- ia dibaca dari baris
 * ini pada tiap permintaan, lewat cache pendek yang dibatalkan di sini.
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
  ) {}

  /** Daftar izin yang tersedia, supaya layar tidak perlu menyalinnya. */
  permissionCatalogue() {
    return STAFF_PERMISSIONS;
  }

  async list(ownerId: string) {
    const rows = await this.db
      .select({
        id: staffAccounts.id,
        name: staffAccounts.name,
        email: staffAccounts.email,
        permissions: staffAccounts.permissions,
        isActive: staffAccounts.isActive,
        lastLoginAt: staffAccounts.lastLoginAt,
        createdAt: staffAccounts.createdAt,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.userId, ownerId))
      .orderBy(asc(staffAccounts.name));
    return rows;
  }

  /**
   * Email harus bebas di SELURUH sistem, bukan cuma di antara karyawan.
   *
   * Login mencoba tabel users lebih dulu lalu staff_accounts; alamat yang ada
   * di keduanya berarti satu orang mengetik satu email dan mendapat akun yang
   * berbeda tergantung urutan pemeriksaan. Itu bukan bug yang akan terlihat,
   * jadi ia dicegah di sini.
   */
  private async pastikanEmailBebas(email: string, kecualiId?: string) {
    const bentrok = await this.tenant.runBypass(async () => {
      const [u] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (u) return "pemilik";
      const [s] = await this.db
        .select({ id: staffAccounts.id })
        .from(staffAccounts)
        .where(sql`lower(${staffAccounts.email}) = ${email}`)
        .limit(1);
      if (s && s.id !== kecualiId) return "karyawan";
      return null;
    });
    if (bentrok) {
      throw new ConflictException(
        bentrok === "pemilik"
          ? "Email ini sudah dipakai sebuah akun pemilik."
          : "Email ini sudah dipakai akun karyawan lain.",
      );
    }
  }

  private bersihkanIzin(masuk: unknown): string[] {
    if (!Array.isArray(masuk)) return [];
    const sah = new Set(STAFF_PERMISSION_KEYS);
    // Kunci asing dibuang diam-diam daripada ditolak: yang dikirim layar lama
    // setelah sebuah modul dihapus tidak boleh membuat penyimpanan gagal.
    return [...new Set(masuk.filter((k): k is string => typeof k === "string" && sah.has(k)))];
  }

  async create(
    ownerId: string,
    input: { name?: string; email?: string; password?: string; permissions?: unknown },
  ) {
    const name = (input.name ?? "").trim().replace(/\s+/g, " ");
    const email = (input.email ?? "").trim().toLowerCase();
    const password = input.password ?? "";

    if (name.length < 2) throw new BadRequestException("Nama karyawan minimal 2 huruf.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException("Email tidak valid.");
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
    }
    await this.pastikanEmailBebas(email);

    const [row] = await this.db
      .insert(staffAccounts)
      .values({
        userId: ownerId,
        name,
        email,
        passwordHash: await hashPassword(password),
        permissions: this.bersihkanIzin(input.permissions),
      })
      .returning({
        id: staffAccounts.id,
        name: staffAccounts.name,
        email: staffAccounts.email,
        permissions: staffAccounts.permissions,
        isActive: staffAccounts.isActive,
      });
    this.logger.log(`Akun karyawan dibuat untuk ${ownerId}: ${email}`);
    return row;
  }

  private async milik(ownerId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(staffAccounts)
      .where(and(eq(staffAccounts.id, id), eq(staffAccounts.userId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundException("Akun karyawan tidak ditemukan.");
    return row;
  }

  async update(
    ownerId: string,
    id: string,
    input: {
      name?: string;
      email?: string;
      password?: string;
      permissions?: unknown;
      isActive?: boolean;
    },
  ) {
    const ada = await this.milik(ownerId, id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (input.name !== undefined) {
      const name = input.name.trim().replace(/\s+/g, " ");
      if (name.length < 2) throw new BadRequestException("Nama karyawan minimal 2 huruf.");
      patch.name = name;
    }
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new BadRequestException("Email tidak valid.");
      }
      if (email !== ada.email.toLowerCase()) await this.pastikanEmailBebas(email, id);
      patch.email = email;
    }
    if (input.permissions !== undefined) {
      patch.permissions = this.bersihkanIzin(input.permissions);
    }
    if (input.isActive !== undefined) {
      patch.isActive = Boolean(input.isActive);
    }
    if (input.password !== undefined && input.password !== "") {
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        throw new BadRequestException(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
      }
      patch.passwordHash = await hashPassword(input.password);
    }

    // Password baru, akun dimatikan, atau izin dicabut: sesi yang sedang
    // berjalan harus ikut mati. Tanpa stempel ini, karyawan yang baru saja
    // dicabut aksesnya tetap bisa bekerja sampai tokennya habis sendiri.
    if (
      patch.passwordHash !== undefined ||
      patch.isActive === false ||
      patch.permissions !== undefined
    ) {
      patch.sessionsValidFrom = new Date();
    }

    const [row] = await this.db
      .update(staffAccounts)
      .set(patch)
      .where(and(eq(staffAccounts.id, id), eq(staffAccounts.userId, ownerId)))
      .returning({
        id: staffAccounts.id,
        name: staffAccounts.name,
        email: staffAccounts.email,
        permissions: staffAccounts.permissions,
        isActive: staffAccounts.isActive,
      });
    invalidateStaffCache(id);
    return row;
  }

  async remove(ownerId: string, id: string) {
    await this.milik(ownerId, id);
    await this.db
      .delete(staffAccounts)
      .where(and(eq(staffAccounts.id, id), eq(staffAccounts.userId, ownerId)));
    invalidateStaffCache(id);
    this.logger.log(`Akun karyawan ${id} dihapus oleh ${ownerId}`);
    return { deleted: true };
  }
}
