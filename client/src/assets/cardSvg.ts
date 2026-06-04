// Pure SVG-string renderer for UNO cards.
//
// String-based output so consumers can:
//   • inject via dangerouslySetInnerHTML for raw performance,
//   • turn into a data URI (`cardSvgDataUri`) for use as a CSS background,
//   • or unit-test the markup directly without a renderer in the loop.
//
// The Preact `<Card>` component prefers a parallel JSX tree (see Card.tsx) for
// type-safety + event wiring, but both paths share the same visual recipe by
// pinning to the constants/builders below.
//
// Card visual recipe (PRD §10.3, plan §P4a):
//   • 2:3 rounded rect coloured per card.color
//   • White inner oval rotated ~25° → contrast layer for the glyph
//   • Big centred glyph: digit, symbol (skip/reverse/+2), or 4-quadrant wild pie
//   • Corner indicators top-left + bottom-right (rotated 180°) in card colour
//   • Face-down back: black bg, big red oval, "UNO" wordmark
//
// All literal SVG — no fonts beyond system-ui, no external images.

import type { Card, Color, CardType } from '@uno/shared';

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

// SVG viewBox uses a 200×300 coordinate space (2:3 aspect, matches UNO ratio).
// All shape coordinates are written against this canvas; consumers scale via the
// `width` prop on Card.tsx (the rendered SVG keeps its aspect-ratio).
export const CARD_VIEW_WIDTH = 200;
export const CARD_VIEW_HEIGHT = 300;

// Concrete hex values — SVG strings can't read CSS custom properties when
// embedded inline, and reusing them via data URIs requires absolute colours.
export const CARD_COLOR_HEX: Record<Color, string> = {
  red: '#e53935',
  blue: '#1e88e5',
  green: '#43a047',
  yellow: '#fdd835',
  wild: '#212121', // wild cards use a black base; the four quadrants paint the centre
};

// Slightly darker variant for the outer border ring.
const CARD_BORDER_HEX: Record<Color, string> = {
  red: '#b71c1c',
  blue: '#0d47a1',
  green: '#1b5e20',
  yellow: '#f57f17',
  wild: '#000000',
};

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

// ---------------------------------------------------------------------------
// Builders — individually exported for unit testing.
// ---------------------------------------------------------------------------

/** Outer card body: coloured rounded rect with a darker ring. */
export function buildCardBody(color: Color): string {
  const fill = CARD_COLOR_HEX[color];
  const stroke = CARD_BORDER_HEX[color];
  return (
    `<rect x="4" y="4" width="192" height="292" rx="16" ry="16" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="4" />`
  );
}

/** White oval, rotated ~25°, that sits behind the centre glyph. */
export function buildInnerOval(): string {
  return (
    `<ellipse cx="100" cy="150" rx="95" ry="60" fill="#ffffff" ` +
    `transform="rotate(-25 100 150)" />`
  );
}

/** Big centred digit. Used for number cards (0–9). */
export function buildBigDigit(digit: string, color: Color): string {
  const fill = CARD_COLOR_HEX[color];
  return (
    `<text x="100" y="150" font-family='${FONT_FAMILY}' font-size="140" ` +
    `font-weight="900" font-style="italic" text-anchor="middle" ` +
    `dominant-baseline="central" fill="${fill}" ` +
    `stroke="#ffffff" stroke-width="2" paint-order="stroke fill">${digit}</text>`
  );
}

/** Small corner digit/symbol. Renders top-left + bottom-right (rotated 180°). */
export function buildCornerLabel(label: string, _color: Color): string {
  // We embed the literal label text in two <text> elements rather than using
  // <use> + symbol references — keeps the SVG self-contained and easy to debug.
  const fill = '#ffffff';
  const fontSize = label.length > 1 ? 22 : 28;
  return (
    `<text x="22" y="40" font-family='${FONT_FAMILY}' font-size="${fontSize}" ` +
    `font-weight="900" font-style="italic" text-anchor="start" ` +
    `fill="${fill}">${label}</text>` +
    `<text x="178" y="260" font-family='${FONT_FAMILY}' font-size="${fontSize}" ` +
    `font-weight="900" font-style="italic" text-anchor="end" ` +
    `fill="${fill}" transform="rotate(180 178 252)">${label}</text>`
  );
}

