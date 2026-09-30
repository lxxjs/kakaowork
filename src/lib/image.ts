import type {MessageKind, Thumbnail} from '../bridge/types.js';

export type Cells = {columns: number; rows: number};

/**
 * How many terminal cells a picture gets. Each cell shows two stacked pixels (see
 * `halfBlocks`), so a cell is one pixel wide and two tall — a `w`×`h` picture keeps its
 * shape at `columns` wide and `columns * h / w / 2` rows tall.
 *
 * @param available columns left for the message body
 */
export function fitCells(image: Pick<Thumbnail, 'w' | 'h'>, kind: MessageKind, available: number): Cells {
	// Kept small so a few pictures don't push the conversation off screen.
	const limit = LIMITS[kind === 'emoticon' ? 'emoticon' : 'photo'];
	const maxColumns = Math.max(1, Math.min(available, limit.columns));
	const columns = Math.max(1, Math.min(maxColumns, Math.round((limit.rows * 2 * image.w) / image.h)));
	const rows = Math.max(1, Math.min(limit.rows, Math.round((columns * image.h) / image.w / 2)));
	return {columns, rows};
}

const LIMITS = {
	photo: {columns: 30, rows: 5}, // ~15 Hangul syllables wide (each is two columns)
	emoticon: {columns: 5, rows: 3},
};

type Pixels = {w: number; h: number; data: Uint8Array};

function decode(image: Thumbnail): Pixels {
	return {w: image.w, h: image.h, data: new Uint8Array(Buffer.from(image.rgb, 'base64'))};
}

/** Averages the source pixels that fall inside one target pixel (a box filter). */
function sample(src: Pixels, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
	const xa = Math.floor(x0);
	const ya = Math.floor(y0);
	const xb = Math.max(xa + 1, Math.ceil(x1));
	const yb = Math.max(ya + 1, Math.ceil(y1));
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	for (let y = ya; y < yb && y < src.h; y++) {
		for (let x = xa; x < xb && x < src.w; x++) {
			const i = (y * src.w + x) * 3;
			r += src.data[i];
			g += src.data[i + 1];
			b += src.data[i + 2];
			n++;
		}
	}

	return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
}

/**
 * Draws a picture with `▀`: the foreground colours the top pixel of a cell and the
 * background the bottom one. Plain truecolour escapes, so it works in any modern terminal
 * and Ink measures each line as exactly `columns` wide.
 */
export function halfBlocks(image: Thumbnail, {columns, rows}: Cells): string[] {
	const src = decode(image);
	const sx = src.w / columns;
	const sy = src.h / (rows * 2);
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = '';
		let last = '';
		for (let col = 0; col < columns; col++) {
			const top = sample(src, col * sx, row * 2 * sy, (col + 1) * sx, (row * 2 + 1) * sy);
			const bottom = sample(src, col * sx, (row * 2 + 1) * sy, (col + 1) * sx, (row * 2 + 2) * sy);
			const sgr = `\u001B[38;2;${top.join(';')};48;2;${bottom.join(';')}m`;
			line += (sgr === last ? '' : sgr) + '▀';
			last = sgr;
		}

		lines.push(line + '\u001B[39;49m');
	}

	return lines;
}
