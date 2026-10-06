const ISSUES = 'https://github.com/lxxjs/kakaowork/issues/new';

/** What a bug report says about the setup. Never anything from a conversation. */
export type BugEnvironment = {
	app: string;
	kakaoTalk?: string;
	os: string;
	terminal: string;
	node: string;
	images: string;
};

export function environmentLines(env: BugEnvironment): string[] {
	return [
		`kakaowork ${env.app}`,
		`KakaoTalk ${env.kakaoTalk ?? '?'}`,
		`macOS ${env.os}`,
		`터미널 ${env.terminal}`,
		`Node ${env.node}`,
		`사진 보기 ${env.images}`,
	];
}

/**
 * A GitHub "new issue" link with the report filled in: the first line of `text` as the
 * title, and the setup listed under what the user wrote. The user reviews and submits it
 * in the browser.
 */
export function bugReportUrl(text: string, env: BugEnvironment): string {
	const said = text.trim();
	const [first = ''] = said.split('\n');
	const title = first.length > 70 ? first.slice(0, 69) + '…' : first;
	const body = [
		'### 무슨 일이 있었나요',
		said || '<!-- 어떤 상황에서 무엇이 잘못됐는지 적어 주세요 -->',
		'',
		'### 환경',
		...environmentLines(env).map(line => `- ${line}`),
	].join('\n');
	return `${ISSUES}?${new URLSearchParams({title, body}).toString()}`;
}
