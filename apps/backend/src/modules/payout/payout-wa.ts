/**
 * Isi pesan WhatsApp pencairan, dan template yang mengaturnya.
 *
 * KENAPA DI SERVER. Sebelum ini pesannya disusun dua kali -- sekali di web
 * (PencairanBatch.tsx) dan sekali di APK (PayoutShare.java) -- dengan alasan
 * yang masuk akal saat itu: datanya memang sudah ada di kedua layar, dan
 * menambah endpoint hanya akan menambah pintu. Begitu isinya bisa disetel
 * pemiliknya, alasan itu berbalik: template yang tersimpan di satu tempat tapi
 * dirender oleh dua penyusun yang berbeda akan menghasilkan dua pesan yang
 * berbeda, dan bedanya baru ketahuan setelah terkirim ke orang lain.
 *
 * BAHASA TEMPLATENYA sengaja sekecil mungkin -- penggantian nama dalam kurung
 * kurawal, tanpa percabangan, tanpa perulangan. Yang berulang (daftar toko,
 * daftar transfer) tetap disusun kode dan masuk sebagai SATU nama. Bahasa
 * template yang bisa bercabang akan menuntut pemiliknya belajar memprogram
 * untuk mengubah satu kata sapaan.
 *
 * SATU ATURAN yang menggantikan seluruh percabangan: baris yang memuat nama
 * yang nilainya KOSONG akan dibuang seluruhnya. Itulah yang membuat
 * "Sub-seller: {sub_seller}" hilang sendiri saat tidak ada sub-seller, persis
 * seperti perilaku sebelumnya, tanpa satu pun tanda if di dalam template.
 *
 * NAMA YANG TIDAK DIKENAL dibiarkan apa adanya, tidak dikosongkan. Dua
 * alasannya sama pentingnya: pemiliknya jadi melihat salah tulisnya, dan
 * {seller} yang tidak sengaja ditulis di template sub-seller tidak akan pernah
 * berubah menjadi nominal seller yang sebenarnya.
 */

export type JenisPesan = "seller" | "sub_seller";

