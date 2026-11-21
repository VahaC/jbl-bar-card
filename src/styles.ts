import { css } from "lit";

/**
 * Shared styles for the card shell and every tab. Colours come from HA theme variables
 * (light and dark follow the theme); the accent is JBL orange, overridable with
 * --jbl-bar-accent in a theme.
 *
 * Building blocks for tab authors (all class names below):
 *   .section / .section-title / .row / .hint / .muted / .warn-text
 *   .seg + button (.active, .pending)          segmented control
 *   .chip (.on, .pending) + .switch-knob        chips and switch chips (role="switch")
 *   .btn (.primary, .danger, .ghost, .small)    buttons;  .icon-btn  round icon button
 *   .stepper > button + .stepper-value          - value + stepper
 *   .tiles > .tile > .tile-label + .tile-value  metric tiles
 *   .badge (.ok, .warn, .err, .info)            status pills
 *   .list > .list-item                          rows with actions
 *   input[type=range].slider                    native slider in accent colour
 *   .field > label + input/select               form fields
 *   .spinner                                    small busy spinner
 */
export const sharedStyles = css`
  :host {
    --jbl-accent: var(--jbl-bar-accent, #d85a30);
    --jbl-accent-rgb: var(--jbl-bar-accent-rgb, 216, 90, 48);
    /* Fill behind white text (white on #b4441e is 5.5:1; on #d85a30 only 3.9:1). */
    --jbl-accent-fill: var(--jbl-bar-accent-fill, #b4441e);
    /* Accent-coloured text on the card: darker in light themes, lighter in dark ones (>= 4.5:1). */
    --jbl-accent-text: var(--jbl-bar-accent-text, #b4441e);
    --jbl-on-accent: #fff;
    --jbl-text: var(--primary-text-color, #212121);
    --jbl-muted: var(--secondary-text-color, #727272);
    --jbl-disabled: var(--disabled-text-color, #bdbdbd);
    --jbl-border: var(--divider-color, rgba(127, 127, 127, 0.24));
    --jbl-surface: var(--secondary-background-color, rgba(127, 127, 127, 0.08));
    --jbl-card-bg: var(--ha-card-background, var(--card-background-color, #fff));
    /* An opaque surface: glass themes make --ha-card-background (and sometimes card-background-color) translucent. */
    --jbl-solid-bg: var(--primary-background-color, #fff);
    --jbl-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg, 12px));
    --jbl-radius-sm: 8px;
    --jbl-error: var(--error-color, #db4437);
    --jbl-warning: var(--warning-color, #ffa600);
    --jbl-success: var(--success-color, #43a047);
    --jbl-info: var(--info-color, #039be5);
    --jbl-gap: 12px;
    display: block;
    container-type: inline-size;
    color: var(--jbl-text);
  }

  button {
    font: inherit;
    color: inherit;
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--jbl-accent);
    outline-offset: 2px;
  }
  :host([dark]) {
    --jbl-accent-text: var(--jbl-bar-accent-text, #e8794f);
  }
  ha-icon {
    --mdc-icon-size: 20px;
    display: inline-flex;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
  }
  .section:first-child {
    margin-top: 0;
  }
  .section-title {
    font-size: 0.8rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--jbl-muted);
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .hint {
    font-size: 0.85rem;
    color: var(--jbl-muted);
    line-height: 1.35;
  }
  .muted {
    color: var(--jbl-muted);
  }
  /* Read by screen readers only. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  /* Warnings: text in the text colour (the warning orange is ~2:1 on white), marked by an orange sign. */
  .warn-text {
    color: var(--jbl-text);
    font-weight: 500;
  }
  .warn-text::before {
    content: "\\26A0\\FE0E  ";
    color: var(--jbl-warning);
  }

  /* Segmented control */
  .seg {
    display: flex;
    width: 100%;
    border: 1px solid var(--jbl-border);
    border-radius: 999px;
    padding: 3px;
    gap: 2px;
    box-sizing: border-box;
    background: var(--jbl-surface);
  }
  .seg button {
    flex: 1 1 0;
    min-width: 0;
    border: 0;
    background: transparent;
    border-radius: 999px;
    padding: 7px 6px;
    cursor: pointer;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 120ms ease, color 120ms ease;
  }
  .seg button:hover:not(:disabled):not(.active) {
    background: rgba(var(--jbl-accent-rgb), 0.12);
  }
  .seg button.active {
    background: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
    font-weight: 500;
  }
  .seg button:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .seg button.active:disabled {
    background: rgba(var(--jbl-accent-rgb), 0.45);
    color: var(--jbl-on-accent);
  }
  /* Narrow cards: labels wrap and the buttons flow onto a second row instead of being cut off. */
  @container (max-width: 420px) {
    .seg {
      flex-wrap: wrap;
      border-radius: 16px;
    }
    .seg button {
      flex: 1 1 auto;
      min-width: min-content;
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      line-height: 1.2;
      border-radius: 13px;
    }
  }

  /* Pending state on the control the user touched */
  .pending {
    animation: jbl-pulse 1.1s ease-in-out infinite;
  }
  .seg button.pending:not(.active) {
    box-shadow: inset 0 0 0 2px var(--jbl-accent);
  }
  @keyframes jbl-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }

  /* Chips and switch chips */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--jbl-border);
    background: var(--jbl-card-bg);
    border-radius: 999px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 0.9rem;
    max-width: 100%;
    box-sizing: border-box;
  }
  .chip > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip.on {
    border-color: var(--jbl-accent);
    background: rgba(var(--jbl-accent-rgb), 0.12);
  }
  .chip:disabled {
    cursor: default;
    color: var(--jbl-disabled);
  }
  .switch-knob {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 999px;
    background: rgba(127, 127, 127, 0.45);
    flex: none;
    transition: background 120ms ease;
  }
  .switch-knob::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    transition: transform 120ms ease;
  }
  .on > .switch-knob,
  [aria-checked="true"] > .switch-knob {
    background: var(--jbl-accent);
  }
  .on > .switch-knob::after,
  [aria-checked="true"] > .switch-knob::after {
    transform: translateX(12px);
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--jbl-border);
    background: var(--jbl-card-bg);
    border-radius: var(--jbl-radius-sm);
    padding: 7px 12px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
  }
  .btn.small {
    padding: 4px 8px;
    font-size: 0.8rem;
  }
  .btn.primary {
    background: var(--jbl-accent-fill);
    border-color: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .btn.danger {
    border-color: var(--jbl-error);
    color: var(--jbl-error);
  }
  .btn.danger.filled {
    background: var(--jbl-error);
    color: #fff;
  }
  .btn.ghost {
    border-color: transparent;
    background: transparent;
  }
  .btn:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 50%;
    border: 1px solid var(--jbl-border);
    background: var(--jbl-card-bg);
    cursor: pointer;
    padding: 0;
  }
  .icon-btn.plain {
    border-color: transparent;
    background: transparent;
  }
  .icon-btn.on {
    background: var(--jbl-accent-fill);
    border-color: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }
  .icon-btn:disabled {
    cursor: default;
    opacity: 0.45;
  }

  /* Stepper */
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--jbl-border);
    border-radius: 999px;
    padding: 2px;
  }
  .stepper button {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: var(--jbl-surface);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .stepper button:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .stepper-value {
    min-width: 64px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  /* Tiles */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
    gap: 8px;
  }
  .tile {
    background: var(--jbl-surface);
    border-radius: var(--jbl-radius-sm);
    padding: 10px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tile-label {
    font-size: 0.75rem;
    color: var(--jbl-muted);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tile-label ha-icon {
    --mdc-icon-size: 16px;
  }
  .tile-value {
    font-size: 1.15rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Badges */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.75rem;
    font-weight: 500;
    background: var(--jbl-surface);
    color: var(--jbl-muted);
    white-space: nowrap;
  }
  .badge.ok {
    background: rgba(67, 160, 71, 0.15);
    color: var(--jbl-success);
  }
  .badge.warn {
    background: rgba(255, 166, 0, 0.16);
    color: var(--jbl-text);
    box-shadow: inset 0 0 0 1px var(--jbl-warning);
  }
  .badge.err {
    background: rgba(219, 68, 55, 0.14);
    color: var(--jbl-error);
  }
  .badge.info {
    background: rgba(var(--jbl-accent-rgb), 0.14);
    color: var(--jbl-accent-text);
  }

  /* Lists */
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--jbl-radius-sm);
    background: var(--jbl-surface);
    min-width: 0;
  }
  .list-item .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Native slider */
  input[type="range"].slider {
    width: 100%;
    accent-color: var(--jbl-accent);
    margin: 0;
    cursor: pointer;
  }
  input[type="range"].slider:disabled {
    cursor: default;
    opacity: 0.5;
  }

  /* Form fields */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .field > label {
    font-size: 0.8rem;
    color: var(--jbl-muted);
  }
  .field input[type="text"],
  .field input[type="number"],
  .field select,
  select.select {
    font: inherit;
    color: var(--jbl-text);
    background: var(--jbl-card-bg);
    border: 1px solid var(--jbl-border);
    border-radius: var(--jbl-radius-sm);
    padding: 7px 10px;
    min-width: 0;
    box-sizing: border-box;
  }

  /* Spinner */
  .spinner {
    width: 14px;
    height: 14px;
    flex: none;
    border-radius: 50%;
    border: 2px solid rgba(var(--jbl-accent-rgb), 0.3);
    border-top-color: var(--jbl-accent);
    animation: jbl-spin 0.8s linear infinite;
  }
  @keyframes jbl-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pending,
    .spinner {
      animation-duration: 2.4s;
    }
  }
`;

