import {readFileSync} from 'node:fs';
import {render} from 'ink';
import {App} from './app.js';
import {ProcessBridge} from './bridge/client.js';
import {DemoBridge} from './bridge/demo.js';
import type {Bridge} from './bridge/types.js';
import {deleteAll, detectKitty, detectSolid, graphics, imagesEnabled} from './lib/kitty.js';
import {loadSettings} from './lib/settings.js';
import {setTheme} from './ui/theme.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version: string};

const USAGE = `kakaowork — 터미널에서 Claude Code 처럼 쓰는 카카오톡 (macOS)

사용법
  kakaowork [채팅방 이름] [옵션]

옵션
  --demo           카카오톡 없이 가상 데이터로 실행
  --no-hide        카카오톡 창을 숨기지 않고 그대로 두기
  --images         사진·이모티콘을 그림으로 보기 (기본: [사진] 글자로만, 화면 기록 권한 필요)
  --no-images      사진·이모티콘을 글자로만 보기
  --theme claude   강조색을 Claude 주황으로 (기본: kakao 노랑, /theme 로 바꾸면 저장됨)
  -v, --version    버전
  -h, --help       도움말

필요 조건
  · macOS 카카오톡 앱이 실행 중이고 로그인되어 있어야 합니다
  · 터미널 앱에 손쉬운 사용(Accessibility) 권한이 필요합니다
`;

type Options = {demo: boolean; hide: boolean; theme?: string; images?: string; room?: string};

function parse(argv: string[]): Options {
	const options: Options = {demo: false, hide: true};
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '-h' || arg === '--help') {
			process.stdout.write(USAGE);
			process.exit(0);
		} else if (arg === '-v' || arg === '--version') {
			process.stdout.write(pkg.version + '\n');
			process.exit(0);
		} else if (arg === '--demo') {
			options.demo = true;
		} else if (arg === '--hide') {
			options.hide = true;
		} else if (arg === '--no-hide') {
			options.hide = false;
		} else if (arg === '--images') {
			options.images = 'on';
		} else if (arg.startsWith('--images=')) {
			options.images = arg.slice('--images='.length);
		} else if (arg === '--no-images') {
			options.images = 'off';
		} else if (arg === '--theme') {
			options.theme = argv[++i];
		} else if (arg.startsWith('--theme=')) {
			options.theme = arg.slice('--theme='.length);
		} else if (arg.startsWith('-')) {
			process.stderr.write(`알 수 없는 옵션: ${arg}\n\n${USAGE}`);
			process.exit(2);
		} else {
			rest.push(arg);
		}
	}

	if (rest.length > 0) options.room = rest.join(' ');
	return options;
}

const options = parse(process.argv.slice(2));

if (!process.stdin.isTTY || !process.stdout.isTTY) {
	process.stderr.write('kakaowork 는 대화형 터미널에서 실행해야 합니다.\n');
	process.exit(1);
}

if (process.platform !== 'darwin' && !options.demo) {
	process.stderr.write('kakaowork 는 macOS 카카오톡 앱이 필요합니다. --demo 로 UI 만 체험할 수 있어요.\n');
	process.exit(1);
}

setTheme(options.theme ?? loadSettings().theme);

// Ghostty and kitty can show real pictures; tell the bridge to send full-resolution PNGs.
// Pictures are opt-in; when on, Ghostty and kitty get real images, Apple Terminal plain
// background cells, everything else half-blocks.
graphics.enabled = imagesEnabled(options.images, process.env, loadSettings().images);
if (options.images && ['kitty', 'blocks', 'solid'].includes(options.images)) process.env.KAKAOWORK_IMAGES = options.images;
graphics.kitty = detectKitty();
graphics.solid = !graphics.kitty && detectSolid();

let bridge: Bridge;
try {
	bridge = options.demo ? new DemoBridge() : new ProcessBridge();
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}

const instance = render(
	<App bridge={bridge} demo={options.demo} appVersion={pkg.version} cwd={process.cwd()} initialRoom={options.room} hideOnStart={options.hide} />,
	// Like Claude Code's fullscreen mode: draw on the alternate screen, so quitting puts the
	// terminal back exactly as it was and no chat is left in its scrollback.
	{exitOnCtrlC: false, alternateScreen: true},
);

// Mouse reporting (button events, SGR encoding) so the wheel scrolls the conversation, and
// focus reporting so unread counts are refreshed only while the terminal is in front.
const reportingOn = '\u001B[?1000h\u001B[?1006h\u001B[?1004h';
const reportingOff = '\u001B[?1000l\u001B[?1006l\u001B[?1004l';
process.stdout.write(reportingOn + (graphics.kitty ? deleteAll : ''));
process.on('exit', () => process.stdout.write(reportingOff + (graphics.kitty ? deleteAll : '')));

const shutdown = () => {
	if (graphics.kitty) process.stdout.write(deleteAll);
	bridge.dispose();
	instance.unmount();
};

process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

await instance.waitUntilExit();
bridge.dispose();
process.exit(0);
