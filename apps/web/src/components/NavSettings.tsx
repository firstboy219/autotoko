import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { Button, Input, InlineAlert, Modal, Select } from "./ui";

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

export interface NavPrefs {
  groups: { id: string; label: string; items: string[] }[];
  counts: Record<string, number>;
  collapsed: string[];
}

const UNFILED = "";
const MAX_GROUPS = 12;

/** Stable enough for a per-user list of at most a dozen entries. */
function newId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Where the seller decides how the menu is arranged.
 *
 * Susunannya sepenuhnya milik pemiliknya. Kelompok otomatis yang dulu
 * menyusun dirinya sendiri dari menu yang paling sering dibuka sudah dibuang:
 * menu yang berpindah tempat mengikuti kebiasaan memaksa orang mencari ulang
 * letak yang kemarin sudah dihafal.
 *
 * Every edit is handed straight to the parent, which writes it back debounced.
 * There is no Save button because there is nothing to lose: the menu redraws as
 * the change is made, which is the whole confirmation needed.
 */
export function NavSettingsModal({
  nav,
  prefs,
  onClose,
  onChange,
}: {
  nav: NavItem[];
  prefs: NavPrefs;
  onClose: () => void;
  onChange: (next: NavPrefs) => void;
}) {
  const [newGroup, setNewGroup] = useState("");

  const groupOf = new Map<string, string>();
  for (const g of prefs.groups) for (const item of g.items) groupOf.set(item, g.id);

  function addGroup() {
    const label = newGroup.trim();
    if (!label || prefs.groups.length >= MAX_GROUPS) return;
    onChange({ ...prefs, groups: [...prefs.groups, { id: newId(), label, items: [] }] });
    setNewGroup("");
  }

  function renameGroup(id: string, label: string) {
    onChange({
      ...prefs,
      groups: prefs.groups.map((g) => (g.id === id ? { ...g, label } : g)),
    });
  }

  function removeGroup(id: string) {
    // The menu items in it are not deleted, they fall back to "Lainnya" — a
    // group is a folder, and throwing away a folder must not throw away what
    // was filed in it.
    onChange({ ...prefs, groups: prefs.groups.filter((g) => g.id !== id) });
  }

  function assign(path: string, groupId: string) {
    const groups = prefs.groups.map((g) => ({
      ...g,
      items: g.items.filter((i) => i !== path),
    }));
    const target = groups.find((g) => g.id === groupId);
    if (target) target.items = [...target.items, path];
    onChange({ ...prefs, groups });
  }

  return (
    <Modal
      open
      title="Atur Menu"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <Button variant="filled" icon="check" onClick={onClose}>
          Selesai
        </Button>
      }
    >
      <div className="space-y-5">
        <InlineAlert tone="info">
          Buat grup sesuai cara kerjamu, lalu pilih grup untuk tiap menu. Menu yang belum
          dimasukkan ke grup mana pun tetap tampil di bagian bawah.
        </InlineAlert>

        <div>
          <div className="text-xs font-medium text-ink-2 mb-2">Grup</div>
          {prefs.groups.length === 0 ? (
            <div className="text-xs text-ink-3 mb-2">
              Belum ada grup. Semua menu tampil dalam satu daftar seperti biasa.
            </div>
          ) : (
            <div className="space-y-1.5 mb-2">
              {prefs.groups.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <Input
                    value={g.label}
                    onChange={(e) => renameGroup(g.id, e.target.value)}
                    className="flex-1"
                  />
                  <span className="text-[11px] text-ink-3 w-16 text-right">
                    {g.items.length} menu
                  </span>
                  <button
                    onClick={() => removeGroup(g.id)}
                    aria-label={`Hapus grup ${g.label}`}
                    className="p-1.5 rounded-full text-ink-3 hover:text-red-600 hover:bg-red-50 transition"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addGroup();
                }
              }}
              placeholder="Nama grup baru — mis. Operasional Harian"
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={addGroup}
              disabled={!newGroup.trim() || prefs.groups.length >= MAX_GROUPS}
            >
              <Icon name="plus" className="w-3.5 h-3.5" />
              Tambah
            </Button>
          </div>
          {prefs.groups.length >= MAX_GROUPS && (
            <div className="text-[11px] text-ink-3 mt-1">Maksimal {MAX_GROUPS} grup.</div>
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-ink-2 mb-2">Menu</div>
          <div className="space-y-1">
            {nav.map((n) => (
              <div key={n.to} className="flex items-center gap-2">
                <Icon name={n.icon} size={16} className="text-ink-3 shrink-0" />
                <span className="flex-1 text-sm text-ink truncate">{n.label}</span>
                <Select
                  value={groupOf.get(n.to) ?? UNFILED}
                  onChange={(e) => assign(n.to, e.target.value)}
                  className="w-48"
                  disabled={prefs.groups.length === 0}
                >
                  <option value={UNFILED}>Lainnya</option>
                  {prefs.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