/** Styles of the card shell: header, tabs, strips, dialog, compact mode. */
export const cardStyles = css`
  ha-card {
    position: relative;
    overflow: hidden;
    padding: 16px;
    box-sizing: border-box;
  }
  :host([compact]) ha-card {
    padding: 12px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .badge-jbl {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
    font-weight: 800;
    font-size: 0.85rem;
    letter-spacing: 0.02em;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .titles {
    flex: 1 1 auto;
    min-width: 0;
    cursor: pointer;
    display: block;
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    text-align: start;
    font: inherit;
    color: inherit;
    border-radius: 4px;
  }
  .titles > span {
    display: block;
  }
  .name {
    font-size: 1.1rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subtitle {
    font-size: 0.85rem;
    color: var(--jbl-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .power.on {
    background: var(--jbl-accent-fill);
    border-color: var(--jbl-accent-fill);
    color: var(--jbl-on-accent);
  }

  .tabs {
    display: flex;
    gap: 4px;
    margin: 14px -4px 0;
    border-bottom: 1px solid var(--jbl-border);
  }
  .tab {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 8px 4px;
    cursor: pointer;
    color: var(--jbl-muted);
    font-size: 0.9rem;
  }
  .tab .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab[aria-selected="true"] {
    color: var(--jbl-accent-text);
    border-bottom-color: var(--jbl-accent);
    font-weight: 500;
  }
  @container (max-width: 360px) {
    .tab .tab-label {
      display: none;
    }
  }

  .content {
    margin-top: 14px;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding: 8px 10px;
    border-radius: var(--jbl-radius-sm);
    font-size: 0.85rem;
    line-height: 1.3;
  }
  .strip .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .strip.busy {
    background: rgba(var(--jbl-accent-rgb), 0.1);
  }
  .strip.error {
    background: rgba(219, 68, 55, 0.12);
    color: var(--jbl-text);
  }
  .strip.error ha-icon {
    color: var(--jbl-error);
  }
  .strip.offline {
    background: rgba(255, 166, 0, 0.14);
  }
  .strip .icon-btn {
    width: 28px;
    height: 28px;
  }
  /* An error shown next to the control that failed. */
  .strip.error.inline {
    margin-top: 0;
  }

  .overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 2;
  }
  .dialog {
    /* Opaque even in glass themes: a solid base under the theme's card colour. */
    background-color: var(--jbl-solid-bg);
    background-image: linear-gradient(var(--card-background-color, transparent), var(--card-background-color, transparent));
    color: var(--jbl-text);
    border-radius: var(--jbl-radius);
    padding: 16px;
    max-width: 360px;
    width: 100%;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dialog h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 500;
  }
  .dialog p {
    margin: 0;
    color: var(--jbl-muted);
    line-height: 1.4;
  }
  .dialog .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .warning {
    padding: 8px 0;
    line-height: 1.4;
  }
`;