/** Nominal rupiah, sama bentuknya dengan yang dipakai web dan APK. */
export function rupiah(v: number): string {
  return "Rp " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v);
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "3 Agustus 2026". Kosong kalau tanggalnya tidak ada atau tidak terbaca. */
export function tglPanjang(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Template bawaan, menghasilkan teks yang SAMA PERSIS dengan sebelumnya.
 *
 * Disengaja: pemilik yang tidak pernah menyentuh pengaturan ini tidak boleh
 * mendapati pesannya berubah hanya karena fiturnya ada.
 */
export const TEMPLATE_BAWAAN: Record<JenisPesan, string> = {
  seller: [
    "*Rekap Pencairan* ({jumlah_toko} toko)",
    "Batch: {batch}",
    "Tanggal pencairan: {tanggal_pencairan}",
    "Dibuat: {dibuat}",
    "Total Kredit: {total_kredit}",
    "",
    "*Hasil Kalkulasi*",
    "Sedekah: {sedekah}",
    "Sub-seller: {sub_seller}",
    "Sub-sub-seller: {sub_sub_seller}",
    "Seller: {seller}",
    "  - Bahan baku: {bahan_baku}",
    "  - Sisa seller: {sisa_seller}",
    "",
    "*Detail Toko*",
    "{detail_toko}",
  ].join("\n"),

  sub_seller: [
    "*Bukti Transfer Pencairan*",
    "Batch: {batch}",
    "Tanggal: {tanggal}",
    "",
    "{detail_transfer}",
  ].join("\n"),
};

/** Nama yang boleh dipakai di tiap template, untuk ditampilkan di pengaturan. */
export const NAMA_TERSEDIA: Record<JenisPesan, { nama: string; arti: string }[]> = {
  seller: [
    { nama: "jumlah_toko", arti: "Banyaknya toko di batch ini" },
    { nama: "batch", arti: "Kode batch, mis. #B-012" },
    { nama: "tanggal_pencairan", arti: "Tanggal uangnya cair (rentang bila lebih dari sehari)" },
    { nama: "dibuat", arti: "Tanggal batch dibuat" },
    { nama: "total_kredit", arti: "Jumlah seluruh kredit yang masuk" },
    { nama: "sedekah", arti: "Bagian sedekah" },
    { nama: "sub_seller", arti: "Bagian sub-seller — kosong bila tidak ada" },
    { nama: "sub_sub_seller", arti: "Bagian sub-sub-seller — kosong bila tidak ada" },
    { nama: "seller", arti: "Bagian seller" },
    { nama: "bahan_baku", arti: "Jatah bahan baku — kosong bila tidak ada" },
    { nama: "sisa_seller", arti: "Bagian seller setelah dikurangi bahan baku" },
    { nama: "detail_toko", arti: "Daftar toko: nama, nominal, dan tautan buktinya" },
  ],
  sub_seller: [
    { nama: "batch", arti: "Kode batch" },
    { nama: "tanggal", arti: "Tanggal batch ditutup/selesai" },
    { nama: "detail_transfer", arti: "Daftar penerima: nominal, bukti, dan bawaan batch sebelumnya" },
  ],
};

// ---------------------------------------------------------------- perender

/**
 * Mengganti nama-nama dalam kurawal, lalu membuang baris yang jadi kosong.
 *
 * Urutannya penting: penggantian dulu, pembuangan baris kemudian. Kalau
 * dibalik, baris yang nilainya kebetulan kosong sudah terlanjur ikut
 * dibersihkan sebagai baris biasa.
 */
export function render(template: string, nilai: Record<string, string>): string {
  const baris: string[] = [];
  for (const b of String(template ?? "").split("\n")) {
    const dipakai = [...b.matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1]!);
    const dikenal = dipakai.filter((n) => n in nilai);
    const takDikenal = dipakai.filter((n) => !(n in nilai));

    // Baris dibuang HANYA kalau seluruh nama yang dikenal kosong DAN tidak ada
    // nama yang tak dikenal di baris itu.
    //
    // Syarat kedua yang penting. Tanpanya, nama yang salah tulis akan
    // menghilangkan barisnya diam-diam -- persis melawan alasan nama tak
    // dikenal dibiarkan apa adanya, yaitu supaya pemiliknya MELIHAT salah
    // tulisnya alih-alih mendapati sebaris kalimatnya raib tanpa sebab.
    if (takDikenal.length === 0 && dikenal.length > 0
        && dikenal.every((n) => nilai[n] === "")) {
      continue;
    }

    let hasil = b;
    for (const n of dikenal) hasil = hasil.split(`{${n}}`).join(nilai[n]!);
    baris.push(hasil);
  }
  // Blok berbaris banyak masuk sebagai satu nama, jadi barisnya ikut terbawa
  // di sini; rapikan ekornya dan jangan sisakan tiga baris kosong beruntun.
  return baris
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
}

// ------------------------------------------------------------ bentuk data

export interface MutasiRingkas {
  shopId: string;
  creditAmount: unknown;
  sedekahAmount: unknown;
  sellerAmount: unknown;
  sellerMaterialAmount: unknown;
  subSellerAmount: unknown;
  subSubSellerAmount: unknown;
  subSellerId: string | null;
  subSubSellerId: string | null;
  payoutDate: string | null;
  marketplaceProofUrl: string | null;
}

export interface PencairanRingkas {
  recipientType: string;
  recipientName: string;
  expectedAmount: unknown;
  carryoverAmount: unknown;
  recipientSubSellerId: string | null;
  recipientSubSubSellerId: string | null;
  proofUrl: string | null;
}

export interface BatchRingkas {
  id: string;
  code: string | null;
  createdAt: string | Date | null;
  closedAt: string | Date | null;
  completedAt: string | Date | null;
  mutations: MutasiRingkas[];
  disbursements: PencairanRingkas[];
}

