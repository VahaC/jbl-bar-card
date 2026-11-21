// Product illustrations drawn for this card (assets/*.svg, MIT like the rest
// of the project). They are inlined as data URLs so the bundle stays one file
// and Home Assistant never fetches anything from the internet.
import barCenterSvg from "../assets/bar-center.svg?raw";
import barDockedSvg from "../assets/bar-docked.svg?raw";
import rearLeftSvg from "../assets/rear-left.svg?raw";
import rearRightSvg from "../assets/rear-right.svg?raw";
import subwooferSvg from "../assets/subwoofer.svg?raw";

const dataUrl = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;

export const IMAGES = {
  barCenter: dataUrl(barCenterSvg),
  barDocked: dataUrl(barDockedSvg),
  rearLeft: dataUrl(rearLeftSvg),
  rearRight: dataUrl(rearRightSvg),
  subwoofer: dataUrl(subwooferSvg),
} as const;
