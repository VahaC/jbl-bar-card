# Home tab layouts

The Home tab offers several layouts, picked per card in the config:

```yaml
type: custom:jbl-bar-card
layouts:
  home: classic # classic | remote | media
```

`src/tabs/home.ts` builds one `homeModel(ctx)` per render and passes it to the chosen layout
(`HOME_LAYOUTS[ctx.config.layouts.home]`). Every decision of the tab lives in
`src/tabs/home-model.ts`: what is shown, what is enabled or pending, which service a control calls,
how it waits for the bar to confirm, and which repeated taps it ignores. A layout only renders.

## Files a layout author owns

| Layout  | Renderer + CSS                     | Strings ("home_<name>.<key>")  | Tests                       |
|---------|------------------------------------|--------------------------------|-----------------------------|
| classic | `src/tabs/home-layouts/classic.ts` | `src/i18n/home.ts`             | `tests/home.test.ts`        |
| remote  | `src/tabs/home-layouts/remote.ts`  | `src/i18n/home_remote.ts`      | `tests/home-remote.test.ts` |
| media   | `src/tabs/home-layouts/media.ts`   | `src/i18n/home_media.ts`       | `tests/home-media.test.ts`  |

A layout file exports `render<Name>(ctx: TabContext, model: HomeModel): TemplateResult` and
`<name>Styles: CSSResult`. Do not edit `home-model.ts`, `home.ts` or another layout's files; if the
model lacks something, ask its owner. The layout may reuse `renderClassic(ctx, model)` from
`classic.ts` for parts it does not redesign. Strings in `home_<name>.ts` need the same keys in en, uk
and fr (`tests/i18n.test.ts`); the model's texts are already translated.

**CSS prefix rule.** Every selector in a layout's CSS starts with `.home-<name>` (for example
`.home-remote .pad`), and the layout's root element carries that class. All layouts' styles are
adopted by the card at once (`homeStyles` is an array), so an unprefixed selector would leak into
the other layouts. Classic is the exception: it keeps the tab's original unprefixed classes
(`.room`, `.volume`, `.chip`...). Use the shared classes from `src/styles.ts` (`.section`,
`.section-title`, `.seg`, `.chip`, `.icon-btn`, `.slider`, `.hint`, `.badge`, `.pending`...) and
only `--jbl-*` theme variables. Check light and dark, and a 300 px wide card.

## The model

```ts
import { homeModel } from "../home-model";
import type { HomeModel, HomeAction, HomeToggle } from "../home-model";
```

### Actions

Everything pressable is a `HomeAction`:

| Field     | Meaning                                                                       |
|-----------|-------------------------------------------------------------------------------|
| `id`      | Stable id inside the model (`volume_up`, `mute`, `night`, `pause`...)         |
| `key`     | Pending key (`home.volume`...). Several actions can share one                 |
| `label`   | Translated text: visible label, or aria-label + title of an icon button       |
| `icon`    | `mdi:` icon                                                                   |
| `enabled` | Render the control disabled when false                                        |
| `pending` | This action's command is on its way: add the `pending` class / `aria-busy`    |
| `reason`  | Why it is disabled, when known (standby hint, unreachable bar, unavailable mode) |
| `run()`   | Do it. Repeats that would undo a toggle are ignored by the model itself       |

`HomeToggle` (`kind: "switch"`) adds:

- `on`: the state to show, which is already the pending target while a change is on its way (power,
  mute, Smart mode, Night). `run()` still acts on the bar's reported state and ignores taps while
  pending, so a second tap never sends the toggle back.
- `name`: a fixed accessible name that does not change with the state ("Power", "Mute", "Night").

One rule for toggle labels: a control that says its state (`aria-pressed`, or `role="switch"` with
`aria-checked`) is named by `name`, and `label` (which may name the action: "Unmute", "Turn off")
is only its tooltip. A control without `aria-pressed` uses `label` as its text or aria-label. Never
pair the changing `label` with `aria-pressed` (a screen reader would say "Unmute, pressed").
`HomeButton` (`kind: "button"`) is a one-shot press.

### Fields

