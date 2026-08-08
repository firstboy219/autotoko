import { Link } from "react-router-dom";
import { useFetch } from "../lib/useFetch";
import { Icon } from "./Icon";
import { Badge, Card, CardHeader } from "./ui";

/**
 * What is not finished, and what it costs to leave alone.
 *
 * Every one of these was already findable by opening the right page and knowing
 * what to look for — which is the problem, because nobody opens a page to check
 * that nothing is wrong. So incomplete data sat until it broke a number
 * somewhere else: an unmapped scan is invisible to every per-shop figure, and an
 * unpriced material silently costs the products built from it at less than they
 * cost to make.
 *
 * Each card says the consequence, not the rule. "17 produk belum punya resep" is
 * a fact nobody acts on; "HPP-nya tidak bisa dihitung" is a reason to.
 */

interface Task {
  key: string;
  title: string;
  why: string;
  count: number;
  severity: "high" | "medium" | "low";
  href: string;
  samples: { id: string; label: string; detail?: string }[];
}

interface Pending {
  total: number;
  highCount: number;
  tasks: Task[];
}

const TONE = {
  high: "danger",
  medium: "warning",
  low: "neutral",
} as const;

const LABEL = {
  high: "Perlu segera",
  medium: "Sebaiknya dibereskan",
  low: "Kalau sempat",
} as const;

/** The compact form for the dashboard: one line, or nothing at all. */
export function PendingTasksAlert() {
  const data = useFetch<Pending>("/dashboard/pending-tasks");
  const d = data.data;
  if (data.loading || !d || d.total === 0) return null;

  const worst = d.tasks[0];

  return (
    <Link to="/pending" className="mb-5 block">
      <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3 transition hover:bg-warning/10">
        <Icon name="warning" className="h-5 w-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">
            {d.total} data belum lengkap
            {d.highCount > 0 && ` — ${d.highCount} perlu segera`}
          </div>
          {worst && (
            <div className="truncate text-xs text-ink-2">
              Terbesar: {worst.title} ({worst.count}). {worst.why}
            </div>
          )}
        </div>
        <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-ink-3" />
      </div>
    </Link>
  );
}

/** The full list. */
export function PendingTasksList() {
  const data = useFetch<Pending>("/dashboard/pending-tasks");
  const d = data.data;

  if (data.loading) {
    return (
      <Card>
        <div className="py-6 text-center text-sm text-ink-3">Memeriksa…</div>
      </Card>
    );
  }

  if (!d || d.total === 0) {
    return (
      <Card>
        <div className="py-8 text-center">
          <Icon name="checkCircle" className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
          <div className="font-medium text-ink">Semua data sudah lengkap</div>
          <div className="mt-1 text-sm text-ink-2">
            Tidak ada resi tanpa toko, bahan tanpa harga, atau produk tanpa resep.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {d.tasks.map((t) => (
        <Card key={t.key} padded={false}>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {t.title}
                <Badge tone={TONE[t.severity]}>{LABEL[t.severity]}</Badge>
              </span>
            }
            subtitle={t.why}
            action={
              <Link to={t.href}>
                <span className="inline-flex items-center gap-1 text-sm text-brand-ink hover:underline">
                  Perbaiki <Icon name="arrowRight" size={14} />
                </span>
              </Link>
            }
          />
          <div className="px-4 pb-4">
            <div className="mb-2 text-sm text-ink-2">
              <strong className="text-ink">{t.count}</strong> item
            </div>
            {/* Examples rather than a count alone: a number is something to
                postpone, a name is something to go and look at. */}
            <ul className="space-y-1 text-sm">
              {t.samples.map((s) => (
                <li key={s.id} className="flex items-baseline gap-2">
                  <span className="text-ink">{s.label}</span>
                  {s.detail && <span className="text-xs text-ink-3">{s.detail}</span>}
                </li>
              ))}
              {t.count > t.samples.length && (
                <li className="text-xs text-ink-3">
                  …dan {t.count - t.samples.length} lainnya
                </li>
              )}
            </ul>
          </div>
        </Card>
      ))}
    </div>
  );
}
