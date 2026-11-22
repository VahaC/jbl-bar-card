# Sound tab layouts

The Sound tab offers several layouts, picked per card with `layouts: { sound: classic | mixer | cards }`.
Every layout renders the same data model, so all of them behave the same: same pending keys,
debounce, service calls, error handling and refusals. A layout decides how things look, never what
they do.

## Files

| What | Where |
| --- | --- |
| Model (all decisions) | `src/tabs/sound-model.ts`: `soundModel(ctx)` |
| Dispatch + exported `soundStyles` | `src/tabs/sound.ts` |
| A layout | `src/tabs/sound-layouts/<name>.ts`: `renderSound<Name>(ctx, model)` and `sound<Name>Styles` |
| Its strings | `src/i18n/sound_<name>.ts`, looked up as `ctx.t("sound_<name>.<key>")` (en, uk and fr with the same keys) |
| Its tests | `tests/sound-<name>.test.ts` |

`classic` lives in `src/tabs/sound-layouts/classic.ts` and keeps the DOM the tab always had
(`tests/sound.test.ts`). `mixer` (a console of vertical faders) and `cards` (a grid of value
cards with a draggable EQ curve) are full layouts with their own tests. A layout author edits only
their own three files; the model and `sound.ts` stay shared.

**CSS prefix rule.** Every selector of a new layout starts with `.sound-<name>` (the layout's root
element carries that class), so layouts never style each other. Use the `--jbl-*` theme variables
and the shared classes from `src/styles.ts` (`.section`, `.seg`, `.stepper`, `.badge`, `.hint`,
`.btn`, `.slider`...); light and dark must both work, and the layout must hold at 300 px. Classic's
older selectors (`.sound`, `.eq-*`, `.sound-row`) predate the rule and are not to be reused.

## Using the model

```ts
export function renderSoundMixer(ctx: TabContext, model: SoundModel): TemplateResult {
  if (model.empty) return html`<div class="sound-mixer hint">${model.emptyText}</div>`;
  ...
}
```

Build nothing from `ctx.hass` or `ctx.entities` yourself: everything is in `model`. Use `ctx` only
for your own strings (`ctx.t("sound_mixer.…")`) and `ctx.moreInfo(entity)`. The model is rebuilt
on every render; its functions act on that render's context.

### `SoundModel`

| Field | Meaning |
| --- | --- |
| `levels: SoundLevel[]` | bass, center, atmos, rear, only those that exist, in this order |
| `audioSync?: SoundStepper` | audio sync in ms |
| `eq?: SoundEq` | Front EQ; undefined when there is no preset, status or band entity |
| `bassOffset?: SoundBassOffset` | bass offset in dB (classic shows it inside the EQ block, or alone when `eq` is missing) |
| `empty`, `emptyText` | nothing at all to show, and the text for it |

### Shared shapes

- `SoundAction { key, label, icon, enabled, pending, reason?, run() }`: something to press.
  `key` is the pending key of the control (good as a DOM id); render disabled when `!enabled`.
- `SoundBadge { value, label, tone }`: a status; `tone` is `ok | info | warn | err | neutral`
  (map it onto `.badge.ok` ... ; neutral is the plain badge).

### Reasons for disabled controls

Every control that can be disabled (`SoundLevel`, `SoundStepper`, `SoundBassOffset`,
`SoundPreset`, `SoundBand`) has `enabled` plus `reason?: string` and `reasonKind?:
SoundReasonKind`, both set only while `enabled` is false. Write the reason out (or link it with
`aria-describedby`); never leave a disabled control unexplained. `reasonKind` tells you what kind
of reason it is, so you can group or filter:

| `reasonKind` | Meaning | Example text |
| --- | --- | --- |
| `blocked` | a condition of this control only | "Take both rear speakers off the soundbar…", "Audio sync works only with the TV or HDMI input." |
| `busy` | something else is on its way | "The preset is being applied. The EQ unlocks once it is set." |
| `unreachable` | the soundbar does not answer | "The soundbar is unreachable." |
| `standby` | the bar is off and does not report it | "Turn the soundbar on to change this." |
| `unavailable` | the bar is on but does not report it now | "The soundbar does not report this setting right now." |

The general kinds (`unreachable`, `standby`, `unavailable`) usually hit many controls at once with
the same text: group them (mixer writes one note per text) or leave them to the card header
(classic shows only `blocked` level reasons, as it always did).

### Drag previews

`SoundLevel`, `SoundStepper`/`SoundBassOffset` and `SoundBand` can be dragged as sliders with the
same three calls; the preview is model state, so a re-render during the drag keeps it (bind the
slider value with `live()`):

- `preview(value)` on `input`: shows the value (`shown`/`value`, `valueText`, `shortText`,
  `extra` follow it) and sets `dragging`; nothing is sent. Ignored while disabled (and on audio
  sync while `locked`). A level or stepper dragged back onto its settled value drops the preview,
  because a range input fires no `change` then.