- `standby`, `standbyHint`: the bar is in standby, and the hint to show.
- `power?` (missing without a media_player): a `HomeToggle` that turns the bar on or off. It is the
  same control as the card header's power button (`powerToggle(ctx)`, pending key `header.power`),
  so a tap on either shows the pending target on both and blocks both until the bar confirms (30 s
  timeout). Enabled in standby; disabled with a reason while the bar is unreachable. Icon
  `mdi:power`, `label` "Turn on"/"Turn off", `name` "Power".
- `room`: `label` (group label), `docked`, `dockKnown`, `dockText` ("Rears docked"/"Rears detached"),
  `barName`, `hasRears`, `showRearPictures` (draw the rears apart), `barImage`, and
  - `rears[]` (left, right; empty without rears): `side`, `entity`, `level`, `low`, `name`, `label`
    (aria-label with the percent), `batteryIcon`, `batteryText` ("14%", the unknown dash, or
    undefined without a sensor), `batteryTitle` ("Low battery" or ""), `image`, `open()` (more-info);
  - `sub`: `name`, `bassLevel`, `bassText` ("Bass 3/5"), `label`, `enabled`, `image`, `open()`.
- `source?` (missing without a media_player): `title`, `current`, `otherText` (when the current
  source is not a button), `enabled`, `reason`, `options[]` with `value`, `label`, `active`,
  `pending`, `enabled`, `select()` (selecting the current source again does nothing).
- `volume?`: `title`, `max` (32), `current`, `shown` (drag value, else pending target, else
  current), `shownText`, `pending`, `muted` and `mutedText` (the bar's reported state), `reason`,
  the actions `down`, `up`, `mute` (a `HomeToggle`: `on`, `label` and `icon` follow the pending
  target), and `slider`.
- `modes?` (missing when the bar has none): `smart` (a `HomeToggle`, or the Standard mode
  `HomeButton` on remotes without the Smart switch) and `night`. A mode whose entity reports no
  state is disabled with a `reason`: the unreachable text, the standby hint in standby (drop it
  when the standby hint is already shown), else "Night is unavailable right now".
- `playback?` (missing while off, or with neither buttons nor track): `title` (title or artist),
  `subtitle` ("Artist · via Spotify"), `hasInfo`, raw `trackTitle`/`artist`/`app`, and `actions[]`
  (`HomePlaybackAction`: also `action` and `primary` for the big play/pause button).

### Preview, steppers, debounce, long press

- **Slider preview.** Call `volume.slider.preview(value)` on `input` (shows the value in
  `volume.shown`, sends nothing; it lives in `ctx.local("home").dragVolume`) and
  `volume.slider.commit(value)` on `change` (sends `volume_set` once, pending until the bar reports
  it, 60 s timeout). Draw the slider at `slider.value`, with `min`/`max`/`step`/`enabled`/`label`.
  A custom drag control (a dial, a vertical bar) uses the same two calls. When the slider becomes
  disabled mid-drag (standby, unreachable bar), the model drops the preview itself; the layout only
  drops its own gesture state and must not call `commit`.
- **Steppers.** `volume.up.run()` / `volume.down.run()` send one `volume_up`/`volume_down` and add
  to the pending target, so quick taps add up (14 → 15 → 16) without waiting for the bar.
- **Debounce.** The Home tab has none: the slider sends on release only, steppers send per tap.
- **Long press / hold to repeat.** The tab has no long-press action. A layout that wants hold to
  repeat may call `up.run()` on a timer while the pointer is down (one command per repeat; the model
  stops at 0 and 32), and must clear the timer on `pointerup`/`pointercancel`/`blur`. Keep the timer
  in `ctx.local("home_<name>")`, never in a module variable.
- **Forms.** The Home tab has no form state.

### Rules

- Never call `ctx.services` or `ctx.call` from a layout; use the model's actions.
- Live values (`volume.shownText`, track title) go into an `aria-live="polite"` element.
- Real `<button>`s for every action, with `label` as text or aria-label, and a `:focus-visible`
  outline.
- No module-level mutable state (a dashboard can show several cards).
- Do not give a layout's power control the class `power`: the shared `.power.on` rule in
  `src/styles.ts` styles the header button (the remote layout uses `.power-key`).
