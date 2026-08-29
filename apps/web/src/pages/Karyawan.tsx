import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { api } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  InlineAlert,
  Input,
  Modal,
  PageHeader,
  SkeletonRows,
  Table,
  TableWrap,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "../components/ui";

interface Staff {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface PermDef {
  key: string;
  label: string;
  hint: string;
}

const KOSONG = { name: "", email: "", password: "", permissions: [] as string[] };

/**
 * Akun karyawan: siapa yang boleh masuk atas toko ini, dan sejauh mana.
 *
 * Sebelum ada halaman ini satu-satunya cara memberi akses ke karyawan adalah
 * menyerahkan password pemiliknya — yang berarti tidak ada cara mencabut akses
 * satu orang tanpa mengganti password semua orang.
 *
 * Karyawan masuk lewat halaman login yang SAMA, dengan email dan passwordnya
 * sendiri, dan melihat data toko yang sama. Yang membedakan hanya bagian mana
 * yang terbuka untuknya.
 */
export default function Karyawan() {
  const daftar = useFetch<Staff[]>("/staff");
  const izin = useFetch<PermDef[]>("/staff/permissions");
  const toast = useToast();

  const [buka, setBuka] = useState(false);
  const [edit, setEdit] = useState<Staff | null>(null);
  const [form, setForm] = useState({ ...KOSONG });
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [hapus, setHapus] = useState<Staff | null>(null);

  useEffect(() => {
    if (!buka) return;
    setGalat(null);
    if (edit) {
      setForm({
        name: edit.name,
        email: edit.email,
        password: "",
        permissions: [...edit.permissions],
      });
    } else {
      setForm({ ...KOSONG });
    }
  }, [buka, edit]);

  function toggle(key: string) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((k) => k !== key)
        : [...f.permissions, key],
    }));
  }

  async function simpan() {
    setSibuk(true);
    setGalat(null);
    try {
      if (edit) {
        const body: Record<string, unknown> = {
          name: form.name,
          email: form.email,
          permissions: form.permissions,
        };
        // Password kosong berarti "jangan diubah", bukan "kosongkan".
        if (form.password) body.password = form.password;
        await api.patch(`/staff/${edit.id}`, body);
        toast("Akun karyawan diperbarui.", "success");
      } else {
        await api.post("/staff", form);
        toast("Akun karyawan dibuat.", "success");
      }
      setBuka(false);
      setEdit(null);
      daftar.reload();
    } catch (e) {
      setGalat((e as Error).message);
    } finally {
      setSibuk(false);
    }
  }

  async function ubahAktif(s: Staff) {
    try {
      await api.patch(`/staff/${s.id}`, { isActive: !s.isActive });
      toast(
        s.isActive
          ? `${s.name} dinonaktifkan. Sesi yang sedang berjalan langsung berakhir.`
          : `${s.name} diaktifkan lagi.`,
        "success",
      );
      daftar.reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function jalankanHapus() {
    if (!hapus) return;
    try {
      await api.del(`/staff/${hapus.id}`);
      toast(`Akun ${hapus.name} dihapus.`, "success");
      setHapus(null);
      daftar.reload();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  const semuaIzin = izin.data ?? [];

  return (
    <Layout title="Karyawan">
      <PageHeader
        title="Akun Karyawan"
        subtitle="Beri akses ke tim tanpa membagikan password Anda sendiri."
        actions={
          <Button
            variant="filled"
            icon="plus"
            onClick={() => {
              setEdit(null);
              setBuka(true);
            }}
          >
            Tambah Karyawan
          </Button>
        }
      />

      <InlineAlert tone="info">
        Karyawan masuk lewat halaman login yang sama dengan email dan passwordnya
        sendiri, lalu melihat data toko yang sama. Mencabut centang atau
        menonaktifkan akun langsung mengakhiri sesi yang sedang berjalan.
      </InlineAlert>

      <Card className="mt-4" padded={false}>
        <CardHeader title={`Daftar Karyawan (${daftar.data?.length ?? 0})`} />
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Nama</TH>
                <TH>Email</TH>
                <TH>Akses</TH>
                <TH>Status</TH>
                <TH>Terakhir Masuk</TH>
                <TH> </TH>
              </TR>
            </THead>
            <tbody>
              {daftar.loading && <SkeletonRows n={3} cols={6} />}
              {!daftar.loading && (daftar.data?.length ?? 0) === 0 && (
                <TR>
                  <TD colSpan={6}>
                    <span className="text-ink-3">
                      Belum ada akun karyawan.
                    </span>
                  </TD>
                </TR>
              )}
              {(daftar.data ?? []).map((s) => (
                <TR key={s.id}>
                  <TD>{s.name}</TD>
                  <TD>{s.email}</TD>
                  <TD>
                    {s.permissions.length === 0 ? (
                      <span className="text-ink-3">belum ada akses</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {s.permissions.map((k) => (
                          <Badge key={k} tone="neutral">
                            {semuaIzin.find((p) => p.key === k)?.label ?? k}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={s.isActive ? "success" : "danger"}>
                      {s.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TD>
                  <TD>
                    {s.lastLoginAt
                      ? new Date(s.lastLoginAt).toLocaleString("id-ID")
                      : "belum pernah"}
                  </TD>
                  <TD>
                    <span className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEdit(s);
                          setBuka(true);
                        }}
                      >
                        Ubah
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => ubahAktif(s)}>
                        {s.isActive ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setHapus(s)}>
                        Hapus
                      </Button>
                    </span>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <Modal
        open={buka}
        onClose={() => {
          setBuka(false);
          setEdit(null);
        }}
        title={edit ? `Ubah ${edit.name}` : "Tambah Karyawan"}
      >
        <div className="flex flex-col gap-3">
          {galat && <InlineAlert tone="danger">{galat}</InlineAlert>}

          <Field label="Nama">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nama karyawan"
            />
          </Field>

          <Field label="Email untuk login">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="nama@email.com"
            />
          </Field>

          <Field
            label={edit ? "Password baru (kosongkan jika tidak diubah)" : "Password"}
            hint="Minimal 8 karakter. Beri tahu karyawannya sendiri — sistem tidak mengirim email."
          >
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={edit ? "biarkan kosong" : "minimal 8 karakter"}
            />
          </Field>

          <div>
            <div className="text-xs uppercase tracking-wide text-ink-3 mt-2 mb-1">
              Akses yang diberikan
            </div>
            <div className="flex flex-col gap-2">
              {semuaIzin.map((p) => (
                <label
                  key={p.key}
                  className="flex gap-2 items-start rounded-lg border border-line p-2.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.permissions.includes(p.key)}
                    onChange={() => toggle(p.key)}
                  />
                  <span>
                    <span className="block text-sm text-ink">{p.label}</span>
                    <span className="block text-xs text-ink-3">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {form.permissions.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">
                Tanpa satu pun akses, akun ini bisa masuk tapi tidak bisa membuka
                apa-apa.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setBuka(false);
                setEdit(null);
              }}
            >
              Batal
            </Button>
            <Button variant="filled" loading={sibuk} onClick={simpan}>
              Simpan
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(hapus)} onClose={() => setHapus(null)} title="Hapus akun karyawan?">
        <p className="text-sm text-ink">
          Akun <b>{hapus?.name}</b> ({hapus?.email}) dihapus dan tidak bisa masuk
          lagi. Data yang sudah dia catat — resi, pencairan, dan lainnya — tetap
          utuh sebagai milik toko.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setHapus(null)}>
            Batal
          </Button>
          <Button variant="danger" onClick={jalankanHapus}>
            Hapus
          </Button>
        </div>
      </Modal>
    </Layout>
  );
}

