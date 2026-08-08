import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Which builds of the scanner have been handed out, and which one is current.
 *
 * Deliberately read from the download directory rather than a table. The one
 * failure this area has actually had was a hard-coded URL surviving after the
 * file it named was deleted by a routine deploy, so the page went on offering a
 * download that 404s. A row in a database can go stale the same way; a file
 * that is not there cannot be offered.
 *
 * The history lives in releases.json beside the APKs, written by the release
 * script — which is the only thing that knows a build's versionName, since that
 * is inside the binary manifest and reading it here would mean shipping an APK
 * parser to answer a question the build already answered.
 */

export interface ApkRelease {
  versionName: string;
  versionCode: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  publishedAt: string;
  /** What changed, in the seller's language. Optional. */
  notes?: string;
}

export interface ApkReleaseView extends ApkRelease {
  /** Only the current build has one. Older entries are history, not offers. */
  url: string | null;
  isCurrent: boolean;
  /** True when the file named is no longer on disk. */
  missing: boolean;
}

@Injectable()
export class AppReleasesService {
  private readonly logger = new Logger(AppReleasesService.name);

  constructor(private readonly config: ConfigService) {}

  private dir(): string {
    return this.config.get<string>("APK_DIR") ?? "/opt/autotoko/downloads";
  }

  /**
   * Every build on record, newest first, with exactly one marked current.
   *
   * Current means "highest versionCode whose file is still on disk" rather
   * than "newest row". A build that was published and then withdrawn by
   * deleting the file should stop being offered, and saying so beats silently
   * handing out the one before it as though nothing happened.
   */
  async list(): Promise<{ current: ApkReleaseView | null; releases: ApkReleaseView[] }> {
    const dir = this.dir();

    let present = new Set<string>();
    try {
      present = new Set(
        (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".apk")),
      );
    } catch (e) {
      this.logger.warn(`Direktori APK tidak terbaca: ${(e as Error).message}`);
      return { current: null, releases: [] };
    }

    let history: ApkRelease[] = [];
    try {
      const raw = await readFile(join(dir, "releases.json"), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed as ApkRelease[];
    } catch {
      // No history yet. Fall through to the single-file view below rather
      // than reporting nothing: a download that works matters more than a
      // list of what came before it.
    }

    history.sort((a, b) => (b.versionCode ?? 0) - (a.versionCode ?? 0));

    const currentEntry = history.find((r) => present.has(r.fileName)) ?? null;

    const releases: ApkReleaseView[] = history.map((r) => ({
      ...r,
      missing: !present.has(r.fileName),
      isCurrent: currentEntry != null && r.versionCode === currentEntry.versionCode,
      url:
        currentEntry != null && r.versionCode === currentEntry.versionCode
          ? `/unduh/${r.fileName}`
          : null,
    }));

    if (releases.length) {
      return { current: releases.find((r) => r.isCurrent) ?? null, releases };
    }

    // Nothing recorded, but a file exists — the state right after this feature
    // ships, before the next release writes its first entry.
    const names = [...present];
    if (!names.length) return { current: null, releases: [] };
    const stats = await Promise.all(
      names.map(async (name) => ({ name, st: await stat(join(dir, name)) })),
    );
    stats.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    const best = stats[0]!;
    const only: ApkReleaseView = {
      versionName: "terpasang",
      versionCode: 0,
      fileName: best.name,
      sizeBytes: best.st.size,
      sha256: "",
      publishedAt: best.st.mtime.toISOString(),
      url: `/unduh/${best.name}`,
      isCurrent: true,
      missing: false,
    };
    return { current: only, releases: [only] };
  }

  /**
   * The link to hand out, refusing anything that is not the current build.
   *
   * An older APK still on disk is a support problem waiting to happen: it will
   * talk to an API that has moved on, and the failure surfaces as "the app is
   * broken" rather than "you are running last month's build".
   */
  async downloadUrlFor(versionCode: number): Promise<string> {
    const { current } = await this.list();
    if (!current || current.versionCode !== versionCode) {
      throw new NotFoundException(
        "Hanya versi terbaru yang bisa diunduh. Muat ulang halaman untuk melihat versi terkini.",
      );
    }
    return current.url!;
  }
}
