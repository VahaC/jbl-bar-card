# Timers tab layouts

The Timers tab offers several layouts, chosen per card:

```yaml
type: custom:jbl-bar-card
layouts:
  timers: classic   # classic | kitchen | compact
```

`src/tabs/timers.ts` builds the model once per render and hands it to the chosen layout:

```ts
const model = timersModel(ctx);           // src/tabs/timers-model.ts
switch (ctx.config.layouts.timers) { ... } // renderClassic / renderKitchen / renderCompact
```

Every decision (what is shown, when an action may run and why not, what a service call sends,
pending keys, form state and validation, long-press and double-tap guards) lives in
`timersModel(ctx)`. A layout only renders the model: it never calls `ctx.call`, `ctx.services`,
`ctx.local` or `ctx.confirm` itself. Build the model in the render, never keep it across renders:
its actions capture that render's state, like event handlers do.

## File ownership

| What                 | File                                     |
| -------------------- | ---------------------------------------- |
| Model (shared)       | `src/tabs/timers-model.ts`               |
| Dispatcher, styles   | `src/tabs/timers.ts`                     |
| Classic layout       | `src/tabs/timers-layouts/classic.ts`     |
| Layout `<name>`      | `src/tabs/timers-layouts/<name>.ts`      |
| Layout strings       | `src/i18n/timers_<name>.ts`, looked up as `t("timers_<name>.<key>")`; en, uk and fr keep the same keys |
| Layout tests         | `tests/timers-<name>.test.ts`            |
| Model tests          | `tests/timers-model.test.ts`             |

A layout file exports `render<Name>(ctx, model): TemplateResult` and `<name>Styles` (a `css`
block). `timersStyles` in `src/tabs/timers.ts` lists every layout's styles; the card includes them
all. Strings the model already returns (labels, aria labels, hints, errors) come from
`src/i18n/timers.ts`; add only the layout's own words to `timers_<name>.ts`.

**CSS prefix rule.** Every selector of a layout starts with `.timers-<name>` (its root element
carries that class), so layouts never style each other. The classic layout's root is `.timers` and
its selectors start with `.timers ` (plus the `jbl-bar-countdown.t-*` rules). Use the shared
classes from `src/styles.ts` (`.section`, `.btn`, `.chip`, `.seg`, `.stepper`, `.badge`, `.hint`,
`.list-item`...) and only `--jbl-*` theme variables, so light and dark both work.
A layout must hold at 300 px (`@container (max-width: 340px)`).

## The model

`timersModel(ctx): TimersModel` returns three optional sections; each is `undefined` when its
entity does not exist on this remote (older remote, disabled entity):

```ts
interface TimersModel {
  timers?: TimersSection;     // sensor timers
  messages?: MessagesSection; // sensor messages
  clock?: ClockSection;       // switch display_clock (+ select display_clock_when)
}
```

### Building blocks

```ts
interface TimersAction {   // a button
  key: string;             // pending key (quick starts share "timers.start")
  label: string;           // short visible text: "Stop", "+1 min", "5 min"
  ariaLabel: string;       // accessible name naming the item: "Stop PIZZA" (use as aria-label and title)
  icon: string;            // mdi icon
  enabled: boolean;        // false: render disabled
  pending: boolean;        // the call is on its way: show a spinner / .pending
  reason?: string;         // why it is disabled (show it, or put it in a title)
  danger?: boolean;        // destructive (stop all, clear all; they confirm by themselves)
  run(): void;             // safe to call any time: re-checks pending, guards and validation
}
interface TimersToggle { on; label; icon; hint?; toggle() }                     // role="switch"
interface TimersChoice<T> { value: T; label; title; selected; select() }        // role="radio"
```

Errors: actions report validation and service errors through the card. Render
`ctx.renderError(key)` where the model gives an `errorKey` / `errorKeys` (start controls, compose
form, recent chips), so the error shows next to the control instead of the card's strip.

### `timers`

| Field | Meaning |
| --- | --- |
| `title`, `available`, `unavailableText`, `emptyText` | Section header; when `available` is false show `unavailableText` only. |
| `timers: TimerView[]` | Ringing first, then soonest end. Key lists by `id` (lit `repeat`). |
| `stopAll?` | Only with more than one timer. |
| `start?` | Only while available (see below). |
| `recent?` | Recent timers (see *Recent chips*); undefined when there are none or several bars hide them. |

`TimerView`: `id`, `item` (raw `TimerItem`), `name` ("PIZZA" or the translated "Timer"),
`ringing`, `ringingText`, `endsAt` (ms, null while ringing), `progressTotal` (seconds for a
progress bar, null when unknown), `endsAtLabel` ("ends at 20:15"), `sound {value, icon, label}`,
`countdownOnBar? {icon, label}`, `cancel` (ringing: "Stop"; running: cancel ×, same key),
`extend?` ("+1 min", only on remotes that report the duration).

**Countdowns:** never call `ctx.wantTick()`. Render
`<jbl-bar-countdown .endsAt=${view.endsAt}>` (text) and
`<jbl-bar-countdown .kind=${"progress"} .total=${view.progressTotal} .endsAt=${view.endsAt}>`;
they repaint themselves every second (see `src/countdown.ts`).

`start: StartModel`:

- `label` (group label), `quick[]` (1, 5, 10, 15 min; `minutes`, `pending` marks the button that
  started), `errorKey`.
