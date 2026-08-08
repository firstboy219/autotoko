import { Layout } from "../components/Layout";
import { useFetch } from "../lib/useFetch";
import { dateShort } from "../lib/fmt";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  InlineAlert,
  PageHeader,
} from "../components/ui";

/**
 * Which build of the scanner people should be running.
 *
 * Only the current one can be downloaded. An older APK still reachable is a
 * support problem waiting to happen: it talks to an API that has moved on, and
 * the failure arrives as "the app is broken" rather than "you are on last
 * month's build".
 */

interface Release {
  versionName: string;
  versionCode: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  publishedAt: string;
  notes?: string;
  url: string | null;
  isCurrent: boolean;
  missing: boolean;
}

interface Releases {
  current: Release | null;
  releases: Release[];
}

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AplikasiVersi() {
  const data = useFetch<Releases>("/resi/app/releases");
  const current = data.data?.current ?? null;
  const releases = data.data?.releases ?? [];

  const absolute = current ? `${window.location.origin}${current.url}` : "";

  /**
   * The message that goes to the packing team.
   *
   * The version is in the text on purpose: the commonest support question is
   * "which one do I have", and a bare link cannot answer it after the fact,
   * once it has been forwarded twice and the page has moved on.
   */
  const waText = current
    ? `*AutoToko Scan Resi ${current.versionName}*\n\n` +
      `Silakan pasang versi terbaru aplikasi scan resi:\n${absolute}\n\n` +
      `Ukuran ${mb(current.sizeBytes)}. ` +
      `Kalau sudah ada versi lama di HP, pasang saja di atasnya — data tidak hilang.` +
      (current.notes ? `\n\nYang baru: ${current.notes}` : "")
    : "";

  return (
    <Layout title="Versi Aplikasi">
      <PageHeader
        title="Versi Aplikasi"
        subtitle="Riwayat build aplikasi scan resi. Hanya versi terbaru yang bisa diunduh."
      />

      {data.loading ? (
        <Card>
          <div className="py-6 text-center text-sm text-ink-3">Memuat…</div>
        </Card>
      ) : !current ? (
        <Card>
          <EmptyState
            icon="package"
            title="Belum ada aplikasi yang dipublikasikan"
            description="Setelah build APK diterbitkan ke server, versinya muncul di sini."
          />
        </Card>
      ) : (
        <>
          <Card className="mb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-lg font-semibold text-ink">
                    Versi {current.versionName}
                  </span>
                  <Badge tone="success">Terbaru</Badge>
                </div>
                <div className="text-sm text-ink-2">
                  Terbit {dateShort(current.publishedAt)} · {mb(current.sizeBytes)}
                  {current.versionCode ? ` · build ${current.versionCode}` : ""}
                </div>
                {current.notes && (
                  <div className="mt-2 max-w-prose text-sm text-ink-2">{current.notes}</div>
                )}
                {current.sha256 && (
                  <div className="mt-2 break-all font-mono text-[11px] text-ink-3">
                    SHA-256 {current.sha256}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <a href={current.url ?? "#"} download>
                  <Button variant="filled">
                    <Icon name="download" className="h-4 w-4" />
                    Unduh APK
                  </Button>
                </a>
                {/* api.whatsapp.com rather than wa.me: it opens the desktop
                    app when one is installed and falls back to web otherwise,
                    which is what a seller on a laptop actually has. */}
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button variant="outline">
                    <Icon name="whatsapp" className="h-4 w-4" />
                    Bagikan ke WhatsApp
                  </Button>
                </a>
                <Button
                  variant="text"
                  onClick={() => {
                    void navigator.clipboard.writeText(absolute);
                  }}
                >
                  Salin tautan
                </Button>
              </div>
            </div>
          </Card>

          <Card padded={false}>
            <CardHeader
              title={`Riwayat Versi (${releases.length})`}
              subtitle="Versi lama tidak bisa diunduh — aplikasi lama bicara dengan API yang sudah berubah."
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th className="px-4 py-2 font-medium">Versi</th>
                    <th className="px-4 py-2 font-medium">Terbit</th>
                    <th className="px-4 py-2 text-right font-medium">Ukuran</th>
                    <th className="px-4 py-2 font-medium">Catatan</th>
                    <th className="px-4 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {releases.map((r) => (
                    <tr
                      key={`${r.versionCode}-${r.fileName}`}
                      className="border-b border-line/60 last:border-0"
                    >
                      <td className="px-4 py-2 font-medium text-ink">
                        {r.versionName}
                        {r.versionCode ? (
                          <span className="ml-1 text-[11px] text-ink-3">({r.versionCode})</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-ink-2">
                        {dateShort(r.publishedAt)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                        {mb(r.sizeBytes)}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-2">{r.notes ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        {r.isCurrent ? (
                          <Badge tone="success">Terbaru</Badge>
                        ) : r.missing ? (
                          <Badge tone="neutral">Sudah dihapus</Badge>
                        ) : (
                          <Badge tone="neutral">Versi lama</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {releases.length === 1 && releases[0]!.versionCode === 0 && (
            <div className="mt-4">
              <InlineAlert tone="info">
                Riwayat versi mulai dicatat dari rilis berikutnya. Yang tampil sekarang adalah
                berkas APK yang ada di server.
              </InlineAlert>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
