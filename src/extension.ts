import * as vscode from 'vscode';
import * as fs from 'fs';

const INACTIVE = 'other files';
const rootPath = vscode.workspace.rootPath ? `${vscode.workspace.rootPath}/` : '/';
const outputPath = `${rootPath}/.fileopenrecorder`;

let files: {[key: string]: number} = {};

let currentFile = '';
let openedTime = 0;

export function activate(context: vscode.ExtensionContext) {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileopenrecorder.stopConfirm',
		() => {
			vscode.window.showQuickPick(['No', 'Yes'], {
				placeHolder: 'Are you sure you want to stop recording?',
				onDidSelectItem: (val: string) => {
					if (val === 'Yes') {
						vscode.commands.executeCommand('fileopenrecorder.stop');
					}
				},
			});
		}
	));

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileopenrecorder.start',
		() => {
			if (currentFile !== '') {
				vscode.window.showInformationMessage('recording has already started');
				return;
			}

			item.text = 'FileOpenRecorder: Stop Recoding';
			item.command = 'fileopenrecorder.stopConfirm';
			item.show();

			const editor = vscode.window.activeTextEditor;
			const file = editor === undefined ?
				INACTIVE : editor.document.uri.path.replace(rootPath, '');
			files[file] = 0;

			currentFile = file;
			openedTime = unixtime();

			vscode.window.onDidChangeActiveTextEditor((e: vscode.TextEditor|undefined) => {
				fixCurrentFileTime();

				const f = e === undefined ?
					INACTIVE : e.document.uri.path.replace(rootPath, '');

				if (files[f] === undefined) {
					files[f] = 0;
				}

				currentFile = f;
				openedTime = unixtime();
			});
		}
	));

	context.subscriptions.push(vscode.commands.registerCommand(
		'fileopenrecorder.stop',
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

	// create output directory and .gitignore
	if (!fs.existsSync(outputPath)) {
		fs.mkdirSync(outputPath);
	}

	const baseDir = `${outputPath}/${formattedDate()}`;
	if (!fs.existsSync(baseDir)) {
		fs.mkdirSync(baseDir);
	}

	fs.writeFileSync(`${outputPath}/.gitignore`, '*', 'utf-8');

	// write recording result
	fs.writeFileSync(`${baseDir}/all_files.json`, JSON.stringify(files), 'utf-8');
	writeAggregateResult(baseDir);
};

// aggregate recording result and write to file
// skip aggregation if configuration is empty
const writeAggregateResult = (outputBasePath: string): void => {
	const config = vscode.workspace.getConfiguration('fileopenrecorder');
	const dirs = config.get<Array<string>>('aggrigationDirectories');
	if (dirs === undefined || dirs.length === 0) {
		return;
	}

	const aggregated: {[key: string]: number} = {};
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

	fs.writeFileSync(`${outputBasePath}/aggregate.json`, JSON.stringify(aggregated), 'utf-8');
};
