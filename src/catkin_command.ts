import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';

export class ShellOutput {
    constructor(
        public stdout: string,
        public stderr: string,
        public command: string,
        public error?: Error
    ) {
    }
}

export async function runCatkinCommand(args: string[], cwd: fs.PathLike): Promise<ShellOutput> {
    try {
        return await runCommand("catkin", args, [], cwd);
    } catch (error) {
        console.error(error);
        throw error;
    }
}

export function runShellCommand(command: string, cwd: fs.PathLike, callback?: (process: child_process.ChildProcess) => any): Thenable<ShellOutput> {
    let options: child_process.ExecOptions = {
        cwd: cwd.toString(),
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

export function runCommand(
    command: string,
    args: string[],
    environment: [string, string][],
    cwd: fs.PathLike,
    callback?: (process: child_process.ChildProcess) => any)
    : Thenable<ShellOutput> {
    let environment_kv = {};
    for (let v of environment) {
        environment_kv[v['name']] = v['value'];
    }
    let options: child_process.ExecOptions = {
        cwd: cwd.toString(),
        maxBuffer: 1024 * 1024,
        env: environment.length === 0 ? process.env : environment_kv
    };
    return new Promise<ShellOutput>((resolve, reject) => {
        let full_command = `${command} ${args.join(" ")}`;
        console.log(`Running async command ${full_command}`);
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