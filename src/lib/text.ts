import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter();

export function graphemes(text: string): string[] {
	return Array.from(segmenter.segment(text), s => s.segment);
}

export function width(text: string): number {
	return stringWidth(text);
}

export function truncate(text: string, max: number): string {
	if (max <= 0) return '';
	if (width(text) <= max) return text;
	let out = '';
	let used = 0;
	for (const g of graphemes(text)) {
		const w = width(g);
		if (used + w > max - 1) break;
		out += g;
		used += w;
	}

	return out + '…';
}

export function pad(text: string, columns: number): string {
	return text + ' '.repeat(Math.max(0, columns - width(text)));
}

export function center(text: string, columns: number): string {
	const free = Math.max(0, columns - width(text));
	const left = Math.floor(free / 2);
	return ' '.repeat(left) + text + ' '.repeat(free - left);
}

export type Row = {text: string; start: number};

/** Break one line into rows of at most `max` columns, recording where each row starts. */
export function wrapRows(line: string, max: number): Row[] {
	const rows: Row[] = [];
	let text = '';
	let start = 0;
	let offset = 0;
	let used = 0;
	for (const g of graphemes(line)) {
		const w = width(g);
		if (used + w > max && text) {
			rows.push({text, start});
			text = '';
			start = offset;
			used = 0;
		}

		text += g;
		used += w;
		offset += g.length;
	}

	rows.push({text, start});
	return rows;
}
