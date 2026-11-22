// Home tab: builds homeModel(ctx) and hands it to the layout chosen in the card config
// (layouts.home: classic | remote | media). Layouts only render; every decision is in
// home-model.ts. See docs/layouts-home.md.
import type { CSSResult, TemplateResult } from "lit";
import type { LayoutOf, TabContext } from "../types";
import { homeModel } from "./home-model";
import type { HomeModel } from "./home-model";
import { classicStyles, renderClassic } from "./home-layouts/classic";
import { remoteStyles, renderRemote } from "./home-layouts/remote";
import { mediaStyles, renderMedia } from "./home-layouts/media";

export { HOME_KEYS, batteryIcon, homeModel, isBarOn, powerToggle, volumeStep } from "./home-model";

type HomeLayoutRenderer = (ctx: TabContext, model: HomeModel) => TemplateResult;

/** Renderer of every Home layout. */
export const HOME_LAYOUTS: Record<LayoutOf<"home">, HomeLayoutRenderer> = {
  classic: renderClassic,
  remote: renderRemote,
  media: renderMedia,
};

export function renderHomeTab(ctx: TabContext): TemplateResult {
  const render = HOME_LAYOUTS[ctx.config.layouts.home] ?? renderClassic;
  return render(ctx, homeModel(ctx));
}

/** CSS of every Home layout (the card adopts them all; each layout's selectors are prefixed). */
export const homeStyles: CSSResult[] = [classicStyles, remoteStyles, mediaStyles];
