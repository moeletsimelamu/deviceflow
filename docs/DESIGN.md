# Design system

DeviceFlow is a working tool for people who spend their day in it: technicians,
stock controllers and service administrators. The design aims for **calm,
dense and precise** rather than decorative. Think of a well-kept workshop ledger,
not a marketing dashboard.

## Principles

1. **Data first.** Tables and forms are the product. Chrome stays quiet, and colour
   carries meaning.
2. **One accent, used sparingly.** Deep petrol teal marks primary actions, focus and
   the current location. Everything else is warm neutral.
3. **Never colour alone.** Every status shows a text label; colour reinforces it.
4. **Honest states.** Every view designs its loading, empty, error and success states.
   Features that do not exist yet are labelled as planned, never faked.
5. **Consequences are explicit.** Irreversible or high-impact actions name the record
   and the consequence before they run.

## Tokens

Defined as CSS variables in `apps/web/src/styles/index.css` and exposed to Tailwind
through `@theme`. Components use semantic names (`bg-surface`, `text-ink-muted`,
`bg-danger-bg`), never raw hex values, so a future dark theme only redefines the
variables.

| Group    | Tokens                                                       | Values                                                                                  |
| -------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Surfaces | canvas, surface, sunken, sidebar                             | `#f6f5f3`, `#ffffff`, `#efeeeb`, `#1c1917`                                              |
| Lines    | line, line-strong                                            | `#e2e0dc`, `#c9c6c0`                                                                    |
| Text     | ink, ink-muted, ink-subtle, ink-inverse                      | `#1c1917`, `#57534e`, `#78716c`, `#fafaf9`                                              |
| Accent   | accent, accent-hover, accent-soft, accent-bright             | `#115e59`, `#134e4a`, `#e6f2f0`, `#5eead4`                                              |
| Status   | success, warning, danger, info, neutral (each `-bg` / `-fg`) | Soft background with a strong foreground; foregrounds meet WCAG AA on their backgrounds |

**Typography:** IBM Plex Sans (400/500/600) for UI and IBM Plex Mono for identifiers
(asset tags, serials, references, request IDs). Both are self-hosted through
`@fontsource`, with no third-party font CDN. The base size is 14px. Use tabular
numerals (`.tabular`) wherever numbers line up in columns.

**Spacing and shape:** 4px grid; radii 4/6/10px; borders rather than shadows, with
shadows reserved for overlays (dialogs, menus).

## Components (`apps/web/src/design`)

| Component                               | Use                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                | Variants: `primary` (one per view), `secondary`, `ghost` (row actions), `danger`. Shows a spinner and blocks double-submit while loading. |
| `TextField`, `SelectField`              | Label, required marker, hint and error, wired with `aria-invalid` and `aria-describedby`.                                                 |
| `FilterInput`, `FilterSelect`           | Compact controls for filter bars. Each must have an `aria-label`.                                                                         |
| `Badge`                                 | Status and role indicators: text always present; optional dot.                                                                            |
| `Dialog`, `ConfirmDialog`               | Radix-based: focus trap, Escape to close, labelled. Confirmations use "Verb record?" titles and a consequence sentence.                   |
| `TableSkeleton`, `Skeleton`, `Spinner`  | Loading states that keep the layout stable.                                                                                               |
| `EmptyState`, `ErrorState`, `FormError` | Empty and failed states. Errors show the API request ID as a support reference.                                                           |
| `PageHeader`, `Panel`, `table`          | Page structure and table styling.                                                                                                         |
| `PanelHeader`, `DetailList`             | A panel's title bar; label/value pairs on record pages (empty values show an em dash).                                                    |
| `Pagination`                            | "1–20 of 134" with previous and next buttons under every list.                                                                            |
| `TextAreaField`, `CheckboxField`        | Multi-line notes and single options, with the same label, hint and error wiring as `TextField`.                                           |
| `Combobox`                              | Generic searchable selector (ARIA combobox: arrow keys, Enter, Escape). The caller searches, usually on the server.                       |
| `CustomerPicker`, `DevicePicker`        | Customer and device selectors built on `Combobox`.                                                                                        |

## Status tones (reserved meanings)

| Tone    | Meaning                                 | Examples                        |
| ------- | --------------------------------------- | ------------------------------- |
| success | Done, healthy, active                   | Active user, completed repair   |
| warning | Needs attention soon                    | Awaiting approval, low stock    |
| danger  | Blocked, failed, destructive            | Rejected quote, out of stock    |
| info    | In progress, informational              | In repair, technician role      |
| accent  | The organisation's own or primary items | Administrator role              |
| neutral | Inactive, archived, unknown             | Deactivated user, retired asset |

Each status maps to exactly one tone in a single lookup table
(`apps/web/src/lib/status.tsx`), so a status always looks the same everywhere:

| Asset status | Tone    |
| ------------ | ------- |
| In stock     | neutral |
| Active       | success |
| In repair    | info    |
| Refurbishing | warning |
| Retired      | neutral |
| Disposed     | danger  |