- `form: TimerFormModel` — the custom timer form:
  - `open`, `toggle()`, `close()`, `toggleLabel` ("Custom", visible text), `toggleAriaLabel`
    ("Custom timer", the button's aria-label; it does not change with `open`, aria-expanded tells
    the state), `toggleIcon` (`mdi:tune-variant` closed, `mdi:close` open), `closeLabel`;
  - `name {id, label, value, max, set(v)}`, `folded` ("PIZZA"), `badChars`,
    `nameHint {text, warn}` (warning, preview or rules — always show it);
  - `minutes {id, label, value, min, max, set(v)}` (kept as typed; `set` does not re-render);
  - `soundLabel`, `sounds: TimersChoice<TimerSound>[]`, `showLeft: TimersToggle`;
  - `submit: TimersAction` (disabled with a reason while the name has bad characters),
    `submitForm(): Promise<boolean>` — call it from the form's submit handler after
    `ev.preventDefault()`. It validates (minutes 1..720, characters, name taken, at most 8 timers,
    an unnamed timer already running), starts, then clears the name and closes the form.

Input ids (`timers-name`, `timers-minutes`, `timers-text`, ...) are unique per card (each card has
its own shadow root); use them for `<label for>`.

### Recent chips (`timers.recent`, `messages.recent`)

`RecentModel`: `kind` ("timer" | "message"), `title`, `hint`, `icon`, `chips[]`, `errorKeys`.
`RecentChip`: `id` (the button entity, a *slot*), `label` (translated "EGGS · 7 min"), `busy`,
`restart` (tap), `forget` (× — stays enabled while the bar is unreachable).

**Long press:** bind the chip's press helpers to the restart button; they implement "hold to
forget", right-click to forget and swallowing the click that ends a long press:

```ts
@click=${chip.restart.run}
@pointerdown=${chip.press.onPointerDown}
@pointerup=${chip.press.onPointerEnd}
@pointerleave=${chip.press.onPointerEnd}
@pointercancel=${chip.press.onPointerEnd}
@contextmenu=${chip.press.onContextMenu}
```

Double taps are handled in the model (slot guard, 800 ms): just call `run()` on every click.

### `messages`

| Field | Meaning |
| --- | --- |
| `title`, `available`, `unavailableText`, `emptyText` | As for timers. |
| `messages: MessageView[]` | In the remote's order. |
| `clearAll?` | Only when there is a message. |
| `compose?` | Only while available. |
| `recent?` | Recent messages. |

`MessageView`: `id`, `item`, `label` (text or id), `name` (the id shown as "(fridge)", "" when
unnamed), `showing`, `status {kind: "held" | "showing" | "waiting", text}`, `icon`,
`length {kind, text, endsAt?}` (kind `"until"`: show `text`, then a `<jbl-bar-countdown>` to
`endsAt`; kind `"none"`: nothing), `whenOnText?`, `clear`.

`ComposeModel` — the new message form:

- `title`, `text {id, label, value, placeholder, max, set(v)}`;
- `folded` (what the display shows), `preview` / `previewEmpty` / `previewLabel` for an LCD
  preview, `counter {id, text, warn}` (use `counter.id` as the input's `aria-describedby`);
- `badChars`, `tooLong`, `invalid` (aria-invalid), `warning?` (visible),
  `liveStatus` (put it in a `role="status"` region; "" when all is well);
- `modeLabel`, `mode`, `modes: TimersChoice<"repeat" | "duration" | "forever">[]`;
- `repeat {value, label, less, more}` — a stepper 1..99 (`less`/`more` are local actions; at the
  limits they are disabled with a `reason`: "The message shows at least once." at 1, "The message
  repeats at most 99 times." at 99);
- `duration {id, label, options: TimersChoice<number>[], set(minutes)}`;
- `clearOnKey: TimersToggle`, `whenOn?: TimersToggle` (gone for the session once the remote
  refused it), `whenOnHint?` (show while when_on is on);
- `send: TimersAction` (disabled with a reason: unreachable, bad text, no text),
  `sendForm(): Promise<boolean>` (call from the submit handler; clears the text when sent),
  `errorKey`.

### `clock`

`title`; `toggle: TimersAction & { on }` (the display clock switch; `on` already shows the pending
value; disabled while the bar is unreachable or the state is unknown, with a `reason`: the
unreachable reason first, else "The clock's state is unknown.");
`when? {label, options[]}` where each option is a `TimersChoice` plus `checked` (the bar's actual
state, for `aria-checked`), `pending`, `enabled` and `reason?` (set when disabled: the unreachable
reason first, else "The \"Shows\" setting is unavailable."); `selected` is the pending value when
there is one. Choosing the current option, or a disabled one, does nothing. The switch and the
options usually share one reason: show it once.

### No sliders, no debounce

The Timers tab has no sliders, so the model has no debounce or drag preview. Steppers, toggles
and choices change the card's local state at once (`ctx.requestUpdate()` inside the model).

### Helpers

Also exported from `src/tabs/timers-model.ts` (and re-exported by `src/tabs/timers.ts`):
`TIMERS_KEYS`, `QUICK_MINUTES`, `MAX_TIMERS`, `MAX_TIMER_MINUTES`, `MESSAGE_DURATIONS`,
`LONG_PRESS_MS`, `SUPPRESS_CLICK_MS`, `RECENT_SLOT_GUARD_MS`, `timerItems`, `messageItems`,
`invalidTimerNameChars`, `recentLabel`, `lengthLabel`, `composeMessage`. The tab's local UI state is
`ctx.local("timers")` (`TimersLocal`); every layout shares it, so a draft survives a layout switch.
