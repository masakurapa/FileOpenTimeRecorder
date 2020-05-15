import * as vscode from 'vscode';
import * as fs from 'fs';

interface FileTime {[key: string]: number};

const STATUS_BAR_TEXT = 'FileOpenTimeRecorder';
const INACTIVE = 'other files';
const WORKSPACE_ROOT_PATH = vscode.workspace.rootPath ? `${vscode.workspace.rootPath}/` : '/';
const DEFAULT_OUTPUT_PATH = `${WORKSPACE_ROOT_PATH}/.fileOpenTimeRecorder`;

const RECORDING_STATUS_START = 0;
const RECORDING_STATUS_PAUSE = 1;
const RECORDING_STATUS_STOP = 2;

const config = vscode.workspace.getConfiguration('fileOpenTimeRecorder');

let files: FileTime = {};

let currentFile = '';
let openedTime = 0;
let recording = RECORDING_STATUS_STOP;

export function activate(context: vscode.ExtensionContext) {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
	item.text = 'FileOpenTimeRecorder';
	item.command = 'fileOpenTimeRecorder.selectCommand';
	item.show();

	let disposableChangeActiveTextEditor: vscode.Disposable;

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileOpenTimeRecorder.selectCommand',
		async () => {
			const val = await vscode.window.showQuickPick(['Start', 'Pause', 'Stop'], {
				placeHolder: 'Select Command',
			});

			if (val !== undefined) {
				switch (val) {
					case 'Start':
						vscode.commands.executeCommand('fileOpenTimeRecorder.start');
						break;
					case 'Pause':
						vscode.commands.executeCommand('fileOpenTimeRecorder.pause');
						break;
					case 'Stop':
						vscode.commands.executeCommand('fileOpenTimeRecorder.stop');
						break;
				}
			}
		}
	));

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileOpenTimeRecorder.start',
		async () => {
			if (recording === RECORDING_STATUS_START) {
				vscode.window.showInformationMessage('recording has already started');
				return;
			}

			item.text = `$(debug-start) ${STATUS_BAR_TEXT}`;
			recording = RECORDING_STATUS_START;
			changeCurrentFile(vscode.window.activeTextEditor);

			disposableChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(
				(editor: vscode.TextEditor|undefined) => {
					fixCurrentFileTime();
					changeCurrentFile(editor);
				}
			);
		}
	));

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileOpenTimeRecorder.pause',
		async () => {
			if (recording !== RECORDING_STATUS_START) {
				vscode.window.showInformationMessage('recording has not started');
				return;
			}

			item.text = `$(debug-pause) ${STATUS_BAR_TEXT}`;
			recording = RECORDING_STATUS_PAUSE;
			disposableChangeActiveTextEditor.dispose();

			fixCurrentFileTime();
		}
	));

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileOpenTimeRecorder.stop',
		async () => {
			if (recording === RECORDING_STATUS_STOP) {
				vscode.window.showInformationMessage('recording has not started');
				return;
			}

			item.text = `$(debug-stop) ${STATUS_BAR_TEXT}`;
			recording = RECORDING_STATUS_STOP;
			disposableChangeActiveTextEditor.dispose();

			writeResult();

			// reset recording result
			currentFile = '';
			openedTime = 0;
			files = {};
		}
	));
}

export function deactivate() {
	if (recording === RECORDING_STATUS_START || recording === RECORDING_STATUS_PAUSE) {
		writeResult();
	}
}

// returns unix timestamp in seconds
const unixtime = (): number => {
	return Math.floor((new Date()).getTime() / 1000);
};

// fixe current file time
const fixCurrentFileTime = (): void => {
	files[currentFile] += unixtime() - openedTime;
};

const changeCurrentFile = (editor: vscode.TextEditor|undefined): void => {
	const file = editor === undefined ?
		INACTIVE : editor.document.uri.path.replace(WORKSPACE_ROOT_PATH, '');

	if (files[file] === undefined) {
		files[file] = 0;
	}

	currentFile = file;
	openedTime = unixtime();
};

// returns zero padding string
const padding = (n: number): string => {
	return `0${n}`.slice(-2);
};

// returns date formatted as YmdHis
const formattedDate = (): string => {
	const date = new Date();
	const m = padding(date.getMonth() + 1);
	const d = padding(date.getDate());
	const h = padding(date.getHours());
	const i = padding(date.getMinutes());
	const s = padding(date.getSeconds());
	return `${date.getFullYear()}${m}${d}${h}${i}${s}`;
};

// write recoding result to file
const writeResult = (): void => {
	fixCurrentFileTime();

	const outputDirectory = config.get<string>('outputDirectory');
	let output = DEFAULT_OUTPUT_PATH;
	if (outputDirectory !== undefined && outputDirectory.trim().length > 0) {
		 output = outputDirectory.trim();
	}

	// create output directory and .gitignore
	if (!fs.existsSync(output)) {
		fs.mkdirSync(output);
	}

	const baseDir = `${output}/${formattedDate()}`;
	if (!fs.existsSync(baseDir)) {
		fs.mkdirSync(baseDir);
	}

	fs.writeFileSync(`${output}/.gitignore`, '*', 'utf-8');

	// write recording result
	fs.writeFileSync(`${baseDir}/all_files.json`, toJSON(files), 'utf-8');
	writeAggregateResult(baseDir);
};

// aggregate recording result and write to file
const writeAggregateResult = (outputBasePath: string): void => {
	const outFile = `${outputBasePath}/aggregate.json`;
	const aggregated: FileTime = {};

	// calc total seconds
	let total = 0;
	for (const f in files) {
		total += files[f];
	}
	aggregated['total'] = total;

	const dirs = config.get<Array<string>>('aggrigationDirectories');
	if (dirs === undefined || dirs.length === 0) {
		fs.writeFileSync(outFile, toJSON(aggregated), 'utf-8');
		return;
	}

	for (const dir of dirs) {
		let d = dir;
		// remove './' from prefix
		if (d.indexOf('./') === 0) {
			d = dir.slice(2);
		}
		// add '/' to sufix
		if (!d.endsWith('/')) {
			d += '/';
		}

		aggregated[dir] = 0;
		for (const f in files) {
			if (f.indexOf(d) !== 0) {
				continue;
			}
			aggregated[dir] += files[f];
		}
	}

	fs.writeFileSync(outFile, toJSON(aggregated), 'utf-8');
};

const toJSON = (obj: FileTime): string => {
	const formatted: {[key: string]: string} = {};
	for (const f in obj) {
		const total = obj[f];
		const hour = Math.floor(total / (60 * 60));
		const min = Math.floor((total - (hour * 60 * 60)) / 60);
		const sec = total - (hour * 60 * 60) - (min * 60);
		formatted[f] = `${hour}h ${padding(min)}m ${padding(sec)}s`;
	}

	return JSON.stringify(formatted, undefined, 2);
};