/** Skip glyph: ⊘ — circle with a diagonal slash. */
export function buildSkipGlyph(color: Color): string {
  const fill = CARD_COLOR_HEX[color];
  return (
    `<g>` +
    `<circle cx="100" cy="150" r="50" fill="none" stroke="${fill}" stroke-width="14" />` +
    `<line x1="60" y1="110" x2="140" y2="190" stroke="${fill}" stroke-width="14" stroke-linecap="round" />` +
    `</g>`
  );
}

/** Reverse glyph: two opposing curved arrows. */
export function buildReverseGlyph(color: Color): string {
  const fill = CARD_COLOR_HEX[color];
  // Two mirrored quarter-arcs with arrowheads.
  return (
    `<g fill="${fill}" stroke="${fill}" stroke-width="6" stroke-linejoin="round">` +
    // Top arrow: arc curving right then arrowhead pointing right.
    `<path d="M 60 130 Q 60 100 100 100 L 100 90 L 130 110 L 100 130 L 100 120 Q 75 120 75 140 Z" />` +
    // Bottom arrow: mirrored, pointing left.
    `<path d="M 140 170 Q 140 200 100 200 L 100 210 L 70 190 L 100 170 L 100 180 Q 125 180 125 160 Z" />` +
    `</g>`
  );
}

/** Draw Two glyph: "+2" with two mini overlapping card rects behind it. */
export function buildDrawTwoGlyph(color: Color): string {
  const fill = CARD_COLOR_HEX[color];
  return (
    `<g>` +
    // Two mini cards (white outlined, coloured fill) overlapping behind.
    `<rect x="55" y="120" width="40" height="60" rx="6" fill="${fill}" stroke="#ffffff" stroke-width="3" transform="rotate(-10 75 150)" />` +
    `<rect x="80" y="130" width="40" height="60" rx="6" fill="${fill}" stroke="#ffffff" stroke-width="3" transform="rotate(10 100 160)" />` +
    // "+2" text overlay.
    `<text x="135" y="155" font-family='${FONT_FAMILY}' font-size="56" ` +
    `font-weight="900" font-style="italic" text-anchor="middle" ` +
    `dominant-baseline="central" fill="${fill}" stroke="#ffffff" stroke-width="2" ` +
    `paint-order="stroke fill">+2</text>` +
    `</g>`
  );
}

/** 4-quadrant pie (red / yellow / green / blue) used by Wild + W4. */
export function buildWildPie(cx: number, cy: number, r: number): string {
  // Approach: a single inscribed circle painted via four rotated rects clipped
  // to the circle. We use a <clipPath> + four full-width <rect> tiles, each
  // a quadrant of the pie. Simpler + cheaper than four <path> arcs.
  const clipId = `wildClip_${cx}_${cy}_${r}`;
  return (
    `<g>` +
    `<defs><clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}" /></clipPath></defs>` +
    `<g clip-path="url(#${clipId})">` +
    // top-left = red
    `<rect x="${cx - r}" y="${cy - r}" width="${r}" height="${r}" fill="${CARD_COLOR_HEX.red}" />` +
    // top-right = yellow
    `<rect x="${cx}" y="${cy - r}" width="${r}" height="${r}" fill="${CARD_COLOR_HEX.yellow}" />` +
    // bottom-left = blue
    `<rect x="${cx - r}" y="${cy}" width="${r}" height="${r}" fill="${CARD_COLOR_HEX.blue}" />` +
    // bottom-right = green
    `<rect x="${cx}" y="${cy}" width="${r}" height="${r}" fill="${CARD_COLOR_HEX.green}" />` +
    `</g>` +
    // Outline ring.
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffffff" stroke-width="4" />` +
    `</g>`
  );
}

