import * as vscode from 'vscode';
import * as child_process from 'child_process';

export class ShellOutput {
    constructor(
        public stdout: string,
        public stderr: string,
        public command: string,
        public error?: Error
    ) {
    }
}

export function runCatkinCommand(args: string, cwd?: string): Thenable<ShellOutput> {
    try {
        return runShellCommand(`catkin ${args}`, cwd);
    } catch (error) {
        vscode.window.showErrorMessage(`Command ${error.command} failed: ${error.error.message}`);
        throw error;
    }
}

export function runShellCommand(command: string, cwd?: string, callback?: (process: child_process.ChildProcess) => any): Thenable<ShellOutput> {
    let ws = cwd === undefined ? vscode.workspace.rootPath : cwd;
    let options: child_process.ExecOptions = {
        cwd: ws,
        maxBuffer: 1024 * 1024
    };
    return new Promise<ShellOutput>((resolve, reject) => {
        let process = child_process.exec(command, options, (error, stdout, stderr) => {
            const result = new ShellOutput(stdout, stderr, command);
            if (error) {
                result.error = error;
                reject(result);
            } else {
                resolve(result);
            }
        });
        if (callback) {
            callback(process);
        }
    });
}