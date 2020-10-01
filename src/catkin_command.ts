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

export function runCatkinCommand(args: string[], cwd?: string): Thenable<ShellOutput> {
    try {
        return runCommand("catkin", args, cwd);
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
    const config = vscode.workspace.getConfiguration('catkin_tools');
    const shell = config['shell'];

    const shell_args = (shell === 'bash' || shell === 'sh') ? "--norc" : "";

    return new Promise<ShellOutput>((resolve, reject) => {
        let shell_command = `${shell} ${shell_args} -c '${command}'`;
        console.log(`Running ${shell} command ${shell_command}`);
        let process = child_process.exec(shell_command, options, (error, stdout, stderr) => {
            const result = new ShellOutput(stdout, stderr, shell_command);
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

export function runCommand(command: string, args: string[], cwd?: string, callback?: (process: child_process.ChildProcess) => any): Thenable<ShellOutput> {
    let ws = cwd === undefined ? vscode.workspace.rootPath : cwd;
    let options: child_process.ExecOptions = {
        cwd: ws,
        maxBuffer: 1024 * 1024
    };
    return new Promise<ShellOutput>((resolve, reject) => {
        let full_command = `${command} ${args.join(" ")}`;
        console.log(`Running command ${full_command}`);
        let process = child_process.execFile(command, args, options, (error, stdout, stderr) => {
            const result = new ShellOutput(stdout, stderr, full_command);
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
