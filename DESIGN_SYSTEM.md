# AutoToko Design System — "Clean like Google"

Target aesthetic: Google Workspace (Gmail / Drive / Cloud Console).
Calm, generous whitespace, restrained colour, hairline borders instead of
heavy shadows, strong typographic hierarchy. Colour is used for *meaning*
(status, brand action), never for decoration.

## Hard rules (do not violate)

1. **Never** use emoji as UI iconography. Use `<Icon name="..." />`.
2. **Never** use `font-extrabold`. Max weight is `font-semibold` (600),
   `font-medium` (500) for most UI text.
3. **Never** use text smaller than `text-xs` (12px). The old code used
   `text-[10px]`/`text-[11px]` everywhere — that is being removed.
4. Card/surface = `<Card>`. Do not hand-roll `bg-white rounded-xl border`.
5. Buttons = `<Button>`. Do not hand-roll `<button className="px-4 py-2 rounded-md bg-brand...">`.
6. Every list/table MUST handle three states: loading (`<Skeleton>`),
   empty (`<EmptyState>`), and populated. No bare "Memuat…" text.
7. Layouts must be responsive: no fixed `grid-cols-4`; use
   `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. Tables that can overflow get
   `<div className="overflow-x-auto">`.

## Tokens

Page background `bg-canvas` (#f8f9fa) · Surface `bg-white`
Border `border-line` (#e0e3e7) · Text `text-ink` (#202124),
secondary `text-ink-2` (#5f6368), tertiary `text-ink-3` (#80868b)

Radius: `rounded-lg` (8px) for cards/inputs, `rounded-full` for pills/nav items.
Elevation: `shadow-e1` (resting card), `shadow-e2` (menus/popovers). Cards
default to a hairline border and NO shadow; shadow only on hover/overlay.

Brand colour stays admin-configurable (`--c-brand`, a light green) — it is
the *action* colour. Text on brand surfaces is `text-onbrand` (dark).

Status colours: success `emerald`, warning `amber`, danger `red`,
info `blue`. Use the `<Badge tone="...">` component, never raw classes.

## Typography

Font: **Roboto** (loaded in index.html — the old config referenced
Plus Jakarta Sans but never loaded it, so everything silently rendered in
system-ui).

- Page title: `text-[22px] font-normal text-ink` (Google uses *light* page
  titles, not bold)
- Section/card title: `text-sm font-medium text-ink`
- Body: `text-sm text-ink`
- Secondary/meta: `text-xs text-ink-2`
- Numbers in stat tiles: `text-2xl font-normal` (weight comes from size)
- Table header: `text-xs font-medium text-ink-2` — NOT uppercase-tracking-wide

## Components available (`src/components/ui.tsx`)

```tsx
<PageHeader title="..." subtitle="..." actions={<Button>…</Button>} />
<Card>…</Card>                          // padded surface
<Card.Header title subtitle action />   // titled section header w/ divider
<Button variant="filled|tonal|outline|text|danger" size="sm|md" icon="plus" loading>
<Badge tone="neutral|success|warning|danger|info|brand">
<Field label hint error>…</Field>       // form field wrapper
<Input> <Select> <Textarea>             // styled form controls
<Table> <THead> <TR> <TH> <TD>          // table primitives w/ correct spacing
<EmptyState icon title description action />
<Skeleton className /> <SkeletonRows n cols />
<StatTile label value sub icon trend />
<Modal open onClose title>…</Modal>
<Toast>                                  // via useToast()
```

`<Icon name="..." />` — stroke icons, 20px default. Available names are in
`components/Icon.tsx`; add new ones there rather than inlining SVG.

## Interaction / UX requirements

- Destructive actions: confirm via `<Modal>`, never `window.confirm()`.
- Async buttons: use `loading` prop (spinner + disabled), never swap the
  label to "…".
- Forms: inline validation with `<Field error>`, disable submit while invalid.
- Show a `<Toast>` on successful mutations instead of silent reloads.
- Long tables: sticky header, zebra-free (use hairline row dividers),
  right-align numeric columns, `tabular-nums` on money.
- Keep all Indonesian copy exactly as-is unless it is genuinely wrong; this
  is a visual/UX pass, not a copy rewrite.