const n = (v: unknown): number => Number(v) || 0;

function absolut(url: string | null, baseUrl: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return baseUrl.replace(/\/+$/, "") + (url.startsWith("/") ? url : "/" + url);
}

function kodeBatch(b: BatchRingkas): string {
  return b.code ? `#${b.code}` : b.id.slice(0, 8);
}

// ------------------------------------------------------------ pesan seller

export function nilaiSeller(
  batch: BatchRingkas,
  namaToko: Map<string, string>,
  baseUrl: string,
): Record<string, string> {
  const t = batch.mutations.reduce(
    (a, m) => ({
      credit: a.credit + n(m.creditAmount),
      sedekah: a.sedekah + n(m.sedekahAmount),
      seller: a.seller + n(m.sellerAmount),
      material: a.material + n(m.sellerMaterialAmount),
      sub: a.sub + n(m.subSellerAmount),
      subSub: a.subSub + n(m.subSubSellerAmount),
    }),
    { credit: 0, sedekah: 0, seller: 0, material: 0, sub: 0, subSub: 0 },
  );

  // Tanggal uangnya, bukan tanggal batch dibuka: batch yang dimulai Senin bisa
  // memuat transfer hari Jumat.
  const hari = batch.mutations.map((m) => m.payoutDate).filter(Boolean).sort() as string[];
  const rentang =
    hari.length === 0
      ? ""
      : hari[0] === hari[hari.length - 1]
        ? tglPanjang(hari[0]!)
        : `${tglPanjang(hari[0]!)} – ${tglPanjang(hari[hari.length - 1]!)}`;

  const detail = batch.mutations.map((m, i) => {
    const nama = namaToko.get(m.shopId) ?? m.shopId.slice(0, 8);
    const bukti = m.marketplaceProofUrl
      ? `   ${absolut(m.marketplaceProofUrl, baseUrl)}`
      : "   (bukti pencairan belum diunggah)";
    return `${i + 1}. ${nama} - ${rupiah(n(m.creditAmount))}\n${bukti}`;
  });

  return {
    jumlah_toko: String(batch.mutations.length),
    batch: kodeBatch(batch),
    tanggal_pencairan: rentang,
    dibuat: tglPanjang(batch.createdAt),
    total_kredit: rupiah(t.credit),
    sedekah: rupiah(t.sedekah),
    // Kosong berarti barisnya dibuang -- itulah pengganti seluruh percabangan.
    sub_seller: t.sub > 0 ? rupiah(t.sub) : "",
    sub_sub_seller: t.subSub > 0 ? rupiah(t.subSub) : "",
    seller: rupiah(t.seller),
    bahan_baku: t.material > 0 ? rupiah(t.material) : "",
    sisa_seller: t.material > 0 ? rupiah(t.seller - t.material) : "",
    detail_toko: detail.join("\n"),
  };
}

// -------------------------------------------------------- pesan sub-seller

const JENIS: Record<string, string> = {
  sub_seller: "Sub-seller",
  sub_sub_seller: "Sub-sub-seller",
  sedekah: "Sedekah",
};

/**
 * Nilai untuk pesan sub-seller.
 *
 * Tidak memuat satu pun nominal seller, dan itu bukan kebetulan melainkan
 * syarat: pesan ini dikirim ke orang lain, dan yang terkirim lewat WhatsApp
 * tidak bisa ditarik kembali. Karena nama yang tidak dikenal dibiarkan apa
 * adanya, {seller} yang tidak sengaja ditulis di template ini akan tampil
 * sebagai tulisan "{seller}", bukan sebagai angkanya.
 */
