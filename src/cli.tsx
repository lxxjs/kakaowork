import {readFileSync} from 'node:fs';
import {render} from 'ink';
import {App} from './app.js';
import {ProcessBridge} from './bridge/client.js';
import {DemoBridge} from './bridge/demo.js';
import type {Bridge} from './bridge/types.js';
import {useKakaoAccent} from './ui/theme.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version: string};

const USAGE = `kakaowork — 터미널에서 Claude Code 처럼 쓰는 카카오톡 (macOS)

사용법
  kakaowork [채팅방 이름] [옵션]

옵션
  --demo           카카오톡 없이 가상 데이터로 실행
  --hide           시작할 때 카카오톡 창 숨기기
  --theme kakao    강조색을 카카오 노랑으로 (기본: claude)
  -v, --version    버전
  -h, --help       도움말

필요 조건
  · macOS 카카오톡 앱이 실행 중이고 로그인되어 있어야 합니다
  · 터미널 앱에 손쉬운 사용(Accessibility) 권한이 필요합니다
`;

type Options = {demo: boolean; hide: boolean; theme: string; room?: string};

function parse(argv: string[]): Options {
	const options: Options = {demo: false, hide: false, theme: 'claude'};
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
		} else if (arg === '--theme') {
			options.theme = argv[++i] ?? 'claude';
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

if (options.theme === 'kakao') useKakaoAccent();

let bridge: Bridge;
try {
	bridge = options.demo ? new DemoBridge() : new ProcessBridge();
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}

const screen = {clear: () => {}};
const instance = render(
	<App
		bridge={bridge}
		demo={options.demo}
		appVersion={pkg.version}
		cwd={process.cwd()}
		initialRoom={options.room}
		hideOnStart={options.hide}
		resetScreen={() => screen.clear()}
	/>,
	{exitOnCtrlC: false},
);

// Switching rooms starts a fresh screen, the way Claude Code's /clear does.
screen.clear = () => {
	instance.clear();
	process.stdout.write('\u001B[2J\u001B[3J\u001B[H');
};

const shutdown = () => {
	bridge.dispose();
	instance.unmount();
};

process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

await instance.waitUntilExit();
bridge.dispose();
process.exit(0);
