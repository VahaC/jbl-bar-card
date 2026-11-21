# Architecture

The card is one Lit element (`<jbl-bar-card>`) built into one ES module (`dist/jbl-bar-card.js`,
Lit bundled, no lazy chunks). It talks to Home Assistant only through the `hass` object.

```
src/
  jbl-bar-card.ts   card shell: config, header, tab strip, busy/error strips, confirm dialog,
                    shouldUpdate filter, TabContext, window.customCards
  editor.ts         visual editor (ha-form, native fallback when ha-form cannot be loaded)
  config.ts         config validation and defaults
  discovery.ts      finds the bar's entities (roles) from hass.entities / hass.states
  services.ts       typed service helpers (JblServices) + display text helpers
  pending.ts        which controls are waiting for the bar
  format.ts         number / time / countdown formatting
  state.ts          entity state helpers (isBlankState, numAttr, textAttr, selectOptions) and LOW_BATTERY
  countdown.ts      <jbl-bar-countdown>: a self-repainting countdown text or progress bar
  styles.ts         shared CSS building blocks (see the comment at the top)
  types.ts          HA typings, config, roles, BarEntities, TabContext
  i18n/             index.ts (lookup), en/uk/fr core strings, one strings module per tab
  tabs/             home.ts, sound.ts, timers.ts, system.ts
demo/               npm run dev: the card against a complete fake hass (mock-hass.ts)
tests/              vitest + happy-dom; helpers.ts mounts the card on the mock
```

## Contract for tab authors

Each tab owns exactly three files and touches nothing else:

| Tab    | Renderer                 | Strings              | Tests                  |
|--------|--------------------------|----------------------|------------------------|
| Sound  | `src/tabs/sound.ts`      | `src/i18n/sound.ts`  | `tests/sound.test.ts`  |
| Timers | `src/tabs/timers.ts`     | `src/i18n/timers.ts` | `tests/timers.test.ts` |
| System | `src/tabs/system.ts`     | `src/i18n/system.ts` | `tests/system.test.ts` |

A tab module exports two things, with these exact names (the card imports them):

```ts
export function renderSoundTab(ctx: TabContext): TemplateResult;
export const soundStyles: CSSResult; // only this tab's CSS; the shared classes are in styles.ts
```

(`renderTimersTab` / `timersStyles`, `renderSystemTab` / `systemStyles` likewise.)

A tab is a pure function of `ctx`. It must not keep module-level state (several cards can be
on one dashboard). Local UI state (form fields, drag values, open menus) goes in
`ctx.local(key, init)`, which lives on the card instance; mutate it, then call
`ctx.requestUpdate()`. Prefix local and pending keys with the tab name (`"sound.bass"`,
`"timers.form"`).

### TabContext

Defined in `src/types.ts`:

| Member | What it is |
|--------|------------|
| `hass` | The current HA object. |
| `config` | Normalized card config (`tabs`, `default_tab`, `compact`, `name`, `recent`). |
| `entities` | `BarEntities`: entity ids by role (see below). Any role may be missing. |
| `services` | `JblServices` bound to this bar's media_player. Every method returns a promise that rejects on error. |
| `lang`, `t(key, vars?)` | Language (`en` / `uk` / `fr`) and translation. Tab keys are `"<tab>.<key>"`. `vars.count` selects plural forms. |
| `stateOf(roleOrId)` | State object by role (`"bass"`) or entity id; undefined when missing. |
| `isAvailable(roleOrId)` | Exists and is not `unavailable`. |
| `barUnavailable`, `barOn` | The remote is unreachable / the bar is on. |
| `busy` | `{ running, action, source }` from binary_sensor command_running. The card already shows a status strip for it on every tab. |
| `now`, `wantTick()` | Render time; call `wantTick()` during render to get a re-render of the whole card every second. Prefer `<jbl-bar-countdown>` (below) for countdowns. |
| `call(key, fn, opts?)` | Runs a service call with the shared pending/error handling (below). Never rejects; resolves `true`/`false`. |
| `isPending(key)`, `pendingValue(key)` | Whether `key` is waiting, and the `opts.value` it is moving to. |
| `showError(message, key?)` | Client-side validation error. With `key`, it shows where the tab calls `renderError(key)`; otherwise in the strip at the top. |
| `renderError(keys)` | Render the errors of these pending keys next to their control (call it during render). Such errors stay until dismissed or the key is called again; others leave the top strip after 20 s. |
| `confirm({ title, message, confirmLabel, destructive })` | In-card confirmation dialog; resolves `true` on confirm. |
| `local(key, init)`, `requestUpdate()` | Per-card UI state, re-render. |
| `moreInfo(entityId)` | Opens HA's more-info dialog. |
| `formatNumber`, `formatTime`, `formatDuration` | Locale-aware formatting (`formatDuration(425)` = `"7:05"`). |

