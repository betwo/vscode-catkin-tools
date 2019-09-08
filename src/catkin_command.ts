import * as vscode from 'vscode';
import * as child_process from 'child_process';

export class ShellOutput {
    constructor(
        public stdout: string,
        public stderr: string,
    ) {

    }
}

export function runCatkinCommand(args: string): Thenable<ShellOutput> {
    return runShellCommand(`catkin ${args}`);
}

export function runShellCommand(command: string): Thenable<ShellOutput> {
    let ws = vscode.workspace.rootPath;
    let options: child_process.ExecOptions = {
        cwd: ws,
        maxBuffer: 1024 * 1024
    };
    return new Promise<ShellOutput>((resolve, reject) => {
        child_process.exec(command, options, (error, stdout, stderr) => {
            const result = new ShellOutput(stdout, stderr);
            if (error) {
                vscode.window.showErrorMessage(`Command ${command} failed: ${error.message}`);
                reject(result);
            } else {
                resolve(result);
            }
        });
    });
}