- `commit(value)` on `change` / pointer up: drops the preview and sends the value debounced, like
  `choose` / `set`.
- `cancel()` on `pointercancel` or lost pointer capture: drops the preview and sends nothing (a
  value queued before the drag still goes out).

The model also drops a preview by itself once the control becomes disabled.

### `SoundLevel` (a select shown as choices)

`role, key, entity, label, options[] { value, label, shortLabel, active, pending }, current?,
shown?, shownIndex, extra?, enabled, pending, dragging, reason?, reasonKind?, choose(option),
preview(option), commit(option), cancel()`

- `active` = what the bar reports; `pending` on an option = chosen, not confirmed yet. Show both.
- `shortLabel` = `label`, shortened where it does not fit a narrow strip (uk "Серед." for
  "Середньо", fr "Moy." for "Moyenne"); keep the full `label` in `aria-valuetext` / `title`.
- `shown`/`shownIndex` = the drag preview, else the target if there is one, else the current
  option (for a slider over the levels, map positions to `options[i].value`).
- `extra` = text for next to the title (center: "+2.4 dB" / "Original"); follows `shown`.
- `choose(option)` is debounced (`SOUND_TIMING.levelMs` = 350 ms); call it on every click or slider
  step, the latest choice is sent, one at a time. Choosing the settled option does nothing.

### `SoundStepper` (audio sync) and `SoundBassOffset`

`key, entity, label, min, max, step, current?, value?, valueText, shortText, enabled, reason?,
reasonKind?, pending, dragging, locked?, hint?, less, more, set(value), preview(value),
commit(value), cancel()`; bass offset adds `status?: SoundBadge` and `error?: string`.

- `less`/`more` are `SoundAction`s with icons `mdi:minus`/`mdi:plus` and enabled state at the
  range ends; while the whole control is disabled they carry its `reason` too.
- `enabled` is false while the value is unknown or the entity unavailable.
- `set(value)` snaps to `step`, clamps to `[min, max]` and sends debounced (audio sync 900 ms,
  bass offset 400 ms). Use it for a direct value; use `preview`/`commit` for a slider.
- `valueText` has the unit ("40 ms", "+0.5 dB"); `shortText` is the number only ("40", "+0.5")
  for a narrow strip that writes the unit elsewhere.
- `locked` is set only on audio sync. While it is true the bar is re-syncing: render the buttons
  with `aria-disabled="true"` (keep them focusable, not `disabled`); `run()`/`set()` ignore input.
- Put `valueText` in an `aria-live="polite"` element.
- `hint` (audio sync): "needs TV/HDMI", "turn the bar on" or "re-syncing, up to a minute". Show
  `reason ?? hint` to cover the unreachable case too (classic shows `hint` only).

### `SoundEq`

`title, status?: SoundBadge, reason?, preset?: SoundPreset, bands: SoundBand[], bandsReason?,
bandsReasonKind?, pending`

- `reason` = why the EQ is waiting or needs a reset (from the bar), not a disabled reason.
- `bandsReason` is set when every band is disabled for the same reason: one line for the whole EQ
  (cards writes it under the graph in place of the drag hint).
- `pending` = a preset is applying or a band is queued or on its way: one spinner for the EQ.

`SoundPreset`: `key, entity, label, options[] { value, label, selected }, current?, shown?,
placeholder?, enabled, reason?, reasonKind?, pending, busy, busyReason?, select(option): boolean,
reset?: SoundAction`

- `placeholder` is set when no preset matches ("Custom", or the dash when unavailable): offer it as
  a disabled empty choice.
- `select(option)` returns `false` when the choice was ignored (busy, unknown, unchanged). A native
  `<select>` must then be set back to `shown`. Render `aria-busy` from `busy`, and `busyReason`
  (the preset is applying, or bands are being sent) as its explanation, e.g. a `title`.
- `reset` appears when the EQ reports `reset_needed`; it applies the `original` preset.

`SoundBand`: `index, key, entity, label, ariaLabel, min, max, step, current?, value?, position,
shortText, valueText, dragging, pending, enabled, reason?, reasonKind?, preview(value),
commit(value), cancel()`

- Drag: see "Drag previews". `commit` snaps, then sends debounced (`SOUND_TIMING.eqMs` = 400 ms).
  Bands are sent one after another because each band write sends the whole curve.
- `position` is where to put the slider thumb; `shortText` ("-1.5") is for a label, `valueText`
  ("-1.5 dB") for `aria-valuetext`, `ariaLabel` for the slider's name.
- `enabled` is false while a preset is being applied (`reasonKind: "busy"`) or the band is
  unavailable.

### Not in this tab

The Sound tab has no long-press controls and no forms, so the model has no helpers for them.

### Timing in tests

`SOUND_TIMING` (exported from `sound-model.ts` and re-exported from `sound.ts`) holds the debounce
delays; tests set them to 0 in `beforeEach` and restore them after.
