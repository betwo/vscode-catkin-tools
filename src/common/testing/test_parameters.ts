import * as vscode from 'vscode';
import * as fs from 'fs';

export enum WorkspaceTestRunResultKind {
    BuildFailed,
    TestFailed,
    TestSucceeded
}
export class WorkspaceTestRunResult {
    public constructor(
        public state: WorkspaceTestRunResultKind,
        public message?: vscode.TestMessage,
        public error?: Error) {
        if (message === undefined) {
            this.message = new vscode.TestMessage("");
        }
    }

    public updateTestRunSuite(item: vscode.TestItem, test_run: vscode.TestRun) {
        switch (this.state) {
            case WorkspaceTestRunResultKind.TestSucceeded:
                return test_run.passed(item);
            default:
                return test_run.errored(item, this.message);
        }
    }
    public updateTestRunTest(item: vscode.TestItem, test_run: vscode.TestRun) {
        switch (this.state) {
            case WorkspaceTestRunResultKind.BuildFailed:
                return test_run.errored(item, this.message);
            case WorkspaceTestRunResultKind.TestFailed:
                return test_run.failed(item, this.message);
            case WorkspaceTestRunResultKind.TestSucceeded:
                return test_run.passed(item);
        }
    }
    public toTestExplorerSuiteState() {
        switch (this.state) {
            case WorkspaceTestRunResultKind.TestSucceeded:
                return 'completed';
            default:
                return 'errored';
        }
    }
    public toTestExplorerTestState() {
        switch (this.state) {
            case WorkspaceTestRunResultKind.BuildFailed:
                return 'errored';
            case WorkspaceTestRunResultKind.TestFailed:
                return 'failed';
            case WorkspaceTestRunResultKind.TestSucceeded:
                return 'passed';
        }
    }
}

export class WorkspaceTestParameters {
    public constructor(
        public setup_shell_code: string,
        public exe: fs.PathLike,
        public args?: string[]) {
        if (args === undefined) {
            this.args = [];
        }
        if (exe !== undefined) {
            let exe_string = exe.toString();
            if (exe_string.indexOf(" ") > 0) {
                // Find the executable path (might contain spaces?)
                let exe_string_parts = exe_string.split(" ");
                for (let i = 0; i < exe_string_parts.length; ++i) {
                    let exe_string_prefix = exe_string_parts.slice(0, i + 1).join(" ");
                    if (fs.existsSync(exe_string_prefix)) {
                        this.exe = exe_string_prefix;
                        this.args = this.args.concat(exe_string_parts.slice(i + 1), this.args);
                        return;
                    }
                }

                // Nothing found, assume no spaces in the path
                this.exe = exe_string_parts[0];
                this.args = this.args.concat(exe_string_parts.slice(1), this.args);
            }
        }
    }
}
