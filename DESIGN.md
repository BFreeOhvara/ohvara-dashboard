# Ohvara Design System — Tech Utility Direction

## Philosophy
Linear / Vercel / Raycast aesthetic. Dark, intentional, data-dense.
Every pixel earns its place. No decoration for decoration's sake.

---

## Color Tokens (ALL CSS custom properties — no hardcoded hex anywhere)

```css
--bg-base:       #0A0A0F;   /* outermost page background */
--bg-surface:    #13131A;   /* cards, panels, sidebar */
--bg-elevated:   #1C1C26;   /* inputs, dropdowns, hover states */
--bg-overlay:    #23233A;   /* modals, tooltips, command palette */

--accent:        #6C63FF;   /* primary CTA, active states, links */
--accent-hover:  #7C74FF;   /* hover on accent elements */
--accent-subtle: rgba(108, 99, 255, 0.10);  /* accent tint backgrounds */

--text-primary:  #F0F0F5;   /* headings, critical data */
--text-secondary:#8888AA;   /* body, labels, descriptions */
--text-muted:    #55556A;   /* placeholders, disabled, timestamps */

--border:        #2A2A3A;   /* all dividers, card outlines */
--border-hover:  #3A3A50;   /* border on hover */

--success:       #22C55E;
--warning:       #F59E0B;
--danger:        #EF4444;
--info:          #3B82F6;

--font-sans: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code', monospace;
```

---

## Typography

| Use | Size | Weight | Class |
|-----|------|--------|-------|
| Page title | 18px | 500 | `text-lg font-medium` |
| Section heading | 13px | 500 | `text-sm font-medium` |
| Body | 13px | 400 | `text-sm` |
| Label / meta | 11px | 500 uppercase | `section-label` |
| Stat number | 22px | 500 | `stat-value` |
| Mono data | 12px | 400 | `font-mono text-xs` |

**Rules:**
- Font weights: **400 and 500 ONLY**. Never 600, 700, or bold.
- Tracking: `-0.01em` on headings, `0.06em` uppercase on labels
- Numbers and data values: always `font-mono`

---

## Spacing

4px base unit. All spacing is a multiple of 4.

```
4px   →  p-1, gap-1
8px   →  p-2, gap-2
12px  →  p-3, gap-3
16px  →  p-4, gap-4
24px  →  p-6, gap-6
32px  →  p-8
```

---

## Radius

**Maximum: 10px**. No exceptions.

| Component | Radius |
|-----------|--------|
| Cards | `rounded-[8px]` |
| Buttons | `rounded-[6px]` |
| Inputs | `rounded-[6px]` |
| Badges | `rounded-[4px]` |
| Modals | `rounded-[10px]` |
| Avatars | `rounded-full` (circles only — not UI containers) |
| Spinners | `rounded-full` (circles only) |

---

## Components

### Cards
```
background:  var(--bg-surface)
border:      0.5px solid var(--border)
border-radius: 8px
padding: 16px
NO box-shadow
```

### Tables
```
Row dividers: 0.5px solid var(--border)
Row hover: background var(--bg-elevated)
NO zebra stripes
NO outer border
```

### Buttons
```
Height: 32px (sm) / 36px (md)
Radius: 6px
Primary: bg var(--accent), hover var(--accent-hover)
Secondary: ghost — border var(--border), hover bg-elevated
Danger: bg var(--danger)/10, text var(--danger), border var(--danger)/30
Font weight: 500 ONLY
```

### Inputs
```
Height: 36px
Radius: 6px
Background: var(--bg-base)
Border: 0.5px solid var(--border)
Focus: border var(--accent)
NO box-shadow
```

### Badges / Status Pills
```
Radius: 4px (NOT rounded-full)
Background: color/10 opacity
Border: color/20 opacity
Font: 11px, weight 500, uppercase
```

### Sidebar
```
Width: 200px
Background: var(--bg-surface)
Active item: 2px left border var(--accent) + bg-elevated
NO shadows on sidebar
```

---

## Anti-Rules — NEVER Do These

1. **No `box-shadow`** anywhere — not cards, not buttons, not modals
2. **No gradients** — no `background: linear-gradient(...)` or `radial-gradient`
3. **No `border-radius` > 10px** — `rounded-xl` (12px) and above are banned
4. **No `font-weight` 600 or 700** — `font-semibold` and `font-bold` are banned
5. **No hardcoded hex colors** — always use CSS custom properties
6. **No zebra striping on tables** — row hover only
7. **No emoji** in UI — use Tabler icons or Lucide
8. **No `border-radius` on tables** — table rows are rectangular
9. **No `rounded-full` on content containers** — only on true circles (avatars, spinners)

---

## Motion

```
Page enter:     opacity 0→1 + translateY(4px→0), 120ms ease-out
Tab transition: 120ms ease
Hover states:   100ms ease
Panel slide-in: translateX(100%→0), 180ms cubic-bezier(0.16, 1, 0.3, 1)
```

No bounces. No springs. No duration > 200ms in the UI flow.

---

## Icons

Use **Lucide** icons throughout (already installed).
Size: 14px in nav, 13px in buttons, 12px inline.
Color: inherit from text color — never hardcoded.
