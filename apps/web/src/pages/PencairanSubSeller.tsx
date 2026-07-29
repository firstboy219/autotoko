import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from "../components/ui";

interface SubSeller {
  id: string; name: string; contact: string | null; bankAccount: string | null;
  defaultRate: string; status: "active" | "inactive"; kuotaTokoMaksimal: number | null;
}
interface SubSubSeller extends SubSeller { subSellerId: string; }
interface ShopOpt {
  id: string; marketplace: string; shopName: string;
  subSellerId: string | null; subSubSellerId: string | null; scenario: "A" | "B" | "C";
}

const pct = (r: string) => `${(Number(r) * 100).toFixed(1)}%`;
const kuotaLabel = (k: number | null) => (k == null ? "Tanpa batas" : `${k} toko`);

export function PencairanSubSeller() {
  const subs = useFetch<SubSeller[]>("/payout/sub-sellers");
  const subsubs = useFetch<SubSubSeller[]>("/payout/sub-sub-sellers");
  const shops = useFetch<ShopOpt[]>("/payout/shops");
  const [showCreate, setShowCreate] = useState(false);

  const reloadAll = () => {
    subs.reload();
    subsubs.reload();
  };

  return (
    <Layout title="Manajemen Sub-seller">
      <PageHeader
        title="Manajemen Sub-seller"
        subtitle="Kelola sub-seller, sub-sub-seller, dan penugasan toko."
        back={
          <Link
            to="/pencairan"
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink mb-3"
          >
            <Icon name="arrowLeft" size={16} /> Kembali
          </Link>
        }
        actions={
          !showCreate && (
            <Button variant="filled" icon="plus" onClick={() => setShowCreate(true)}>
              Tambah Sub-seller
            </Button>
          )
        }
      />

      <div className="space-y-4">
        {showCreate && (
          <CreateSubSeller
            onDone={() => { setShowCreate(false); subs.reload(); }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        <SubSellerList
          loading={subs.loading}
          subs={subs.data ?? []}
          subsubs={subsubs.data ?? []}
          onChange={reloadAll}
          onAdd={() => setShowCreate(true)}
        />

        <ShopAssignList
          loading={shops.loading}
          shops={shops.data ?? []}
          subs={subs.data ?? []}
          subsubs={subsubs.data ?? []}
          onChange={shops.reload}
        />
      </div>
    </Layout>
  );
}

/* ------------------------------------------------------------- create */

function CreateSubSeller({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [bank, setBank] = useState("");
  const [rate, setRate] = useState("20");
  const [kuota, setKuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/payout/sub-sellers", {
        name,
        contact: contact || undefined,
        bankAccount: bank || undefined,
        defaultRate: Number(rate) / 100,
        ...(kuota !== "" ? { kuotaTokoMaksimal: Number(kuota) } : {}),
      });
      toast("Sub-seller ditambahkan", "success");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Tambah Sub-seller"
        action={
          <Button variant="text" size="sm" onClick={onCancel}>
            Tutup
          </Button>
        }
      />
      <form onSubmit={submit} className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Nama" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama sub-seller" required />
          </Field>
          <Field label="Kontak" hint="HP atau email">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="08…" />
          </Field>
          <Field label="Rekening Tujuan">
            <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Nomor rekening" className="font-mono" />
          </Field>
          <Field label="Rate (%)" hint="Bagian dari sisa setelah sedekah">
            <Input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
              className="tabular-nums"
            />
          </Field>
          <Field label="Kuota Toko" hint="Kosongkan = tanpa batas">
            <Input
              inputMode="numeric"
              value={kuota}
              onChange={(e) => setKuota(e.target.value.replace(/\D/g, ""))}
              placeholder="∞"
              className="tabular-nums"
            />
          </Field>
        </div>
        {err && (
          <div className="mt-4">
            <InlineAlert tone="danger">{err}</InlineAlert>
          </div>
        )}
        <div className="mt-4">
          <Button variant="filled" icon="check" loading={busy} disabled={!name}>
            Tambah Sub-seller
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* --------------------------------------------------------- sub-seller list */

function SubSellerList({
  loading,
  subs,
  subsubs,
  onChange,
  onAdd,
}: {
  loading: boolean;
  subs: SubSeller[];
  subsubs: SubSubSeller[];
  onChange: () => void;
  onAdd: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Card padded={false}>
      <CardHeader title={`Sub-seller (${subs.length})`} />
      {loading ? (
        <div className="p-5 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-64" />
        </div>
      ) : !subs.length ? (
        <EmptyState
          icon="users"
          title="Belum ada sub-seller"
          description="Tambahkan sub-seller untuk membagi hasil pencairan tiap toko."
          action={
            <Button variant="filled" icon="plus" onClick={onAdd}>
              Tambah Sub-seller
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {subs.map((s) => {
            const children = subsubs.filter((ss) => ss.subSellerId === s.id);
            const open = openId === s.id;
            return (
              <li key={s.id}>
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink">{s.name}</span>
                        <Badge tone={s.status === "active" ? "success" : "neutral"}>
                          {s.status === "active" ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-ink-2">
                        <span>Rate {pct(s.defaultRate)}</span>
                        {s.contact && <span>{s.contact}</span>}
                        <span className="font-mono">{s.bankAccount || "rekening belum diisi"}</span>
                        <span>Kuota: {kuotaLabel(s.kuotaTokoMaksimal)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <EditSubSeller
                        endpoint={`/payout/sub-sellers/${s.id}`}
                        current={s}
                        onDone={onChange}
                      />
                      <Button
                        size="sm"
                        variant="text"
                        iconRight={open ? "chevronDown" : "chevronRight"}
                        onClick={() => setOpenId(open ? null : s.id)}
                      >
                        {children.length} sub-sub
                      </Button>
                    </div>
                  </div>
                </div>

                {open && (
                  <div className="bg-canvas border-t border-line px-5 py-4">
                    <CreateSubSubSeller subSellerId={s.id} onDone={onChange} />
                    {children.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {children.map((c) => (
                          <li
                            key={c.id}
                            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-white px-3.5 py-3"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-ink">{c.name}</span>
                                <Badge tone={c.status === "active" ? "success" : "neutral"}>
                                  {c.status === "active" ? "Aktif" : "Nonaktif"}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-ink-2">
                                <span>Rate {pct(c.defaultRate)}</span>
                                {c.contact && <span>{c.contact}</span>}
                                <span className="font-mono">{c.bankAccount || "rekening belum diisi"}</span>
                                <span>Kuota: {kuotaLabel(c.kuotaTokoMaksimal)}</span>
                              </div>
                            </div>
                            <EditSubSeller
                              endpoint={`/payout/sub-sub-sellers/${c.id}`}
                              current={c}
                              onDone={onChange}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------- inline edit */

/** Edits name / bank account / quota in one place — previously these were two
 *  separate inline editors sitting next to each other. */
function EditSubSeller({
  endpoint,
  current,
  onDone,
}: {
  endpoint: string;
  current: SubSeller;
  onDone: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current.name);
  const [bank, setBank] = useState(current.bankAccount ?? "");
  const [kuota, setKuota] = useState(current.kuotaTokoMaksimal == null ? "" : String(current.kuotaTokoMaksimal));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function open() {
    setName(current.name);
    setBank(current.bankAccount ?? "");
    setKuota(current.kuotaTokoMaksimal == null ? "" : String(current.kuotaTokoMaksimal));
    setErr(null);
    setEditing(true);
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patch(endpoint, {
        name,
        bankAccount: bank || null,
        kuotaTokoMaksimal: kuota === "" ? null : Number(kuota),
      });
      toast("Perubahan tersimpan", "success");
      setEditing(false);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="text" icon="pencil" onClick={open}>
        Edit
      </Button>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${current.name}`}
        footer={
          <>
            <Button variant="text" onClick={() => setEditing(false)} disabled={busy}>
              Batal
            </Button>
            <Button variant="filled" loading={busy} disabled={!name.trim()} onClick={save}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nama" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Rekening tujuan">
            <Input value={bank} onChange={(e) => setBank(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Kuota toko" hint="Kosongkan untuk tanpa batas">
            <Input
              inputMode="numeric"
              value={kuota}
              onChange={(e) => setKuota(e.target.value.replace(/\D/g, ""))}
              placeholder="∞"
              className="tabular-nums"
            />
          </Field>
          {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------ create sub-sub */

function CreateSubSubSeller({ subSellerId, onDone }: { subSellerId: string; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("50");
  const [kuota, setKuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/payout/sub-sub-sellers", {
        subSellerId,
        name,
        defaultRate: Number(rate) / 100,
        ...(kuota !== "" ? { kuotaTokoMaksimal: Number(kuota) } : {}),
      });
      setName("");
      setRate("50");
      setKuota("");
      toast("Sub-sub-seller ditambahkan", "success");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Nama sub-sub-seller" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama" required />
        </Field>
        <Field label="Rate (%)" hint="Dari jatah sub-seller">
          <Input
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
            className="tabular-nums"
          />
        </Field>
        <Field label="Kuota toko" hint="Kosong = tanpa batas">
          <Input
            inputMode="numeric"
            value={kuota}
            onChange={(e) => setKuota(e.target.value.replace(/\D/g, ""))}
            placeholder="∞"
            className="tabular-nums"
          />
        </Field>
      </div>
      {err && (
        <div className="mt-3">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}
      <div className="mt-3">
        <Button size="sm" variant="tonal" icon="plus" loading={busy} disabled={!name}>
          Tambah Sub-sub-seller
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------ shop assignment */

function ShopAssignList({
  loading,
  shops,
  subs,
  subsubs,
  onChange,
}: {
  loading: boolean;
  shops: ShopOpt[];
  subs: SubSeller[];
  subsubs: SubSubSeller[];
  onChange: () => void;
}) {
  return (
    <Card padded={false}>
      <CardHeader
        title="Penugasan Toko"
        subtitle="Tentukan siapa pemilik tiap toko — menentukan ke mana hasil pencairannya dibagi."
      />
      {loading ? (
        <div className="p-5 space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : !shops.length ? (
        <EmptyState
          icon="store"
          title="Belum ada toko"
          description="Hubungkan toko lewat menu Toko Saya terlebih dahulu."
        />
      ) : (
        <ul className="divide-y divide-line">
          {shops.map((sh) => (
            <ShopAssignRow key={sh.id} shop={sh} subs={subs} subsubs={subsubs} onChange={onChange} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ShopAssignRow({
  shop,
  subs,
  subsubs,
  onChange,
}: {
  shop: ShopOpt;
  subs: SubSeller[];
  subsubs: SubSubSeller[];
  onChange: () => void;
}) {
  const toast = useToast();
  const [subSellerId, setSubSellerId] = useState(shop.subSellerId ?? "");
  const [subSubSellerId, setSubSubSellerId] = useState(shop.subSubSellerId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const children = subsubs.filter((ss) => ss.subSellerId === subSellerId);

  const dirty =
    subSellerId !== (shop.subSellerId ?? "") || subSubSellerId !== (shop.subSubSellerId ?? "");

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/payout/shops/${shop.id}/assign`, {
        subSellerId: subSellerId || null,
        subSubSellerId: subSellerId ? subSubSellerId || null : null,
      });
      toast("Penugasan toko disimpan", "success");
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px] flex-1">
          <div className="text-sm font-medium text-ink">{shop.shopName}</div>
          <div className="text-xs text-ink-3 mt-0.5 capitalize">
            {shop.marketplace} · Skenario {shop.scenario}
          </div>
        </div>

        <Field label="Sub-seller" className="w-full sm:w-52">
          <Select
            value={subSellerId}
            onChange={(e) => {
              setSubSellerId(e.target.value);
              setSubSubSellerId("");
            }}
          >
            <option value="">— milik Seller —</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Sub-sub-seller" className="w-full sm:w-52">
          <Select
            value={subSubSellerId}
            onChange={(e) => setSubSubSellerId(e.target.value)}
            disabled={!subSellerId}
          >
            <option value="">— tanpa sub-sub —</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>

        <Button variant={dirty ? "filled" : "outline"} loading={busy} disabled={!dirty} onClick={save}>
          Simpan
        </Button>
      </div>
      {err && (
        <div className="mt-3">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}
    </li>
  );
}
