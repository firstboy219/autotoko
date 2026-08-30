import { describe, expect, it } from "vitest";
import {
  NAMA_TERSEDIA,
  TEMPLATE_BAWAAN,
  nilaiSeller,
  nilaiSubSeller,
  render,
  susunPesan,
  tglPanjang,
  type BatchRingkas,
} from "./payout-wa.js";

/**
 * Yang dijaga di sini: apa yang TERKIRIM ke orang lain.
 *
 * Pesan WhatsApp tidak bisa ditarik kembali, jadi aturan "nominal seller tidak
 * pernah ikut ke sub-seller" harus dijaga tes, bukan kehati-hatian saat
 * membaca kode. Dan template bawaan harus menghasilkan teks yang sama persis
 * dengan sebelum fitur ini ada -- pemilik yang tidak menyentuh pengaturannya
 * tidak boleh mendapati pesannya berubah.
 */
describe("pesan WhatsApp pencairan", () => {
  const BASE = "https://viewtoko.cosger.online";

  const batch: BatchRingkas = {
    id: "0f3c9d21-aaaa-bbbb-cccc-1234567890ab",
    code: "B-012",
    createdAt: "2026-08-03T00:00:00.000Z",
    closedAt: "2026-08-10T00:00:00.000Z",
    completedAt: null,
    mutations: [
      {
        shopId: "toko-1",
        creditAmount: "1000000", sedekahAmount: "50000",
        sellerAmount: "700000", sellerMaterialAmount: "100000",
        subSellerAmount: "200000", subSubSellerAmount: "50000",
        subSellerId: "sub-a", subSubSellerId: null,
        payoutDate: "2026-08-05", marketplaceProofUrl: "/api/uploads/a.jpg",
      },
      {
        shopId: "toko-2",
        creditAmount: "500000", sedekahAmount: "25000",
        sellerAmount: "475000", sellerMaterialAmount: "0",
        subSellerAmount: "0", subSubSellerAmount: "0",
        subSellerId: null, subSubSellerId: null,
        payoutDate: "2026-08-07", marketplaceProofUrl: null,
      },
    ],
    disbursements: [
      {
        recipientType: "sub_seller", recipientName: "Salim",
        expectedAmount: "200000", carryoverAmount: "15000",
        recipientSubSellerId: "sub-a", recipientSubSubSellerId: null,
        proofUrl: "/api/uploads/tf1.jpg",
      },
      {
        recipientType: "sedekah", recipientName: "Kas Sedekah",
        expectedAmount: "75000", carryoverAmount: "0",
        recipientSubSellerId: null, recipientSubSubSellerId: null,
        proofUrl: null,
      },
      {
        // Tidak boleh muncul di pesan sub-seller.
        recipientType: "bahan_baku", recipientName: "Kas Bahan Baku",
        expectedAmount: "100000", carryoverAmount: "0",
        recipientSubSellerId: null, recipientSubSubSellerId: null,
        proofUrl: null,
      },
    ],
  };
  const namaToko = new Map([["toko-1", "Bulanjacom"], ["toko-2", "SalimTiktok"]]);

  const pesanSeller = () =>
    susunPesan({ jenis: "seller", batch, namaToko, baseUrl: BASE });
  const pesanSub = () =>
    susunPesan({ jenis: "sub_seller", batch, namaToko, baseUrl: BASE });

  // --- template bawaan harus sama dengan perilaku lama --------------------

  it("template bawaan menyusun rekap seller seperti sebelumnya", () => {
    const t = pesanSeller();
    expect(t).toContain("*Rekap Pencairan* (2 toko)");
    expect(t).toContain("Batch: #B-012");
    expect(t).toContain("Tanggal pencairan: 5 Agustus 2026 – 7 Agustus 2026");
    expect(t).toContain("Dibuat: 3 Agustus 2026");
    expect(t).toContain("Total Kredit: Rp 1.500.000");
    expect(t).toContain("Sedekah: Rp 75.000");
    expect(t).toContain("Sub-seller: Rp 200.000");
    expect(t).toContain("Sub-sub-seller: Rp 50.000");
    expect(t).toContain("Seller: Rp 1.175.000");
    expect(t).toContain("  - Bahan baku: Rp 100.000");
    expect(t).toContain("  - Sisa seller: Rp 1.075.000");
  });

  it("detail toko memuat nama, nominal, dan buktinya", () => {
    const t = pesanSeller();
    expect(t).toContain("1. Bulanjacom - Rp 1.000.000");
    expect(t).toContain(`   ${BASE}/api/uploads/a.jpg`);
    expect(t).toContain("2. SalimTiktok - Rp 500.000");
    // Bukti yang belum ada disebut, bukan dilewati diam-diam.
    expect(t).toContain("   (bukti pencairan belum diunggah)");
  });

  it("satu tanggal tidak ditulis sebagai rentang", () => {
    const satu: BatchRingkas = {
      ...batch,
      mutations: [{ ...batch.mutations[0]!, payoutDate: "2026-08-05" }],
    };
    const t = susunPesan({ jenis: "seller", batch: satu, namaToko, baseUrl: BASE });
    expect(t).toContain("Tanggal pencairan: 5 Agustus 2026");
    expect(t).not.toContain("–");
  });

  // --- aturan pengganti percabangan ---------------------------------------

  it("baris yang nilainya kosong hilang seluruhnya", () => {
    const tanpaSub: BatchRingkas = {
      ...batch,
      mutations: batch.mutations.map((m) => ({
        ...m, subSellerAmount: "0", subSubSellerAmount: "0", sellerMaterialAmount: "0",
      })),
    };
    const t = susunPesan({ jenis: "seller", batch: tanpaSub, namaToko, baseUrl: BASE });
    expect(t).not.toContain("Sub-seller:");
    expect(t).not.toContain("Sub-sub-seller:");
    expect(t).not.toContain("Bahan baku:");
    expect(t).not.toContain("Sisa seller:");
    // Yang lain tetap utuh.
    expect(t).toContain("Seller: ");
    expect(t).toContain("Total Kredit: ");
  });

  it("nama yang tidak dikenal dibiarkan apa adanya", () => {
    const t = susunPesan({
      jenis: "seller", batch, namaToko, baseUrl: BASE,
      template: "Halo {nama_toko_saya}, total {total_kredit}",
    });
    expect(t).toBe("Halo {nama_toko_saya}, total Rp 1.500.000");
  });

  // --- yang paling penting: tidak ada nominal seller ke sub-seller --------

  it("pesan sub-seller tidak memuat satu pun nominal seller", () => {
    const t = pesanSub();
    for (const bocor of ["Rp 1.175.000", "Rp 1.075.000", "Rp 1.500.000", "Seller:"]) {
      expect(t, `bocor: ${bocor}`).not.toContain(bocor);
    }
    expect(t).not.toContain("Bahan Baku");
    expect(t).not.toContain("Kas Bahan Baku");
  });

  it("{seller} di template sub-seller tetap tulisan, bukan angkanya", () => {
    const t = susunPesan({
      jenis: "sub_seller", batch, namaToko, baseUrl: BASE,
      template: "Bagian seller: {seller}\nBatch {batch}",
    });
    expect(t).toContain("Bagian seller: {seller}");
    expect(t).not.toContain("Rp 1.175.000");
  });

  it("pesan sub-seller merinci penerima, bukti, dan bawaan", () => {
    const t = pesanSub();
    expect(t).toContain("*Bukti Transfer Pencairan*");
    expect(t).toContain("1. Salim (Sub-seller) — Rp 200.000");
    expect(t).toContain("   Total pencairan toko: Rp 1.000.000");
    expect(t).toContain("   (termasuk Rp 15.000 bawaan batch sebelumnya)");
    expect(t).toContain(`   ${BASE}/api/uploads/tf1.jpg`);
    expect(t).toContain("2. Kas Sedekah (Sedekah) — Rp 75.000");
    expect(t).toContain("   (1 transfer belum ada buktinya)");
  });

  it("sedekah tidak diberi baris 'total pencairan toko'", () => {
    // Sedekah digabung untuk seluruh batch, jadi angkanya akan sama dengan
    // total batch -- ringkasan yang justru tidak diinginkan di pesan ini.
    const t = pesanSub();
    const barisSedekah = t.split("\n").findIndex((b) => b.includes("Kas Sedekah"));
    expect(t.split("\n")[barisSedekah + 1] ?? "").not.toContain("Total pencairan toko");
  });

  // --- perender itu sendiri ------------------------------------------------

  it("render membuang baris kosong beruntun dan spasi di ekor", () => {
    expect(render("a\n{x}\n\n\n\nb\n", { x: "" })).toBe("a\n\nb");
  });

  /**
   * Nama yang salah tulis tidak boleh menghilangkan barisnya diam-diam --
   * itulah gunanya nama tak dikenal dibiarkan apa adanya. Yang dikenal tetap
   * diganti, walau nilainya kosong.
   */
  it("baris dengan nama tak dikenal tidak pernah dibuang", () => {
    expect(render("Halo {nama_saya}, sedekah {sedekah}", { sedekah: "" }))
      .toBe("Halo {nama_saya}, sedekah");
    // Tanpa nama tak dikenal, baris yang nilainya kosong memang hilang.
    expect(render("Sedekah: {sedekah}", { sedekah: "" })).toBe("");
  });

  it("tanggal yang tidak terbaca jadi kosong, bukan 'Invalid Date'", () => {
    expect(tglPanjang(null)).toBe("");
    expect(tglPanjang("bukan tanggal")).toBe("");
    const t = susunPesan({
      jenis: "seller",
      batch: { ...batch, createdAt: null, mutations: [] },
      namaToko, baseUrl: BASE,
    });
    expect(t).not.toContain("Invalid");
    expect(t).not.toContain("Dibuat:");
  });

  // --- daftar nama yang ditawarkan di pengaturan --------------------------

  it("setiap nama yang ditawarkan benar-benar dikenali perendernya", () => {
    const nilai = {
      seller: nilaiSeller(batch, namaToko, BASE),
      sub_seller: nilaiSubSeller(batch, BASE),
    };
    for (const jenis of ["seller", "sub_seller"] as const) {
      for (const { nama } of NAMA_TERSEDIA[jenis]) {
        expect(nilai[jenis], `${jenis}.${nama}`).toHaveProperty(nama);
      }
    }
  });

  it("setiap nama di template bawaan ada di daftar yang ditawarkan", () => {
    for (const jenis of ["seller", "sub_seller"] as const) {
      const ditawarkan = new Set(NAMA_TERSEDIA[jenis].map((x) => x.nama));
      for (const m of TEMPLATE_BAWAAN[jenis].matchAll(/\{([a-z0-9_]+)\}/gi)) {
        expect(ditawarkan, `${jenis}: {${m[1]}}`).toContain(m[1]!);
      }
    }
  });
});
