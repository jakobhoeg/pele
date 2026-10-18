export type ImageType = 'png' | 'jpeg';

const padding = 32;
const maxScale = 2;
const fontDelay = 150;
// Browsers refuse canvases past about this many pixels on a side.
const maxCanvasSide = 16384;

// Theme variables the diagram may read. Any others the page sets are found by walking its styles.
const themeVariables = [
  'bg', 'fg', 'muted', 'line', 'surface', 'surface-alt', 'border', 'accent', 'critical', 'radius', 'font', 'font-mono',
  ...Array.from({ length: 8 }, (_, index) => `series-${index + 1}`),
].map((name) => `--pele-${name}`);

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// `U+0000-00FF, U+0131, U+4??` as code point ranges.
function unicodeRanges(value: string): [number, number][] {
  return value.split(',').map((part) => part.trim().replace(/^u\+/i, '')).filter(Boolean).map((part) => {
    const [from, to] = part.includes('-') ? part.split('-') : [part.replace(/\?/g, '0'), part.replace(/\?/g, 'f')];
    return [parseInt(from, 16), parseInt(to, 16)];
  });
}

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '').toLowerCase();

const fontData = new Map<string, Promise<string>>();

// An SVG drawn as an image cannot reach the page's fonts. Embed the faces its labels use,
// only the subsets that cover the text, so the image matches what was measured.
async function embeddedFonts(fontStacks: string[], text: string): Promise<string> {
  const families = new Set(fontStacks.flatMap((stack) => stack.split(',').map(unquote)));
  const codePoints = [...new Set([...text].map((character) => character.codePointAt(0)!))];
  const rules: CSSFontFaceRule[] = [];
  const bases = new Map<CSSFontFaceRule, string>();
  for (const sheet of document.styleSheets) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue; // A stylesheet from another origin cannot be read.
    }
    for (const rule of cssRules) {
      if (!(rule instanceof CSSFontFaceRule) || !families.has(unquote(rule.style.getPropertyValue('font-family')))) continue;
      const range = rule.style.getPropertyValue('unicode-range');
      const ranges = range ? unicodeRanges(range) : [[0, 0x10ffff] as [number, number]];
      if (!codePoints.some((point) => ranges.some(([from, to]) => point >= from && point <= to))) continue;
      rules.push(rule);
      bases.set(rule, sheet.href ?? document.baseURI);
    }
  }
  const faces = await Promise.all(rules.map(async (rule) => {
    const source = rule.style.getPropertyValue('src').match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
    if (!source) return '';
    const url = new URL(source, bases.get(rule)).href;
    let data = fontData.get(url);
    if (!data) {
      data = fetch(url).then((response) => {
        if (!response.ok) throw new Error(`Could not load ${url}`);
        return response.blob();
      }).then(readAsDataUrl);
      fontData.set(url, data);
    }
    try {
      const declarations = [...rule.style]
        .filter((name) => name !== 'src')
        .map((name) => `${name}:${rule.style.getPropertyValue(name)}`);
      return `@font-face{${declarations.join(';')};src:url(${await data})}`;
    } catch {
      fontData.delete(url);
      return ''; // The image falls back to a system font.
    }
  }));
  return faces.join('');
}

// Draw a rendered diagram as an image on the given background color.
export async function diagramImage(svg: SVGSVGElement, type: ImageType, background: string): Promise<Blob> {
  const { width, height } = svg.viewBox.baseVal;
  const style = getComputedStyle(svg);
  const copy = svg.cloneNode(true) as SVGSVGElement;

  const names = new Set(themeVariables);
  for (const name of style) if (name.startsWith('--pele-')) names.add(name);
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) copy.style.setProperty(name, value);
  }
  copy.style.setProperty('--pele-bg', background);
  copy.style.maxWidth = 'none';
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));

  const fonts = await embeddedFonts([style.getPropertyValue('--pele-font'), style.getPropertyValue('--pele-font-mono')], svg.textContent ?? '');
  if (fonts) {
    const sheet = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    sheet.textContent = fonts;
    copy.prepend(sheet);
  }

  const markup = new XMLSerializer().serializeToString(copy);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // An image decodes before its embedded fonts have loaded, and draws again once they have.
    if (fonts) await new Promise((resolve) => window.setTimeout(resolve, fontDelay));

    const scale = Math.min(maxScale, maxCanvasSide / (width + padding * 2), maxCanvasSide / (height + padding * 2));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((width + padding * 2) * scale);
    canvas.height = Math.round((height + padding * 2) * scale);
    const context = canvas.getContext('2d')!;
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, padding * scale, padding * scale, width * scale, height * scale);

    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Could not encode the image.')),
      `image/${type}`,
      0.92,
    ));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function setupPlaygroundExport(getDiagram: () => SVGSVGElement | null, onError: (message: string) => void) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-save-image]')];
  // Menu items stay focusable when unavailable, so the menu's arrow keys still reach them.
  const refresh = () => {
    const available = getDiagram() !== null;
    buttons.forEach((button) => button.setAttribute('aria-disabled', String(!available)));
  };
  buttons.forEach((button) => button.addEventListener('click', async () => {
    const svg = getDiagram();
    if (!svg) return;
    const type = button.dataset.saveImage as ImageType;
    try {
      // The image takes the background the diagram has in the preview.
      const background = getComputedStyle(svg).getPropertyValue('--pele-bg').trim() || getComputedStyle(document.body).backgroundColor;
      const blob = await diagramImage(svg, type, background);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      // The root's classes name the diagram type, as `pele pele-flowchart`.
      const name = [...svg.classList].find((name) => name.startsWith('pele-')) ?? 'pele-diagram';
      link.download = `${name}.${type === 'jpeg' ? 'jpg' : 'png'}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch {
      onError(`Could not save the diagram as ${type.toUpperCase()}.`);
    }
  }));
  refresh();
  return { refresh };
}