| Repair status                            | Tone    | Why                          |
| ---------------------------------------- | ------- | ---------------------------- |
| Submitted                                | neutral | Nothing has happened yet     |
| Assigned                                 | info    | Work under way               |
| Diagnosing                               | info    |                              |
| Awaiting approval                        | warning | Waiting on the customer      |
| Approved                                 | accent  | Ready for the technician     |
| Quote rejected                           | danger  | Blocked                      |
| In repair                                | info    |                              |
| Awaiting parts                           | warning | Waiting on a supplier        |
| Quality check                            | accent  |                              |
| Completed                                | success | Done, waiting for collection |
| Closed / Returned unrepaired / Cancelled | neutral | Finished                     |

Quotations: draft neutral, issued warning, approved success, rejected danger,
superseded and withdrawn neutral.

Stock: in stock success, low stock (at or below the reorder level) warning, out of
stock danger. The list shows a badge only when stock needs attention. Stock movements:
received success, adjusted up and returned from repair info, adjusted down warning,
used in repair neutral. Units added are shown in green with a `+`; units removed in
the normal ink colour with a `−`.

The portal uses the same tones with customer
wording (`PORTAL_REPAIR_STATUS_LABELS`, for example "Quote waiting for your approval").

## Layout

- Staff app: a fixed dark sidebar (240px) with grouped navigation. Below 768px it
  becomes a slide-in drawer. Content is capped at 1280px.
- Tables scroll horizontally inside their panel on small screens; the page itself
  never scrolls sideways. Less important columns (for example the serial in the
  portal) are hidden on phones.
- Dialogs are capped to the viewport. Tall forms scroll inside the dialog, and the
  footer with the primary action stays visible.
- Record pages (asset, customer) use a main column plus a 340px side column for
  ownership, warranty, contacts and portal users. Table-heavy pages switch to two
  columns only on wide screens.
- The customer portal uses a lighter top-bar layout, capped at 1080px, with no
  sidebar.
- The sign-in page is split into a brand panel and a form, and collapses to the form
  alone on small screens.

## Accessibility checklist

- Every input has a visible label. Errors are announced (`role="alert"`) and linked
  with `aria-describedby`.
- A visible focus ring (`:focus-visible`, teal, 2px offset) on all interactive elements.
- "Skip to content" link, landmarks (`nav`, `main`) and headings in order.
- Respects `prefers-reduced-motion`.
- Colour is never the only signal.

## Repair screens

- The job page leads with the status and the actions the signed-in user can take
  now (computed from the shared state machine), then a one-line "Next" that says
  what has to happen and who does it.
- Consequential actions name the record and the amount: issuing a quotation,
  approving it, declining it, cancelling a job, removing labour.
- The quotation editor shows line totals, VAT and the total as you type, using the
  same money functions as the API.
- In the portal, a quotation waiting for approval is the first thing on the repair
  page and is announced on the repairs list.

## Inventory screens

- **Parts** and **Stock movements** are two tabs of one Inventory section. A
  warning bar counts the parts at or below their reorder level and filters to them in
  one click; the dashboard shows the same list for anyone who can read stock.
- The part page leads with three figures (in stock, average cost, stock value), then
  the part's ledger with the balance after each movement. Ledger rows cannot be
  edited, and the page says so.
- Forms state the effect before you confirm: "Stock goes from 3 to 5". Removing stock
  is a red (danger) button and needs a reason; archiving is refused while the part
  still has stock, with the way out spelled out.
- On a repair job, the Parts panel lists what is still in use (used minus returned)
  with its cost, a Return action per part, and the full use-and-return history behind
  a disclosure. Inventory managers see this panel and the status history only.
- The part picker shows stock and shelf for each match, so a technician sees before
  choosing that a part is out.
- On phones the ledger folds the movement type and date into the part cell, so no
  table scrolls sideways.

## Reports and charts

- **One filter row** above everything it scopes (the date range). A new range keeps
  the previous figures on screen, dimmed, until the new ones arrive.
- **Headline numbers are stat tiles**, not charts: a label, the value and one line of
  context. No tile shows a change against a previous period yet.
- **Columns over time** (jobs booked in and completed; billed revenue) and
  **horizontal bars** for breakdowns (open jobs by status in workflow order, devices
  by status, most used parts largest first). Never two y-axes: revenue and job counts
  are separate charts.
- **Marks:** at most 24px thick, 4px rounded at the data end and square at the
  baseline, a 2px gap between neighbouring columns, solid hairline gridlines.
- **Colour:** series colours `--df-chart-1` (blue `#2a78d6`) and `--df-chart-2`
  (orange `#eb6834`), in that fixed order, validated on the white surface
  (colour-blind separation dE 24.7, both above 3:1 contrast). A single-series chart
  uses `--df-chart-1` and has no legend box; two series always have a legend. Text
  never takes a series colour.
- **Every value is reachable without the chart:** hover and keyboard focus show the
  same tooltip beside the column (never over it), each period is a focusable element
  with a full text label, and every chart card has a "Show table" view.
- **Phones:** the time axis shows only the first and last period, and tables never
  scroll sideways.