/** Wild glyph: pie centered on the card. */
export function buildWildGlyph(): string {
  return buildWildPie(100, 150, 55);
}

/** Wild Draw Four glyph: pie + "+4" overlay. */
export function buildWildDrawFourGlyph(): string {
  return (
    buildWildPie(100, 150, 55) +
    `<text x="100" y="220" font-family='${FONT_FAMILY}' font-size="50" ` +
    `font-weight="900" font-style="italic" text-anchor="middle" ` +
    `fill="#ffffff" stroke="#000000" stroke-width="2" paint-order="stroke fill">+4</text>`
  );
}

/** Short label used in the corners (digit, "S", "R", "+2", "W", "+4"). */
export function cornerLabelFor(type: CardType): string {
  switch (type) {
    case 'skip':
      return 'S';
    case 'reverse':
      return 'R';
    case 'draw_two':
      return '+2';
    case 'wild':
      return 'W';
    case 'wild_draw_four':
      return '+4';
    default:
      return type; // '0'..'9'
  }
}

/** Centre glyph picker — switches on type. */
function buildGlyph(card: Card): string {
  switch (card.type) {
    case 'skip':
      return buildSkipGlyph(card.color);
    case 'reverse':
      return buildReverseGlyph(card.color);
    case 'draw_two':
      return buildDrawTwoGlyph(card.color);
    case 'wild':
      return buildWildGlyph();
    case 'wild_draw_four':
      return buildWildDrawFourGlyph();
    default:
      return buildBigDigit(card.type, card.color);
  }
}

// ---------------------------------------------------------------------------
// Top-level renderers.
// ---------------------------------------------------------------------------

export interface RenderCardOpts {
  width?: number;
  faceDown?: boolean;
}

/** Build the SVG string for either a face-up card or a card back. */
export function renderCardSvg(card: Card, opts: RenderCardOpts = {}): string {
  const { width, faceDown = false } = opts;
  const dims =
    width != null
      ? ` width="${width}" height="${(width * CARD_VIEW_HEIGHT) / CARD_VIEW_WIDTH}"`
      : '';
  const body = faceDown ? renderCardBackInner() : renderCardFaceInner(card);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${dims} ` +
    `viewBox="0 0 ${CARD_VIEW_WIDTH} ${CARD_VIEW_HEIGHT}" ` +
    `preserveAspectRatio="xMidYMid meet">` +
    body +
    `</svg>`
  );
}

/** Inner markup for a face-up card (no <svg> wrapper). */
export function renderCardFaceInner(card: Card): string {
  return (
    buildCardBody(card.color) +
    buildInnerOval() +
    buildGlyph(card) +
    buildCornerLabel(cornerLabelFor(card.type), card.color)
  );
}

/** Inner markup for a face-down card back. */
export function renderCardBackInner(): string {
  return (
    // Black body.
    `<rect x="4" y="4" width="192" height="292" rx="16" ry="16" fill="#111111" stroke="#000000" stroke-width="4" />` +
    // Big red oval rotated.
    `<ellipse cx="100" cy="150" rx="90" ry="55" fill="${CARD_COLOR_HEX.red}" transform="rotate(-25 100 150)" />` +
    // UNO wordmark — bold italic, white, slight yellow shadow.
    `<text x="100" y="150" font-family='${FONT_FAMILY}' font-size="60" ` +
    `font-weight="900" font-style="italic" text-anchor="middle" ` +
    `dominant-baseline="central" fill="#ffffff" ` +
    `stroke="${CARD_COLOR_HEX.yellow}" stroke-width="2" paint-order="stroke fill" ` +
    `transform="rotate(-25 100 150)">UNO</text>`
  );
}

/** SVG string wrapped as a `data:` URI — handy as a CSS background. */
export function cardSvgDataUri(card: Card, opts: RenderCardOpts = {}): string {
  const raw = renderCardSvg(card, opts);
  return `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
}
