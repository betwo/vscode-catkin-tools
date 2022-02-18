import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as tree_kill from 'tree-kill';

import { runCatkinCommand } from './catkin_command';
import { assert } from 'console';
import { IWorkspace } from 'vscode-catkin-tools-api';
import * as compiler_problem_matcher from '../common/compiler_problem_matcher';

export class CatkinToolsTerminal implements vscode.Pseudoterminal {
    private write_emitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.write_emitter.event;
    private close_emitter = new vscode.EventEmitter<number>();
    onDidClose?: vscode.Event<number> = this.close_emitter.event;

    private process: child_process.ChildProcess;
    public diagnostics: vscode.DiagnosticCollection;

    constructor(private workspace: IWorkspace,
        private flags: string[],
        private use_current_file_as_work_directory: boolean = false,
        private additional_env_vars?: [string, string][] | undefined) {
        this.diagnostics = vscode.languages.createDiagnosticCollection(`catkin_tools`);
    }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.triggerBuild();
    }

    close(): void {
        this.terminate();
    }

    handleInput(data: string): void {
        if (data.length === 1) {
            const ascii_code = data.charCodeAt(0);
            if (ascii_code === 3) {
                // CTRL+c
                if (this.process !== undefined && !this.process.killed) {
                    this.write_emitter.fire(`Canceling...\r\n`);
                    this.terminate();
                }
            }
        }
    }

    private terminate() {
        if (this.process !== undefined && !this.process.killed) {
            this.write_emitter.fire(`Sending kill signal...\r\n`);
            const pid = this.process.pid;
            tree_kill(pid, 'SIGINT');
        }
    }

    private async triggerBuild(): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            assert(this.workspace.isInitialized());
            let exit_code = undefined;
            let working_directory: fs.PathLike;
            if (this.use_current_file_as_work_directory) {
                if (vscode.window.activeTextEditor === undefined) {
                    vscode.window.showErrorMessage("Command requires an active text editor");
                    this.close_emitter.fire(-1);
                    return;
                }

                working_directory = path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
            } else {
                working_directory = await this.workspace.getRootPath();
            }

            try {
                const shell_output = await runCatkinCommand(this.flags, working_directory, this.additional_env_vars,
                    (process) => {
                        this.process = process;
                    },
                    (out: string) => {
                        this.write_emitter.fire(out.replace(/\n/g, "\r\n"));
                        console.debug(out);
                    },
                    (err: string) => {
                        this.write_emitter.fire(colorText(err.replace(/\n/g, "\r\n"), 1));
                        compiler_problem_matcher.analyze(this.workspace, err, this.diagnostics);
                        console.error(err);
                    });
                this.process = undefined;
                this.write_emitter.fire('complete.\r\n\r\n');
                if (shell_output.error !== undefined) {
                    console.error(`Subcommand failed with error:`);
                    console.error(shell_output.error);
                    exit_code = -1;
                } else {
                    exit_code = 0;
                }

            } catch (error) {
                console.error(`Subcommand threw with error: ${typeof (error)}`);
                console.error(error.message);
                if (error.exit_code !== undefined) {
                    exit_code = error.exit_code;
                } else {
                    exit_code = -2;
                }
                this.write_emitter.fire('failed.\r\n\r\n');
                this.write_emitter.fire(colorText(error.stderr.replace(/\n/g, "\r\n"), 1));
            }

            this.close_emitter.fire(exit_code);
            resolve();
        });
    }
}

function colorText(text: string, color_code: number): string {
    let output = '';
    for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        if (char === ' ' || char === '\r' || char === '\n') {
            output += char;
        } else {
            output += `\x1b[3${color_code}m${text.charAt(i)}\x1b[0m`;
        }
    }
    return output;
}