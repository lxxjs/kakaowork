import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {constants, copyFileSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {BridgeError, type Bridge, type BridgeEvent, type ChatRoom, type Message, type Status, type UnreadRow} from './types.js';

type Pending = {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

export function bridgeBinaryPath(): string {
	return process.env.KAKAOWORK_BRIDGE ?? fileURLToPath(new URL('../kakao-bridge', import.meta.url));
}

/**
 * Copies the bridge to a directory of its own for this run. macOS's screen capture service
 * tells its clients apart by executable path, so a second kakaowork running the same binary
 * breaks picture capture for both.
 */
function privateCopy(binary: string): string | undefined {
	try {
		const copy = join(mkdtempSync(join(tmpdir(), 'kakaowork-')), 'kakao-bridge');
		copyFileSync(binary, copy, constants.COPYFILE_FICLONE);
		return copy;
	} catch {
		return undefined;
	}
}

/** Talks JSON lines to the Swift helper that drives KakaoTalk through the Accessibility API. */
export class ProcessBridge implements Bridge {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, Pending>();
	private readonly listeners = new Set<(event: BridgeEvent) => void>();
	private nextId = 1;
	private stderr = '';
	private exited = false;

	constructor(binary = bridgeBinaryPath()) {
		if (!existsSync(binary)) {
			throw new BridgeError('no_bridge', `브리지 바이너리가 없습니다: ${binary} (다시 설치해 주세요: brew reinstall kakaowork)`);
		}

		const copy = privateCopy(binary);
		const cleanUp = () => {
			if (copy) rmSync(dirname(copy), {recursive: true, force: true});
		};

		process.once('exit', cleanUp);
		this.child = spawn(copy ?? binary, [], {stdio: ['pipe', 'pipe', 'pipe']});
		createInterface({input: this.child.stdout}).on('line', line => this.receive(line));
		this.child.stderr.on('data', (chunk: Buffer) => {
			this.stderr = (this.stderr + chunk.toString()).slice(-2000);
		});
		this.child.on('exit', code => {
			this.exited = true;
			cleanUp();
			for (const [, p] of this.pending) {
				clearTimeout(p.timer);
				p.reject(new BridgeError('bridge_exit', '브리지 프로세스가 종료되었습니다'));
			}

			this.pending.clear();
			this.emit({event: 'exit', code, stderr: this.stderr});
		});
	}

	status(prompt = false) {
		return this.call<Status>('status', {prompt});
	}

	chats(limit = 30) {
		return this.call<{rooms: ChatRoom[]; totalUnread: number | null}>('chats', {limit});
	}

	open(name: string, index?: number) {
		return this.call<{title: string; alreadyOpen: boolean}>('open', {name, index}, 15_000);
	}

	messages(title: string, limit: number, watch: boolean) {
		return this.call<{messages: Message[]; rowCount: number}>('messages', {title, limit, watch}, 60_000);
	}

	older(title: string, count: number) {
		return this.call<{messages: Message[]; rowCount: number; shift: number; exhausted: boolean}>('older', {title, count}, 60_000);
	}

	unread(title: string, from: number) {
		return this.call<{rows: UnreadRow[]}>('unread', {title, from});
	}

	async send(title: string, text: string) {
		await this.call('send', {title, text});
	}

	async watch(options: {chats?: boolean; stopRoom?: boolean}) {
		await this.call('watch', {...(options.chats === undefined ? {} : {chats: options.chats}), ...(options.stopRoom ? {title: null} : {})});
	}

	async close(title: string) {
		await this.call('close', {title});
	}

	async configure(options: {capture?: boolean; sharp?: boolean; ask?: boolean}) {
		await this.call('config', options);
	}

	async setHidden(hidden: boolean) {
		await this.call(hidden ? 'hide' : 'show');
	}

	on(listener: (event: BridgeEvent) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Closes the bridge's stdin; it puts KakaoTalk's windows back in place and exits. */
	dispose() {
		if (!this.exited) this.child.stdin.end();
	}

	private call<T>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
		if (this.exited) return Promise.reject(new BridgeError('bridge_exit', '브리지 프로세스가 종료되었습니다'));
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new BridgeError('timeout', `카카오톡 응답 시간 초과 (${cmd})`));
			}, timeoutMs);
			this.pending.set(id, {resolve, reject, timer});
			this.child.stdin.write(JSON.stringify({id, cmd, ...args}) + '\n');
		});
	}

	private receive(line: string) {
		let data: any;
		try {
			data = JSON.parse(line);
		} catch {
			return;
		}

		if (data.event) {
			this.emit(data as BridgeEvent);
			return;
		}

		const pending = this.pending.get(data.id);
		if (!pending) return;
		this.pending.delete(data.id);
		clearTimeout(pending.timer);
		if (data.ok) pending.resolve(data.result);
		else pending.reject(new BridgeError(data.error?.code ?? 'unknown', data.error?.message ?? '알 수 없는 오류'));
	}

	private emit(event: BridgeEvent) {
		for (const listener of this.listeners) listener(event);
	}
}
