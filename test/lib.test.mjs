import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as ed from '../dist/lib/editor.js';
import {chosung, filterRooms, score} from '../dist/lib/fuzzy.js';
import {fitCells, halfBlocks} from '../dist/lib/image.js';
import {formatDay} from '../dist/lib/time.js';
import {fillTimes, Grouper} from '../dist/lib/transcript.js';
import {width, wrapRows} from '../dist/lib/text.js';
import {layout} from '../dist/ui/PromptInput.js';

test('editor edits around wide and multi-code-unit characters', () => {
	let e = ed.insert(ed.emptyEditor, '안녕👋하세요');
	assert.equal(e.cursor, e.value.length);
	e = ed.left(ed.left(ed.left(e)));
	e = ed.backspace(e); // removes the whole emoji (a surrogate pair), not half of it
	assert.equal(e.value, '안녕하세요');
	e = ed.insert(ed.home(e), '> ');
	assert.equal(e.value, '> 안녕하세요');
});

test('editor word and line kills', () => {
	let e = ed.fromText('hello big world');
	e = ed.deleteWordBack(e);
	assert.equal(e.value, 'hello big ');
	e = ed.killToLineStart(e);
	assert.deepEqual(e, {value: '', cursor: 0});
	e = ed.killToLineEnd({value: 'ab\ncd', cursor: 1});
	assert.equal(e.value, 'a\ncd');
});

test('editor moves between lines and reports the edges', () => {
	const e = {value: 'first\nsecond line', cursor: 3};
	assert.equal(ed.vertical(e, -1), null);
	const down = ed.vertical(e, 1);
	assert.equal(down.cursor, 'first\n'.length + 3);
	assert.equal(ed.vertical(down, 1), null);
});

test('insert strips control characters but keeps newlines', () => {
	assert.equal(ed.insert(ed.emptyEditor, 'a\u0007b\r\nc').value, 'ab\nc');
});

test('chosung search finds rooms by initial consonants', () => {
	assert.equal(chosung('가족 모임'), 'ㄱㅈ ㅁㅇ');
	const rooms = [
		{index: 0, name: '개발팀', unread: 0, time: '', preview: '', muted: false, kind: 'group'},
		{index: 1, name: '가족', unread: 0, time: '', preview: '', muted: false, kind: 'group'},
		{index: 2, name: 'Design Sync', unread: 0, time: '', preview: '', muted: false, kind: 'group'},
	];
	assert.deepEqual(filterRooms(rooms, 'ㄱㅈ').map(r => r.name), ['가족']);
	assert.deepEqual(filterRooms(rooms, 'ㄱ').map(r => r.name), ['가족', '개발팀']);
	assert.deepEqual(filterRooms(rooms, 'dsync').map(r => r.name), ['Design Sync']);
	assert.ok(score('가족', '가족') > score('가', '가족'));
	assert.equal(score('zzz', '가족'), -1);
});

const m = (text, extra = {}) => ({row: 0, kind: 'text', mine: false, text, ...extra});

test('fillTimes gives a run the time of its labelled last bubble', () => {
	const out = fillTimes([
		m('a', {sender: '민지'}),
		m('b', {sender: '민지', time: '오후 3:25'}),
		m('c', {mine: true}),
		m('d', {mine: true, time: '오후 3:27'}),
		m('', {kind: 'divider'}),
		m('e', {sender: '민지'}),
	]);
	assert.deepEqual(out.map(x => x.time), ['오후 3:25', '오후 3:25', '오후 3:27', '오후 3:27', undefined, undefined]);
});

test('Grouper folds a sender\'s consecutive bubbles into one block', () => {
	const g = new Grouper(true);
	const items = [
		m('a', {sender: '민지', time: '오후 3:25'}),
		m('b', {sender: '민지', time: '오후 3:25'}),
		m('c', {sender: '민지', time: '오후 3:26'}),
		m('d', {sender: '지수', time: '오후 3:26'}),
		m('e', {mine: true, time: '오후 3:26'}),
		m('f', {mine: true, time: '오후 3:26'}),
	].map(x => g.next(x));
	assert.deepEqual(items.map(i => i.first), [true, false, false, true, true, false]);
	assert.deepEqual(items.map(i => i.showTime), [true, false, true, true, true, false]);
});

test('wrapRows breaks by display width, not code units', () => {
	const rows = wrapRows('가나다라마', 4);
	assert.deepEqual(rows.map(r => r.text), ['가나', '다라', '마']);
	assert.deepEqual(rows.map(r => r.start), [0, 2, 4]);
});

test('prompt layout puts the caret on the right wrapped row and column', () => {
	const value = '가나다라마바사\nab';
	const {rows, caret} = layout({value, cursor: 5}, 11);
	assert.deepEqual(rows.map(r => r.text), ['가나다라', '마바사', 'ab']);
	assert.deepEqual(caret, {row: 1, column: 2});
	assert.deepEqual(layout({value, cursor: 4}, 11).caret, {row: 1, column: 0});
	assert.deepEqual(layout({value, cursor: value.length}, 11).caret, {row: 2, column: 2});
});

test('formatDay spells out a separator date with its weekday', () => {
	assert.equal(formatDay('2026-09-30'), '2026년 9월 30일 수요일');
	assert.equal(formatDay('2026-01-04'), '2026년 1월 4일 일요일');
	assert.equal(formatDay('not a date'), 'not a date');
});

test('halfBlocks draws two pixels per cell and measures exactly its column count', () => {
	// 2×4: left column red over blue (twice), right column all green.
	const px = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 0]];
	const image = {w: 2, h: 4, rgb: Buffer.from(px.flat()).toString('base64')};
	const lines = halfBlocks(image, {columns: 2, rows: 2});
	assert.equal(lines.length, 2);
	for (const line of lines) assert.equal(width(line), 2);
	assert.equal(lines[0], '\u001B[38;2;255;0;0;48;2;0;0;255m▀\u001B[38;2;0;255;0;48;2;0;255;0m▀\u001B[39;49m');
});

test('halfBlocks averages when shrinking', () => {
	const image = {w: 2, h: 2, rgb: Buffer.from([0, 0, 0, 200, 100, 50, 0, 0, 0, 200, 100, 50]).toString('base64')};
	assert.equal(halfBlocks(image, {columns: 1, rows: 1})[0], '\u001B[38;2;100;50;25;48;2;100;50;25m▀\u001B[39;49m');
});

test('fitCells keeps pictures within 30 columns and 5 rows, preserving shape', () => {
	assert.deepEqual(fitCells({w: 96, h: 64}, 'photo', 80), {columns: 15, rows: 5}); // 3:2 is height-bound
	assert.deepEqual(fitCells({w: 96, h: 16}, 'photo', 80), {columns: 30, rows: 3}); // panorama is width-bound
	assert.deepEqual(fitCells({w: 96, h: 16}, 'photo', 10), {columns: 10, rows: 1}); // narrow terminal
	assert.deepEqual(fitCells({w: 72, h: 96}, 'photo', 80), {columns: 8, rows: 5});
});