### One command at a time: `ctx.call`

```ts
void ctx.call("sound.bass", () => ctx.services.selectOption(ctx.entities.bass!, "4"), {
  value: "4",                                                 // shown while pending
  until: (hass) => hass.states[bassId]?.state === "4",        // stay pending until HA shows it
  timeoutMs: 30000,                                           // default 20000
});
```

- While the call runs (and afterwards, until `until(hass)` holds or the timeout passes), `ctx.isPending(key)`
  is true and `ctx.pendingValue(key)` returns `value`. Render the touched control with the `pending` class and
  show `pendingValue` instead of the entity state.
- `until` receives the **latest** hass; never read a captured `ctx` inside it.
- A rejection (HA `HomeAssistantError`, validation error, refusal from the remote) is shown next to the control
  when the tab renders `ctx.renderError(key)`, else in the strip at the top. HA builds its message in English, so
  the card translates it itself: a lost connection, then the integration's `translation_key` (`svc.<key>` in the
  card's en/uk/fr strings), then `hass.localize` for other integrations, then HA's message. Pass
  `onError(err)` to react to one error (return a text to show instead). Nothing fails silently.
- Toggles (power, mute, Night, Smart, the clock) and one-shot actions (start, send, restart) must ignore clicks
  while their key is pending: the integration toggles on the bar, so a second tap would undo the first.
- If the bar is unreachable the call is not sent (HA would skip it silently) and an error explains why. Pass
  `offline: true` for calls that never reach the bar (`forget_recent`).
- Several calls to the same key may overlap; the key stays pending until the last one finishes and
  `pendingValue` is the last value. The integration serializes them on the bar anyway; slow controls
  (level selects, audio sync, EQ bands) should debounce and avoid sending a second value while pending.

### Roles (`ctx.entities`)

The role is the integration's translation_key; discovery matches device_id + platform `jbl_bar_91` +
translation_key + domain, never entity_id text.

- `media_player` (always present; the target of every `jbl_bar_91.*` service)
- select: `bass`, `center`, `atmos`, `rear`, `eq_preset`, `display_clock_when`
- number: `audio_sync`, `bass_offset`, and `eqBands[0..4]` (125 Hz, 500 Hz, 2 kHz, 4 kHz, 8 kHz)
- switch: `night`, `smart_mode`, `display_clock`
- button: `standard_mode` (only when `smart_mode` is absent), `bluetooth_pairing`, `calibrate`, `sub_pair`,
  `clear_messages`, `restart`
- sensor: `sound_mode`, `bluetooth_device`, `bluetooth_audio`, `cpu`, `memory`, `temperature`, `wifi_signal`,
  `uptime`, `rear_battery_left`, `rear_battery_right`, `audio_format`, `calibration`, `subwoofer`,
  `mode_after_standby`, `front_eq_status`, `timers`, `next_timer`, `messages`
- binary_sensor: `rear_docked`, `bluetooth_connected`, `command_running`, `timer_ringing`
- event: `timer_events`, `message_events`; notify: `display`
- Unregistered fixed-id buttons (only in `hass.states`): `timerLines[]`, `messageLines[]`, `recentTimers[]`,
  `recentMessages[]`. They are filled only when one JBL bar exists, or with config `recent: true`, because
  they carry no device id. Empty slots have state `unavailable`.

Notes:

- `wifi_signal` and `uptime` are disabled by default in HA, so they are usually missing (the display registry
  leaves disabled entities out). Hide the tile, or tell the user how to enable it.