export function nilaiSubSeller(batch: BatchRingkas, baseUrl: string): Record<string, string> {
  // Dicocokkan lewat id sub-seller, BUKAN lewat mutasi: baris transfer
  // sub-seller digabung per penerima, jadi payoutMutationId-nya null dan
  // menghitung lewat mutasi menghasilkan nol untuk semua orang.
  const cairPerSub = new Map<string, number>();
  for (const m of batch.mutations) {
    const kredit = n(m.creditAmount);
    if (m.subSellerId) cairPerSub.set(m.subSellerId, (cairPerSub.get(m.subSellerId) ?? 0) + kredit);
    if (m.subSubSellerId) {
      cairPerSub.set(m.subSubSellerId, (cairPerSub.get(m.subSubSellerId) ?? 0) + kredit);
    }
  }

  interface Kelompok {
    nama: string; jenis: string; total: number;
    bukti: string[]; tanpaBukti: number; cair: number; bawaan: number;
  }
  const per = new Map<string, Kelompok>();
  for (const d of batch.disbursements) {
    // Jatah bahan baku tidak ikut: uang itu dipotong dari bagian seller dan
    // masuk ke rekening pemilik sendiri, jadi menampilkannya berarti
    // memperlihatkan nominal seller lewat pintu lain.
    if (d.recipientType === "bahan_baku") continue;
    const kunci = `${d.recipientType}|${d.recipientName}`;
    const g = per.get(kunci) ?? {
      nama: d.recipientName, jenis: d.recipientType, total: 0,
      bukti: [], tanpaBukti: 0, cair: 0, bawaan: 0,
    };
    g.total += n(d.expectedAmount);
    g.bawaan += n(d.carryoverAmount);
    const idPenerima = d.recipientSubSellerId ?? d.recipientSubSubSellerId ?? null;
    if (idPenerima) g.cair += cairPerSub.get(idPenerima) ?? 0;
    if (d.proofUrl) g.bukti.push(absolut(d.proofUrl, baseUrl));
    else g.tanpaBukti += 1;
    per.set(kunci, g);
  }

  const baris: string[] = [];
  let i = 0;
  for (const g of [...per.values()].sort((a, b) => b.total - a.total)) {
    i += 1;
    baris.push(`${i}. ${g.nama} (${JENIS[g.jenis] ?? g.jenis}) — ${rupiah(g.total)}`);
    // Hanya untuk penerima yang bagiannya berasal dari toko tertentu. Baris
    // sedekah digabung untuk seluruh batch, jadi "total pencairan"-nya sama
    // dengan total seluruh batch -- ringkasan yang justru tidak diinginkan.
    if (g.cair > 0) baris.push(`   Total pencairan toko: ${rupiah(g.cair)}`);
    // Disebut kalau ada, karena tanpa ini penerimanya akan menghitung
    // persentasenya sendiri dan menyimpulkan angkanya salah.
    if (g.bawaan > 0) baris.push(`   (termasuk ${rupiah(g.bawaan)} bawaan batch sebelumnya)`);
    for (const u of g.bukti) baris.push(`   ${u}`);
    // Transfer tanpa bukti tetap didaftar: menghilangkannya membuat pesan
    // terlihat lengkap sementara ada yang masih menunggu uangnya.
    if (g.tanpaBukti > 0) baris.push(`   (${g.tanpaBukti} transfer belum ada buktinya)`);
  }

  return {
    batch: kodeBatch(batch),
    tanggal: tglPanjang(batch.completedAt ?? batch.closedAt ?? batch.createdAt),
    detail_transfer: baris.join("\n"),
  };
}

/** Satu pintu: template mana pun, data batch mana pun, keluar satu teks. */
export function susunPesan(opsi: {
  jenis: JenisPesan;
  batch: BatchRingkas;
  namaToko: Map<string, string>;
  baseUrl: string;
  template?: string | null;
}): string {
  const nilai =
    opsi.jenis === "seller"
      ? nilaiSeller(opsi.batch, opsi.namaToko, opsi.baseUrl)
      : nilaiSubSeller(opsi.batch, opsi.baseUrl);
  const t = opsi.template && opsi.template.trim() ? opsi.template : TEMPLATE_BAWAAN[opsi.jenis];
  return render(t, nilai);
}
