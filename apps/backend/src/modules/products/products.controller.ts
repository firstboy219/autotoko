import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ProductsService } from "./products.service.js";
import { SaranService } from "../ai/saran.service.js";
import {
  CreateMasterDto,
  UpdateMasterDto,
  CreatePostingDto,
} from "./dto/products.dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("products")
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly saran: SaranService,
  ) {}

  /**
   * Saran AI atas katalog produk, dibandingkan dengan tren pasar Indonesia.
   *
   * Datanya diambil lewat listMasters() -- persis yang menggambar halaman ini
   * -- supaya angka di saran dan angka di tabel mustahil berbeda.
   */
  @Get("saran")
  async saranProduk(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    const semua = (await this.products.listMasters(uid(req), null)) as any[];
    // Dipangkas: katalog panjang akan menghabiskan konteks dengan produk yang
    // ekornya tidak menggerakkan apa pun, dan menutupi yang menggerakkan.
    const ringkas = semua.slice(0, 60).map((p) => ({
      nama: p.name,
      sku: p.sku,
      status: p.status,
      hargaDasar: p.basePrice,
      kategori: p.shopCategoryIds ?? [],
      jumlahPosting: p.postingCount,
      stok: p.totalStock,
      omzet7hari: p.gmv7d,
    }));
    return {
      success: true,
      data: await this.saran.dariBrief({
        peran: "Kamu menilai katalog produk sebuah toko online.",
        permintaan:
          "Bandingkan katalog di bawah dengan tren produk dan perilaku belanja " +
          "online di Indonesia. Tunjukkan produk mana yang layak didorong, mana " +
          "yang sebaiknya dihentikan, dan celah kategori yang belum diisi.",
        data: { jumlahProduk: semua.length, produk: ringkas },
        tren: true,
      }),
    };
  }

  @Get()
  async list(
    @Req() req: FastifyRequest,
    @Query("brandId") brandId?: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.listMasters(uid(req), brandId || null) };
  }

  @Post()
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateMasterDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.createMaster(uid(req), dto) };
  }

  /** Pohon Katalog > Postingan > Varian, dengan harga API & master tiap varian. */
  @Get("catalog-tree")
  async catalogTree(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.catalogTree(uid(req)) };
  }

  /** Kelompokkan otomatis postingan tak berkatalog menurut kesamaan judul. */
  @Post("catalogs/regroup")
  async regroup(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.regroupCatalogs(uid(req)) };
  }

  @Post("catalogs")
  async createCatalog(
    @Req() req: FastifyRequest,
    @Body() body: { name: string },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.createCatalog(uid(req), body.name) };
  }

  @Patch("catalogs/:id")
  async renameCatalog(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() body: { name: string },
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.renameCatalog(uid(req), id, body.name) };
  }

  @Delete("catalogs/:id")
  async deleteCatalog(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.deleteCatalog(uid(req), id) };
  }

  /** Pindahkan satu postingan ke sebuah katalog (catalogId null = lepas). */
  @Patch("postings/:productId/catalog")
  async assignCatalog(
    @Req() req: FastifyRequest,
    @Param("productId") productId: string,
    @Body() body: { catalogId: string | null },
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.products.assignPostingCatalog(uid(req), productId, body.catalogId ?? null),
    };
  }

  /** Tautkan/lepas satu VARIAN (SKU) ke master. masterId null = lepas. */
  @Post("variants/link")
  async linkVariant(
    @Req() req: FastifyRequest,
    @Body() body: { skuId: string; masterId: string | null },
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.products.linkVariant(uid(req), body.skuId, body.masterId ?? null),
    };
  }

  @Get(":id")
  async detail(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.getMaster(uid(req), id) };
  }

  @Patch(":id")
  async update(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateMasterDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.updateMaster(uid(req), id, dto) };
  }

  @Delete(":id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.deleteMaster(uid(req), id) };
  }

  @Post(":id/postings")
  async addPosting(
    @Req() req: FastifyRequest,
    @Body() dto: CreatePostingDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.createPosting(uid(req), dto) };
  }

  @Delete("postings/:postingId")
  async removePosting(
    @Req() req: FastifyRequest,
    @Param("postingId") postingId: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.deletePosting(uid(req), postingId) };
  }
}
