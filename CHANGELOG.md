# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-22

### Added

- Three layouts for every tab, chosen per tab with the new `layouts` option or under **Tab layouts**
  in the visual editor:
  - Home: `classic` (default), `remote` (big keys, volume rocker, power and mute), `media` (now
    playing and a volume knob).
  - Sound: `classic` (default), `mixer` (all levels, EQ bands and bass offset as faders), `cards`
    (a card per setting and a draggable EQ curve).
  - Timers: `classic` (default), `kitchen` (the next timer as a big ring, big quick starts),
    `compact` (sub-tabs for timers, messages and the clock).
  - System: `list` (default, gauges and a compact list), `map` (the speakers as a picture with
    their actions), `health` (a health summary with device cards).
- Unknown layouts in the config are refused with a message that lists the allowed ones.

### Changed

- The System tab was redesigned: the old layout with a titled section per device is replaced by the
  three layouts above. Disabled actions always say why in visible text.
- Each tab's rules (pending states, reasons, debounced sliders, long presses, forms) moved into a
  model the layouts share, so every layout behaves the same.
- The header power button shows the target state at once and has a fixed accessible name.
- Ukrainian: "задні колонки" everywhere (no more "тилові"), "не на зв'язку" for an unreachable
  soundbar. French: "appairer", "barre de son", "injoignable" used consistently.
- README: the projects the card is built on (kisinga/jbl-bar-toolkit and naonak/jbl-bar-toolkit-ha)
  are named at the top with the dependency chain, and a Credits section thanks their authors.

### Fixed

- The volume number no longer sticks on a dragged value when the bar went to standby mid-drag.

## [0.1.1] - 2026-11-21

### Changed

- README: installation through the Marketplace built into Home Assistant 2026.11 (Settings →
  Marketplace → Add from link), with the HACS steps kept for older versions.

## [0.1.0] - 2026-11-21

First release.

### Added

- One card for the JBL Bar 9.1 (`jbl_bar_91` integration 0.13.2 or newer): header with the JBL
  badge, name, source / Standard or Smart / audio format and power, tabs Home, Sound, Timers and
  System, compact mode (Home only).
- Entity discovery from the media player alone: same device, platform `jbl_bar_91` and
  translation_key (language-independent). Any block whose entity or remote feature is missing is
  hidden.
- One command at a time: the touched control stays pending until Home Assistant shows the new
  state, a strip shows the command the bar runs (also from its web page), and every service error
  is shown in the card.
- Home tab: drawn pictures of the soundbar, rear speakers and subwoofer (rears apart when detached,
  one bar when docked) with rear batteries, bass level and dock state; source; volume with steps,
  slider and mute; Smart mode and Night chips; playback controls and now playing when the source
  supports them.
- Sound tab: bass, center (with its gain), Atmos and rear levels (rear disabled with the reason
  while docked); audio sync stepper (TV and HDMI only, waits for the re-sync); Front EQ status with
  the bar's reason, preset select and five vertical band sliders; Reset EQ when the bar needs it;
  bass offset with status and error. Quick clicks and drags send only the last value, one at a
  time.
- Timers tab: running timers with a live countdown and progress bar, +1 min, cancel, Stop for a
  ringing timer and Stop all; quick 1 / 5 / 10 / 15 min timers and a custom form (name, minutes,
  sound, time left on the bar); recent timers (tap to restart, long-press, right-click or × to
  forget); display messages with clear and Clear all; message composer (31 characters, live
  counter, display preview, repeat / duration / until cleared, clear by key, when the bar is on);
  recent messages; the display clock and when it shows.
- System tab: low rear battery warning with how to fix it; CPU, memory, temperature, Wi-Fi,
  uptime and mode-after-standby tiles (with how to enable the disabled ones); Bluetooth device,
  pairing and source switch; surround calibration status and next step; subwoofer status and
  pairing; restart with a confirmation.
- Visual editor (ha-form, with a plain fallback): entity, name, compact, visible tabs, default tab,
  recent items with several bars.
- English, Ukrainian and French, following the Home Assistant language. Light and dark themes.
- Build: TypeScript (strict), Lit 3, one ES module `dist/jbl-bar-card.js` with Lit bundled and no
  external imports; vitest + happy-dom tests; GitHub Actions build that attaches the card to each
  release, and HACS validation. Installable from HACS as a custom repository (type Dashboard).
- Demo page (`npm run dev`) with a complete fake Home Assistant, including the Front EQ reset and
  subwoofer status cases, and `?tab=`, `?theme=`, `?docked=1`, `?lang=` for screenshots.
