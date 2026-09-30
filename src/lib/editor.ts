import {graphemes} from './text.js';

/** Text being typed at the prompt. `cursor` is a UTF-16 offset into `value`. */
export type Editor = {value: string; cursor: number};

export const emptyEditor: Editor = {value: '', cursor: 0};

function boundaries(value: string): number[] {
	const stops = [0];
	let offset = 0;
	for (const g of graphemes(value)) {
		offset += g.length;
		stops.push(offset);
	}

	return stops;
}

function prev(value: string, cursor: number): number {
	const stops = boundaries(value);
	for (let i = stops.length - 1; i >= 0; i--) if (stops[i] < cursor) return stops[i];
	return 0;
}

function next(value: string, cursor: number): number {
	for (const stop of boundaries(value)) if (stop > cursor) return stop;
	return value.length;
}

function lineStart(value: string, cursor: number): number {
	return value.lastIndexOf('\n', cursor - 1) + 1;
}

function lineEnd(value: string, cursor: number): number {
	const end = value.indexOf('\n', cursor);
	return end === -1 ? value.length : end;
}

export function insert(ed: Editor, text: string): Editor {
	const clean = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
	if (!clean) return ed;
	return {value: ed.value.slice(0, ed.cursor) + clean + ed.value.slice(ed.cursor), cursor: ed.cursor + clean.length};
}

export function backspace(ed: Editor): Editor {
	if (ed.cursor === 0) return ed;
	const at = prev(ed.value, ed.cursor);
	return {value: ed.value.slice(0, at) + ed.value.slice(ed.cursor), cursor: at};
}

export function deleteForward(ed: Editor): Editor {
	if (ed.cursor >= ed.value.length) return ed;
	return {value: ed.value.slice(0, ed.cursor) + ed.value.slice(next(ed.value, ed.cursor)), cursor: ed.cursor};
}

export function left(ed: Editor): Editor {
	return {...ed, cursor: prev(ed.value, ed.cursor)};
}

export function right(ed: Editor): Editor {
	return {...ed, cursor: next(ed.value, ed.cursor)};
}

export function home(ed: Editor): Editor {
	return {...ed, cursor: lineStart(ed.value, ed.cursor)};
}

export function end(ed: Editor): Editor {
	return {...ed, cursor: lineEnd(ed.value, ed.cursor)};
}

export function wordLeft(ed: Editor): Editor {
	let i = ed.cursor;
	while (i > 0 && /\s/.test(ed.value[i - 1])) i--;
	while (i > 0 && !/\s/.test(ed.value[i - 1])) i--;
	return {...ed, cursor: i};
}

export function wordRight(ed: Editor): Editor {
	let i = ed.cursor;
	while (i < ed.value.length && /\s/.test(ed.value[i])) i++;
	while (i < ed.value.length && !/\s/.test(ed.value[i])) i++;
	return {...ed, cursor: i};
}

export function deleteWordBack(ed: Editor): Editor {
	const to = wordLeft(ed).cursor;
	return {value: ed.value.slice(0, to) + ed.value.slice(ed.cursor), cursor: to};
}

export function killToLineStart(ed: Editor): Editor {
	const start = lineStart(ed.value, ed.cursor);
	const from = start === ed.cursor && start > 0 ? start - 1 : start;
	return {value: ed.value.slice(0, from) + ed.value.slice(ed.cursor), cursor: from};
}

export function killToLineEnd(ed: Editor): Editor {
	const stop = lineEnd(ed.value, ed.cursor);
	const to = stop === ed.cursor && stop < ed.value.length ? stop + 1 : stop;
	return {value: ed.value.slice(0, ed.cursor) + ed.value.slice(to), cursor: ed.cursor};
}

/** Move between lines of a multi-line draft; null when already on the first/last line. */
export function vertical(ed: Editor, direction: -1 | 1): Editor | null {
	const start = lineStart(ed.value, ed.cursor);
	const column = ed.cursor - start;
	if (direction < 0) {
		if (start === 0) return null;
		const prevStart = lineStart(ed.value, start - 1);
		return {...ed, cursor: Math.min(prevStart + column, start - 1)};
	}

	const stop = lineEnd(ed.value, ed.cursor);
	if (stop === ed.value.length) return null;
	const nextStop = lineEnd(ed.value, stop + 1);
	return {...ed, cursor: Math.min(stop + 1 + column, nextStop)};
}

export function fromText(value: string): Editor {
	return {value, cursor: value.length};
}
