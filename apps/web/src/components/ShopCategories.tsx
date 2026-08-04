import { useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { Badge, Button, Input, Modal, useToast } from "./ui";

export interface ShopCategory {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  shopCount: number;
}

/** Enough to tell groups apart without turning this into a colour picker. */
const PALETTE = [
  "#0E6E55", "#1D4ED8", "#B45309", "#B3261E",
  "#6D28D9", "#0F766E", "#A16207", "#475569",
];

export function CategoryChip({
  name,
  color,
}: {
  name: string;
  color?: string | null;
}) {
  if (!color) return <Badge tone="neutral">{name}</Badge>;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${color}1A`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}

/**
 * Managing the groups themselves.
 *
 * Deleting a category never touches the shops in it — they simply become
 * ungrouped, and the confirm text says so. Reading "delete category" as
 * "delete these nine shops" would be catastrophic and is exactly the sort of
 * thing someone clicks through without reading.
 */
export function ManageCategoriesModal({
  categories,
  onClose,
  onChange,
}: {
  categories: ShopCategory[];
  onClose: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ShopCategory | null>(null);
  const [editName, setEditName] = useState("");

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post("/shops/categories", { name: name.trim(), color });
      setName("");
      onChange();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function rename(cat: ShopCategory) {
    if (!editName.trim() || editName.trim() === cat.name) {
      setEditing(null);
      return;
    }
    try {
      await api.patch(`/shops/categories/${cat.id}`, { name: editName.trim() });
      setEditing(null);
      onChange();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function recolor(cat: ShopCategory, next: string) {
    try {
      await api.patch(`/shops/categories/${cat.id}`, { color: next });
      onChange();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  async function remove(cat: ShopCategory) {
    const msg =
      cat.shopCount > 0
        ? `Hapus kategori "${cat.name}"? ${cat.shopCount} toko di dalamnya TIDAK ikut terhapus, hanya jadi tanpa kategori.`
        : `Hapus kategori "${cat.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await api.del(`/shops/categories/${cat.id}`);
      onChange();
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  }

  return (
    <Modal open title="Kelola Kategori Toko" onClose={onClose} width="max-w-lg">
      <div className="mb-4">
        <label className="block text-xs text-ink-2 mb-1.5">Kategori baru</label>
        <div className="flex gap-2">
          <Input
            placeholder="mis. Brand Utama, Gudang Bekasi"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
          <Button variant="filled" onClick={create} disabled={busy || !name.trim()}>
            Tambah
          </Button>
        </div>
        <div className="flex gap-1.5 mt-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full border-2 ${
                color === c ? "border-ink" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Warna ${c}`}
            />
          ))}
        </div>
      </div>

      {categories.length === 0 ? (
        <p className="text-xs text-ink-2">Belum ada kategori.</p>
      ) : (
        <div className="space-y-2">
          {categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 border border-line rounded-lg px-3 py-2"
            >
              {editing?.id === c.id ? (
                <>
                  <Input
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void rename(c);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <Button variant="filled" onClick={() => rename(c)}>
                    Simpan
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <CategoryChip name={c.name} color={c.color} />
                    <span className="ml-2 text-[11px] text-ink-2">{c.shopCount} toko</span>
                  </div>
                  <div className="flex gap-1">
                    {PALETTE.slice(0, 4).map((p) => (
                      <button
                        key={p}
                        onClick={() => recolor(c, p)}
                        className="w-4 h-4 rounded-full border border-line"
                        style={{ backgroundColor: p }}
                        aria-label={`Ubah warna ke ${p}`}
                      />
                    ))}
                  </div>
                  <Button
                    variant="text"
                    onClick={() => {
                      setEditing(c);
                      setEditName(c.name);
                    }}
                  >
                    Ubah Nama
                  </Button>
                  <Button variant="text" onClick={() => remove(c)}>
                    <Icon name="trash" className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