- `eqBandsGuessed` lists bands whose index came only from registry order; the card asks the entity registry
  for their unique_id in the background and re-renders when it knows.
- Live timers and messages: read `stateOf("timers").attributes.timers` and `stateOf("messages").attributes.messages`
  (structured, language-independent) and cancel/extend by id with `services.timerCancel({ id })`,
  `services.timerExtend({ id })`, `services.displayCancel(id)`. Do not parse line-button labels.
- Recent timers/messages exist only as `button.jbl_recent_*` (label = friendly_name, no attributes):
  `services.press(id)` restarts, `services.forgetRecent(id)` forgets (pass `offline: true`). The ids are
  slots: after a forget or restart the next item moves into the same id, so the card keeps the slot pending
  until its name changes and ignores the same action on it for a moment. The name is written by the
  integration in the server's language (en or fr only); `recentLabel()` translates its known words.

### Countdowns

`src/countdown.ts` defines `<jbl-bar-countdown>`, a light-DOM element that repaints itself at every
whole second until it reaches zero, so a running countdown does not re-render the card:

```ts
html`<jbl-bar-countdown .endsAt=${endsAtMs}></jbl-bar-countdown>`                       // "7:12"
html`<jbl-bar-countdown .kind=${"progress"} .endsAt=${endsAtMs} .total=${seconds}></jbl-bar-countdown>`
```

Key list rows by item id (`repeat()`) so each element stays with its item across hass updates.
The Timers tab uses it for timers and timed messages and never calls `wantTick()`.

### Debounced controls

Slow controls in the Sound tab (levels, audio sync, EQ bands, bass offset) use a small send queue
kept in `ctx.local`: only the last value is sent, one at a time, and each send reads the latest
`TabContext`. The delays are in `SOUND_TIMING` (tests set them to 0). The card does not cancel a
queued send when it is removed from the page: the user's last choice still reaches the bar.

### Shared helpers

Use `src/state.ts` instead of local copies: `isBlankState(state)` (missing / "" / unknown /
unavailable), `numAttr(st, "min", fallback)`, `textAttr(st, "error")`, `selectOptions(st, fallback)`,
and `LOW_BATTERY` (Home marks a low rear battery, System explains how to fix it). `numericState`
is in `src/format.ts`; `TIMER_SOUNDS`, `VOLUME_MAX`, `DISPLAY_TEXT_MAX` are in `src/services.ts`.
Labels that repeat core strings use the core key (`header.mode_smart`, `common.unknown`).

### Strings

`src/i18n/<tab>.ts` exports `strings: TabStrings = { en, uk, fr }`, flat keys without the tab prefix
(`bass: "Bass"` is looked up as `t("sound.bass")`). `tests/i18n.test.ts` fails when a language misses a key
or a placeholder. Plurals: `minutes_one`, `minutes_few`, `minutes_many`, `minutes_other` with
`t("timers.minutes", { count })` (Ukrainian needs one/few/many; French and English one/other).

### Styles

Use the shared classes from `src/styles.ts` (segmented control `.seg`, chips `.chip` with `.switch-knob`,
`.btn`, `.icon-btn`, `.stepper`, `.tiles/.tile`, `.badge.ok|warn|err|info`, `.list/.list-item`,
`input.slider`, `.field`, `.spinner`, `.pending`). Colours only through the `--jbl-*` variables, which
follow the HA theme in light and dark. Layout must work at 300 px wide (the card asks a sections view for
all 12 columns). Text on the accent uses `--jbl-accent-fill`, accent-coloured text `--jbl-accent-text`, and
warnings use the text colour with an orange sign (`.warn-text`), to keep WCAG AA contrast.

### Tests

`tests/helpers.ts`:

- `tabContext(bar?, config?)` returns a TabContext on the mock for rendering a tab function with Lit's `render()`.
- `mountCard(config?, bar?)` mounts the real card; `settle(m)` waits for queued service calls.
- `newBar({ language })` is a `MockBar` (demo/mock-hass.ts) with `delayMs: 0` and a fixed clock.
  Change its model with `bar.update((b) => { b.docked = true; })`; read the calls in `bar.calls`.

If a tab needs mock data or simulation that is missing, add it to `demo/mock-hass.ts` in a small,
separate change and say so.
