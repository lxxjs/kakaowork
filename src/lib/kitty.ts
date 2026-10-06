import type {Thumbnail} from '../bridge/types.js';
import {DIACRITICS} from './kitty-diacritics.js';

/**
 * Pictures through kitty's graphics protocol with Unicode placeholders: the PNG is sent to
 * the terminal once, and the picture's cells are drawn as ordinary (if odd) text — U+10EEEE
 * plus diacritics for row and column, coloured with the image id. The terminal paints the
 * image wherever those cells land, so it scrolls and redraws with the rest of the UI.
 * https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders
 */
export const graphics = {enabled: false, kitty: false, solid: false};

/**
 * Whether to show pictures at all. Off by default ([사진] / [이모티콘] instead): the first
 * of the --images flag, KAKAOWORK_IMAGES and the saved setting that says anything wins.
 * A renderer name (kitty|blocks|solid) also means on.
 */
export function imagesEnabled(flag: string | undefined, env: NodeJS.ProcessEnv, saved: string | undefined): boolean {
	for (const value of [flag, env.KAKAOWORK_IMAGES, saved]) {
		if (value === undefined || value === '' || value === 'auto') continue;
		return value === 'on' || RENDERERS.includes(value);
	}

	return flag === 'auto';
}

/** Apple Terminal draws block glyphs short of the cell, so pictures use plain backgrounds there. */
export function detectSolid(env: NodeJS.ProcessEnv = process.env): boolean {
	const forced = env.KAKAOWORK_IMAGES;
	if (forced && RENDERERS.includes(forced)) return forced === 'solid';
	return env.TERM_PROGRAM === 'Apple_Terminal';
}

const RENDERERS = ['kitty', 'blocks', 'solid'];
const PLACEHOLDER = String.fromCodePoint(0x10eeee);
const CHUNK = 4096;

/** Ghostty and kitty draw placeholders. Set KAKAOWORK_IMAGES=kitty|blocks to override. */
export function detectKitty(env: NodeJS.ProcessEnv = process.env): boolean {
	const forced = env.KAKAOWORK_IMAGES;
	if (forced && RENDERERS.includes(forced)) return forced === 'kitty';
	return env.TERM_PROGRAM === 'ghostty' || env.TERM === 'xterm-ghostty' || env.TERM === 'xterm-kitty' || Boolean(env.KITTY_WINDOW_ID);
}

/** Transmits a PNG and creates a virtual placement `columns`×`rows` cells big. */
export function transmit(id: number, png: string, columns: number, rows: number): string {
	let out = '';
	for (let at = 0; at < png.length || at === 0; at += CHUNK) {
		const more = at + CHUNK < png.length ? 1 : 0;
		const keys = at === 0 ? `a=T,U=1,f=100,t=d,q=2,i=${id},c=${columns},r=${rows},m=${more}` : `m=${more}`;
		out += `\u001B_G${keys};${png.slice(at, at + CHUNK)}\u001B\\`;
	}

	return out;
}

/** The placeholder text for one placement: `rows` lines of `columns` cells each. */
export function placeholderLines(id: number, columns: number, rows: number): string[] {
	const fg = `\u001B[38;2;${(id >> 16) & 255};${(id >> 8) & 255};${id & 255}m`;
	return Array.from({length: rows}, (_, row) => {
		let cells = '';
		for (let column = 0; column < columns; column++) cells += PLACEHOLDER + DIACRITICS[row] + DIACRITICS[column];
		return fg + cells + '\u001B[39m';
	});
}

/**
 * Frees every image and placement on the current screen. Sent on the alternate screen at
 * startup and before leaving it: Ghostty keeps a screen's images after the app that sent
 * them is gone, and a picture sent later under the same id is drawn in the old placement's
 * cells — shrunk or cut off inside the space laid out for the new one.
 */
export const deleteAll = '\u001B_Ga=d,d=A,q=2\u001B\\';

const placed = new WeakMap<Thumbnail, Map<string, number>>();
// Ids travel in the placeholder's 24-bit colour. Starting somewhere random keeps a run from
// reusing the ids of one that was killed before it could clean up.
let nextId = 1 + Math.floor(Math.random() * 0xf00000);

/**
 * Placeholder lines for a picture, sending it to the terminal the first time it is shown
 * at this size.
 */
export function kittyPicture(image: Thumbnail & {png: string}, columns: number, rows: number, write = (s: string) => process.stdout.write(s)): string[] {
	const sizes = placed.get(image) ?? new Map<string, number>();
	placed.set(image, sizes);
	const key = `${columns}x${rows}`;
	let id = sizes.get(key);
	if (id === undefined) {
		id = nextId++;
		sizes.set(key, id);
		write(transmit(id, image.png, columns, rows));
	}

	return placeholderLines(id, columns, rows);
}
