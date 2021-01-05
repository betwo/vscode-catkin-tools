import * as fs from 'fs';

export enum CatkinTestRunResultKind {
    BuildFailed,
    TestFailed,
    TestSucceeded
}
export class CatkinTestRunResult {
    public constructor(
        public state: CatkinTestRunResultKind,
        public message: string) { }

    public toTestExplorerSuiteState() {
        switch (this.state) {
            case CatkinTestRunResultKind.TestSucceeded:
                return 'completed';
            default:
                return 'errored';
        }
    }
    public toTestExplorerTestState() {
        switch (this.state) {
            case CatkinTestRunResultKind.BuildFailed:
                return 'errored';
            case CatkinTestRunResultKind.TestFailed:
                return 'failed';
            case CatkinTestRunResultKind.TestSucceeded:
                return 'passed';
        }
    }
}

export class CatkinTestParameters {
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
                    console.log(exe_string_prefix);
                    if (fs.existsSync(exe_string_prefix)) {
                        this.exe = exe_string_prefix;
                        this.args = this.args.concat(exe_string_parts.slice(i + 1), this.args);
                        return;
                    }
                }
                throw Error(`The executable ${exe_string} could not be resolved to a binary`);
            }
        }
    }
}
