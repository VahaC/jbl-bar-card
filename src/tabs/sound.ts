import type { CSSResult, TemplateResult } from "lit";
import type { LayoutOf, TabContext } from "../types";
import { soundModel } from "./sound-model";
import type { SoundModel } from "./sound-model";
import { renderSoundClassic, soundClassicStyles } from "./sound-layouts/classic";
import { renderSoundCards, soundCardsStyles } from "./sound-layouts/cards";
import { renderSoundMixer, soundMixerStyles } from "./sound-layouts/mixer";

/**
 * Sound tab: level selects (bass, center, atmos, rear), audio sync, Front EQ (status, preset,
 * five bands) and bass offset. Every block is hidden when its entity is missing.
 *
 * All decisions live in sound-model.ts; this file only picks the layout chosen in the card
 * config (`layouts.sound`) and hands it the model. See docs/layouts-sound.md.
 */

export { CENTER_DB, EQ_PRESETS, SOUND_KEYS, SOUND_TIMING, bandKey, snapToStep, soundModel } from "./sound-model";

type SoundLayout = LayoutOf<"sound">;
type SoundLayoutRenderer = (ctx: TabContext, model: SoundModel) => TemplateResult;

const LAYOUTS: Record<SoundLayout, SoundLayoutRenderer> = {
  classic: renderSoundClassic,
  mixer: renderSoundMixer,
  cards: renderSoundCards,
};

export function renderSoundTab(ctx: TabContext): TemplateResult {
  const render = LAYOUTS[ctx.config.layouts?.sound] ?? renderSoundClassic;
  return render(ctx, soundModel(ctx));
}

/** Styles of every Sound layout (added to the card's static styles; Lit flattens the array). */
export const soundStyles: CSSResult[] = [soundClassicStyles, soundMixerStyles, soundCardsStyles];
