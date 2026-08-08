// Official TfL Underground line colours (Pantone-matched hex values from TfL's colour
// standard — see https://content.tfl.gov.uk/tfl-colour-standard.pdf). Corporate blue
// (used for chrome elsewhere in the app) is Pantone 072, the same blue as the Piccadilly
// line and the roundel's bar.
const LINE_COLORS: Record<string, string> = {
  bakerloo: '#B26300',
  central: '#DC241F',
  circle: '#FFD329',
  district: '#007D32',
  'hammersmith-city': '#F4A9BE',
  jubilee: '#A1A5A7',
  metropolitan: '#9B0058',
  northern: '#000000',
  piccadilly: '#0019A8',
  victoria: '#0098D8',
  'waterloo-city': '#93CEBA',
};

const DEFAULT_LINE_COLOR = '#6B7280';

export function lineColor(lineId: string): string {
  return LINE_COLORS[lineId] ?? DEFAULT_LINE_COLOR;
}

// Picks readable text colour for a coloured badge — most line colours are dark enough
// for white text, but the paler ones (Circle yellow, H&C pink, Jubilee grey, W&C teal)
// need black instead.
export function lineTextColor(lineId: string): string {
  const hex = lineColor(lineId).replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
}
