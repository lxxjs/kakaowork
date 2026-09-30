import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as ed from '../dist/lib/editor.js';
import {chosung, filterRooms, score} from '../dist/lib/fuzzy.js';
import {fillTimes, Grouper} from '../dist/lib/transcript.js';
import {wrapRows} from '../dist/lib/text.js';
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

test('Grouper collapses same-sender same-minute bubbles under one header', () => {
	const g = new Grouper(true);
	const items = [
		m('a', {sender: '민지', time: '오후 3:25'}),
		m('b', {sender: '민지', time: '오후 3:25'}),
		m('c', {sender: '민지', time: '오후 3:26'}),
		m('d', {sender: '지수', time: '오후 3:26'}),
		m('e', {mine: true, time: '오후 3:26'}),
		m('f', {mine: true, time: '오후 3:26'}),
	].map(x => g.next(x));
	assert.deepEqual(items.map(i => i.header), [true, false, true, true, false, false]);
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
