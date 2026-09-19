import { useEffect, useRef } from "react";

/**
 * Editor teks kaya tanpa dependensi (contentEditable + execCommand).
 *
 * Menghasilkan HTML ringkas (<p>, <b>, <i>, <u>, <ul>/<ol><li>, <br>) — sama
 * dengan yang dikirim ke marketplace, jadi pratinjau = tampilan pembeli.
 * execCommand memang usang tapi didukung semua browser & bebas dependensi
 * (repo ini bermasalah kalau `pnpm add` di server).
 */
export function RichText({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Set nilai awal / perubahan eksternal tanpa mengganggu kursor saat mengetik.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const v = value || "";
    if (el.innerHTML !== v) el.innerHTML = v;
  }, [value]);

  const cmd = (command: string, arg?: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand(command, false, arg);
    } catch {
      /* ignore */
    }
    onChange(el.innerHTML);
  };

  const emit = () => onChange(ref.current?.innerHTML ?? "");

  const Btn = ({
    command,
    arg,
    children,
    title,
  }: {
    command: string;
    arg?: string;
    children: React.ReactNode;
    title: string;
  }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        cmd(command, arg);
      }}
      className="h-7 min-w-[28px] px-2 rounded-md border border-line bg-white text-ink-2 hover:bg-canvas text-xs"
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-lg border border-line overflow-hidden bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-canvas px-2 py-1.5">
        <Btn command="bold" title="Tebal">
          <span className="font-bold">B</span>
        </Btn>
        <Btn command="italic" title="Miring">
          <span className="italic">I</span>
        </Btn>
        <Btn command="underline" title="Garis bawah">
          <span className="underline">U</span>
        </Btn>
        <span className="mx-1 w-px h-4 bg-line" />
        <Btn command="insertUnorderedList" title="Daftar poin">
          • Poin
        </Btn>
        <Btn command="insertOrderedList" title="Daftar bernomor">
          1. Nomor
        </Btn>
        <span className="mx-1 w-px h-4 bg-line" />
        <Btn command="removeFormat" title="Bersihkan format">
          Bersihkan
        </Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={emit}
        onBlur={emit}
        data-placeholder={placeholder || "Tulis deskripsi produk…"}
        className="min-h-[150px] max-h-[360px] overflow-auto px-3 py-2 text-sm text-ink leading-relaxed outline-none
          [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2
          [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-ink-3"
      />
    </div>
  );
}
