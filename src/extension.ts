import * as vscode from 'vscode';
import * as fs from 'fs';

interface FileTime {[key: string]: number};

const INACTIVE = 'other files';
const WORKSPACE_ROOT_PATH = vscode.workspace.rootPath ? `${vscode.workspace.rootPath}/` : '/';
const DEFAULT_OUTPUT_PATH = `${WORKSPACE_ROOT_PATH}/.fileOpenTimeRecorder`;

const config = vscode.workspace.getConfiguration('fileOpenTimeRecorder');

let files: FileTime = {};

let currentFile = '';
let openedTime = 0;

export function activate(context: vscode.ExtensionContext) {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileOpenTimeRecorder.stopConfirm',
		() => {
			vscode.window.showQuickPick(['No', 'Yes'], {
				placeHolder: 'Are you sure you want to stop recording?',
				onDidSelectItem: (val: string) => {
					if (val === 'Yes') {
						vscode.commands.executeCommand('fileOpenTimeRecorder.stop');
					}
				},
			});
		}
	));

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileOpenTimeRecorder.start',
		() => {
			if (currentFile !== '') {
				vscode.window.showInformationMessage('recording has already started');
				return;
			}

			item.text = 'FileOpenTimeRecorder: Stop Recoding';
			item.command = 'fileOpenTimeRecorder.stopConfirm';
			item.show();

			const editor = vscode.window.activeTextEditor;
			const file = editor === undefined ?
				INACTIVE : editor.document.uri.path.replace(WORKSPACE_ROOT_PATH, '');
			files[file] = 0;

			currentFile = file;
			openedTime = unixtime();

			vscode.window.onDidChangeActiveTextEditor((e: vscode.TextEditor|undefined) => {
				fixCurrentFileTime();

				const f = e === undefined ?
					INACTIVE : e.document.uri.path.replace(WORKSPACE_ROOT_PATH, '');

				if (files[f] === undefined) {
					files[f] = 0;
				}

				currentFile = f;
				openedTime = unixtime();
			});
		}
	));

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileOpenTimeRecorder.stop',
		() => {
			if (currentFile === '') {
				vscode.window.showInformationMessage('recording has not started');
				return;
			}

			writeResult();

			// reset recording result
			currentFile = '';
			openedTime = 0;
			files = {};

			item.hide();
		}
	));
}

export function deactivate() {
	if (currentFile !== '') {
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
