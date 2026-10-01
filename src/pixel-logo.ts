/**
 * Pixel "YAMX" splash. Letters fade in one at a time, then a warm pulse settles.
 */

import chalk from 'chalk';

const ROW_HEX = ['#F6D7A8', '#E8B56A', '#E09458', '#D97757', '#C46848', '#A3563C'];
const ROW_PAINT = ROW_HEX.map((hex) => chalk.hex(hex));
const BRIGHT = chalk.hex('#FFE7C2');
const GHOST = chalk.hex('#4A342C');

/** Each letter is 7 columns and 6 rows. */
const LETTERS: string[][] = [
  [
    '█     █',
    ' █   █ ',
    '  █ █  ',
    '   █   ',
    '   █   ',
    '   █   ',
  ],
  [
    ' █████ ',
    '█     █',
    '█     █',
    '███████',
    '█     █',
    '█     █',
  ],
  [
    '█     █',
    '██   ██',
    '█ █ █ █',
    '█  █  █',
    '█     █',
    '█     █',
  ],
  [
    '█     █',
    ' █   █ ',
    '  █ █  ',
    '   █   ',
    '  █ █  ',
    '█     █',
  ],
];

const LETTER_W = 7;
const GAP = '   ';

export function yamxPixelRows(): string[] {
  const height = LETTERS[0].length;
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(LETTERS.map((letter) => letter[y]).join(GAP));
  }
  return rows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function padCenter(visibleWidth: number, columns: number, painted: string): string {
  const pad = Math.max(0, Math.floor((columns - visibleWidth) / 2));
  return ' '.repeat(pad) + painted;
}

const SHADES = [' ', '░', '▒', '▓', '█'] as const;

function letterStart(index: number): number {
  return index * (LETTER_W + GAP.length);
}

/** shade 0..4 for one letter. Earlier letters stay solid. Later letters stay ghost. */
function paintRows(rows: string[], solidThrough: number, active: number, activeShade: number, bright: boolean): string[] {
  return rows.map((row, y) => {
    let out = '';
    for (let i = 0; i < row.length; i++) {
      const src = row[i];
      if (src === ' ') {
        out += ' ';
        continue;
      }
      let letter = 0;
      for (let n = 0; n < LETTERS.length; n++) {
        const start = letterStart(n);
        if (i >= start && i < start + LETTER_W) {
          letter = n;
          break;
        }
      }
      let shade = 1;
      if (letter < solidThrough) shade = 4;
      else if (letter === active) shade = activeShade;
      const glyph = shade === 4 ? '█' : SHADES[shade];
      if (glyph === ' ') {
        out += ' ';
      } else if (shade < 4) {
        out += GHOST(glyph);
      } else {
        out += (bright ? BRIGHT : ROW_PAINT[y])(glyph);
      }
    }
    return out;
  });
}

function draw(lines: string[], previous: number): void {
  if (previous > 0) process.stdout.write(`\x1b[${previous}A`);
  for (const line of lines) process.stdout.write(`\x1b[2K${line}\n`);
}

function rule(logoWidth: number, columns: number): string {
  const bar = '─'.repeat(Math.max(8, Math.floor(logoWidth * 0.55)));
  return padCenter(bar.length, columns, chalk.hex('#6B5346')(bar));
}

/** Fade the pixel name in, then leave it on screen. */
export async function playYamxLogo(columns: number, animate: boolean): Promise<void> {
  const rows = yamxPixelRows();
  const logoWidth = rows[0]?.length ?? 0;
  if (columns < logoWidth + 2) {
    console.log(chalk.hex('#D97757').bold('  YamX\n'));
    return;
  }

  const frame = (solidThrough: number, active: number, activeShade: number, bright = false) => [
    ...paintRows(rows, solidThrough, active, activeShade, bright).map((line) => padCenter(logoWidth, columns, line)),
    rule(logoWidth, columns),
  ];

  const settled = frame(LETTERS.length, -1, 4, false);

  if (!animate) {
    for (const line of settled) console.log(line);
    console.log('');
    return;
  }

  let shown = 0;
  const show = async (lines: string[], ms: number) => {
    draw(lines, shown);
    shown = lines.length;
    await sleep(ms);
  };

  for (let letter = 0; letter < LETTERS.length; letter++) {
    for (const shade of [1, 2, 3, 4]) {
      await show(frame(letter, letter, shade), shade === 4 ? 46 : 32);
    }
  }
  await show(frame(LETTERS.length, -1, 4, true), 70);
  await show(settled, 0);
  console.log('');
}
