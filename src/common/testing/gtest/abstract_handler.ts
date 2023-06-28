import * as child_process from 'child_process';
import * as vscode from 'vscode';
import {
    WorkspaceTestInterface, WorkspaceTestReport,
    WorkspaceTestRunReport,
    WorkspaceTestRunReportKind,
    IWorkspace,
    IPackage,
    WorkspaceTestInstance,
    WorkspaceTestHandler,
    WorkspaceTestParameters
} from 'vscode-catkin-tools-api';
import * as fs from 'fs';
import { runShellCommand, runCommand, ShellOutput } from '../../shell_command';
import { WorkspaceTestCommandlineParameters } from '../test_parameters';
import { wrapArray } from '../../utils';
import * as gtest_problem_matcher from './problem_matcher';
import * as compiler_problem_matcher from '../../compiler_problem_matcher';
import * as treekill from 'tree-kill';
import { WorkspaceTestAdapter } from '../workspace_test_adapter';
import { logger } from '../../logging';
import { getExtensionConfiguration } from '../../configuration';
import { XMLParser } from 'fast-xml-parser';

type GtestAnalysisResult =
    "AllHandled" |
    "CannotReadOutput" |
    "UnmatchedTestCase";

export abstract class AbstractGoogleTestHandler<ChildType extends AbstractGoogleTestHandler<any> | undefined> implements WorkspaceTestHandler {
    private active_process: child_process.ChildProcess;
    protected children: ChildType[] = [];
    protected test_instance: WorkspaceTestInstance;

    constructor(
        protected test_interface: WorkspaceTestInterface,
        protected parameters: WorkspaceTestParameters,
        protected parent: WorkspaceTestHandler,
        protected pkg: IPackage,
        protected workspace: IWorkspace,
        protected adapter: WorkspaceTestAdapter
    ) {
        this.test_instance = this.adapter.createTestInstance(test_interface, parameters);
        this.test_instance.handler = this;
        this.adapter.registerTestHandler(parent, this, this.test_instance);
    }

    dispose(): void {
        this.parent.removeChild(this);
    }

    addChild(child: WorkspaceTestHandler) {
        this.children.push(child as ChildType);
        this.test_instance.item.children.add(child.item());
    }

    removeChild(child: WorkspaceTestHandler) {
        const index = this.children.indexOf(child as ChildType);
        if (index > -1) {
            const id = child.item().id;
            this.children.splice(index, 1);
            const children = [];
            this.test_instance.item.children.forEach(c => children.push(c));
            this.test_instance.item.children.delete(id);
            const after = [];
            this.test_instance.item.children.forEach(c => after.push(c));
        } else {
            logger.warn(`Cannot remove child with id ${child.test().id.evaluate(undefined)}`);
        }
    }

    async loadTests(build_dir: fs.PathLike, devel_dir: fs.PathLike, query_for_cases: boolean): Promise<void> {
        this.updateTestItem();
    }

    public updateTestItem() {
        let test_item = this.item();
        const test_interface = this.test_instance.test;
        if (test_interface.line !== undefined) {
            test_item.range = new vscode.Range(
                new vscode.Position(test_interface.line, 0),
                new vscode.Position(test_interface.line, 100));
        }
    }

    async reload(query_for_cases: boolean): Promise<void> {
        this.loadTests(await this.workspace.getBuildDir(), await this.workspace.getDevelDir(), true);
        await this.reloadChildren(query_for_cases);
    }

    async reloadChildren(query_for_cases: boolean): Promise<void> {
        for (let child of this.children) {
            await child.reload(query_for_cases);
        }
    }

    test(): WorkspaceTestInterface {
        return this.test_instance.test;
    }

    instance(): WorkspaceTestInstance {
        return this.test_instance;
    }

    item(): vscode.TestItem {
        return this.test_instance.item;
    }

    async enqueue(test_run: vscode.TestRun): Promise<void> {
        test_run.enqueued(this.test_instance.item);
    }
    async skip(test_run: vscode.TestRun): Promise<void> {
        test_run.skipped(this.test_instance.item);
    }
    async compile(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        cwd: fs.PathLike
    ): Promise<WorkspaceTestRunReport> {
        const commands = await this.makeCommands();
        return await this.runCompile(commands, test_run, token, diagnostics, cwd);
    }

    async run(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        environment: [string, string][],
        cwd: fs.PathLike
    ): Promise<WorkspaceTestReport> {
        if (token.isCancellationRequested) {
            return new WorkspaceTestReport(false);
        }

        test_run.started(this.test_instance.item);

        try {
            const commands = await this.makeCommands();
            this.setDefaultArguments(commands.args);
            const output_file = await this.prepareGTestOutputFile(this.test_instance.test, commands);
            const test_result = await this.runCommands(commands, test_run, token, diagnostics, environment, cwd);
            const all_handled = await this.analyzeGtestResult(test_run, diagnostics, output_file, test_result.message.message.toString());
            if (all_handled === "AllHandled") {
                return new WorkspaceTestReport(test_result.succeeded());
            }
            logger.info(`Not all results were handled (${all_handled}), retry after reloading tests.`);
            await this.reload(true);
            const all_results_handled = await this.analyzeGtestResult(test_run, diagnostics, output_file, test_result.message.message.toString());
            if (all_results_handled === "AllHandled") {
                logger.info(`Not all results were handled (${all_handled}) after reloading tests.`);
                return new WorkspaceTestReport(test_result.succeeded());
            }
            return new WorkspaceTestReport(test_result.succeeded());

        } catch (error) {
            logger.error("Failed to run google test:", error);
            let message = new vscode.TestMessage(`Internal Error, please report!\n${error.stack}`);
            test_run.errored(this.test_instance.item, message);
            return new WorkspaceTestReport(false);
        }

    }

    public async debug(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        environment: [string, string][],
        cwd: fs.PathLike
    ): Promise<void> {
        // start the debugging session
        let parts: string[] = this.test_instance.test.executable.toString().split(/\s/gi);
        let cmd: string = parts[0];
        parts.shift();
        let args: string[] = parts;

        this.setDefaultArguments(args);

        let filter = this.getTestFilter();
        let config: vscode.DebugConfiguration = {
            type: 'cppdbg',
            name: cmd,
            request: 'launch',
            environment: environment,
            MIMode: 'gdb',
            stopAtEntry: true,
            setupCommands: [
                {
                    "description": "Enable pretty-printing for gdb",
                    "text": "-enable-pretty-printing",
                    "ignoreFailures": true
                }
            ],
            cwd: cwd,
            program: cmd,
            args: args.concat(['--gtest_break_on_failure', `--gtest_filter="${this.escapeFilter(filter)}"`])
        };
        token.onCancellationRequested(async () => {
            await vscode.debug.stopDebugging();
        });
        let disposable = vscode.debug.onDidTerminateDebugSession((e) => {
            logger.silly("Finished debugging");
            test_run.end();
            disposable.dispose();
        });
        await vscode.debug.startDebugging(undefined, config);
    }

    abstract makeCommands(): Promise<WorkspaceTestCommandlineParameters>;
    protected setDefaultArguments(args: string[]) {
        for (let part of args) {
            if (part.startsWith("--force-color")) {
                return;
            }
        }
        args.push('--gtest_color=yes');
    }


    abstract enumerateTests(run_tests_individually: boolean, tests: WorkspaceTestInstance[]);

    enumeratePackages(packages: IPackage[]) {
        if (packages.indexOf(this.pkg) < 0) {
            packages.push(this.pkg);
        }
    }

    private async runCommands(
        commands: WorkspaceTestCommandlineParameters,
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        environment: [string, string][],
        cwd: fs.PathLike): Promise<WorkspaceTestRunReport> {

        let compile_result = await this.runCompile(commands, test_run, token, diagnostics, cwd);
        if (!compile_result.succeeded()) {
            return compile_result;
        }

        let result = new WorkspaceTestRunReport(WorkspaceTestRunReportKind.BuildFailed);
        if (commands.exe !== undefined) {
            try {
                await this.runExecutableCommand([commands.exe, commands.args], test_run, token, environment, cwd);
                result.state = WorkspaceTestRunReportKind.TestSucceeded;

            } catch (error_output) {
                result.state = WorkspaceTestRunReportKind.TestFailed;
                result.message.message += error_output.stdout + '\n' + error_output.stderr + '\n';
                if (error_output.error !== undefined) {
                    result.message.message = `Error: ${error_output.error.message}\n\n` + result.message.message;
                }
                result.error = error_output.error;

                return result;
            }
        } else {
            result.state = WorkspaceTestRunReportKind.TestSucceeded;
        }

        return result;
    }
    private async runCompile(
        commands: WorkspaceTestCommandlineParameters,
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        cwd: fs.PathLike
    ): Promise<WorkspaceTestRunReport> {
        try {
            const show_build_output_in_tests = getExtensionConfiguration('testCompileOutputEnabled', false);
            test_run.appendOutput("Building tests:\r\n");
            if (show_build_output_in_tests) {
                test_run.appendOutput("Shell setup:\r\n");
                test_run.appendOutput(commands.setup_shell_code);
            } else {
                test_run.appendOutput(" (enable show_build_output_in_tests to see the output):\r\n");
            }
            let outCallback = undefined;
            let errCallback = undefined;
            if (show_build_output_in_tests) {
                outCallback = (out) => {
                    out.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`));
                };
                errCallback = (err) => {
                    err.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`));
                };
            }
            await this.runShellCommand(
                commands.setup_shell_code,
                test_run,
                token,
                cwd,
                outCallback,
                errCallback
            );

            return new WorkspaceTestRunReport(WorkspaceTestRunReportKind.TestSucceeded);

        } catch (error_output) {
            let error = [new vscode.TestMessage("Compilation failed")];
            error_output.stdout.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`));
            error_output.stderr.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`));

            let result = new WorkspaceTestRunReport(WorkspaceTestRunReportKind.BuildFailed);
            let new_diagnostics: Map<string, vscode.Diagnostic[]> = compiler_problem_matcher.analyze(this.workspace, error_output.stderr, diagnostics);
            for (const [_, message] of new_diagnostics.entries()) {
                for (const entry of message) {
                    error.push(new vscode.TestMessage(entry.message));
                }
            }
            test_run.errored(this.item(), error);

            result.state = WorkspaceTestRunReportKind.BuildFailed;
            result.message.message += error_output.stdout + '\n' + error_output.stderr + '\n';
            return result;
        }
    }

    private async runExecutableCommand([exe, args]: [fs.PathLike, string[]],
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        environment: [string, string][],
        cwd: fs.PathLike) {

        let output_promise = runCommand(exe.toString(), args, environment, cwd, [], (process) => {
            this.active_process = process;

            if (token !== undefined) {
                token.onCancellationRequested(() => {
                    treekill(this.active_process.pid);
                });
            }
        }, (out) => {
            for (const line of out.split("\n")) {
                test_run.appendOutput(`${line}\r\n`);
            }
        }, (err) => {
            for (const line of err.split("\n")) {
                test_run.appendOutput(`${line}\r\n`);
            }
        });
        const output = await output_promise;
        this.active_process = undefined;
        return output;
    }

    private async runShellCommand(command: string,
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        cwd: fs.PathLike,
        out?: (lines: string) => void,
        error?: (lines: string) => void
    ): Promise<ShellOutput | Error> {

        const environment: [string, string][] = await this.workspace.getRuntimeEnvironment();
        let output_promise = runShellCommand(command,
            environment,
            cwd,
            (process) => {
                this.active_process = process;

                if (token !== undefined) {
                    token.onCancellationRequested(() => {
                        treekill(this.active_process.pid);
                    });
                }
            },
            out, error);
        const output = await output_promise;
        this.active_process = undefined;
        return output;
    }


    private async prepareGTestOutputFile(test: WorkspaceTestInterface, commands: WorkspaceTestCommandlineParameters) {
        let output_file = await this.overwriteGTestOutputFile(test, commands);

        if (fs.existsSync(output_file)) {
            fs.unlinkSync(output_file);
        }

        return output_file;
    }

    private async overwriteGTestOutputFile(test: WorkspaceTestInterface, commands: WorkspaceTestCommandlineParameters) {
        const gtest_xml = /.*--gtest_output=.*/;
        commands.args = commands.args.filter((value, index) => {
            return value.match(gtest_xml) === null;
        });

        const output_file = `/tmp/gtest_output_${test.id.evaluate({})}.xml`;
        commands.args.push(`--gtest_output=xml:${output_file}`);
        return output_file;
    }

    private async analyzeGtestResult(test_run: vscode.TestRun,
        diagnostics: vscode.DiagnosticCollection,
        output_file: string,
        test_output: string
    ): Promise<GtestAnalysisResult> {
        let dom = undefined;
        try {
            let options = {
                ignoreAttributes: false
            };
            const parser = new XMLParser(options);
            const content_raw = await fs.promises.readFile(output_file);
            dom = parser.parse(content_raw.toString());

            // send the result for all matching ids
            return this.readTestResults(test_run, diagnostics, dom);

        } catch (error) {
            test_run.appendOutput(`(Cannot read the test results results from ${output_file})`);
            test_run.errored(this.test_instance.item, new vscode.TestMessage(test_output));
            return "CannotReadOutput";
        }
    }


    private readTestResults(
        test_run: vscode.TestRun,
        diagnostics: vscode.DiagnosticCollection,
        dom
    ): GtestAnalysisResult {
        let all_cases_handled = true;

        gtest_problem_matcher.analyze(dom, diagnostics);

        // this is the whole test executable
        logger.silly("dom:", dom);
        const node_suites = wrapArray(dom['testsuites']);
        for (const node_suite of node_suites) {
            const test_cases = wrapArray(node_suite['testsuite']);
            if (test_cases === undefined) {
                continue;
            }
            logger.silly("test_cases:", test_cases);
            for (const node_case of test_cases) {
                const fixture_name = node_case['@_name'];
                const failures = parseInt(node_case['@_failures']);
                const errors = parseInt(node_case['@_errors']);
                if (!this.handleTestFixtureResult(fixture_name, test_run, failures, errors)) {
                    all_cases_handled = false;
                }

                const testcases = wrapArray(node_case['testcase']);
                for (const test_case of testcases) {
                    logger.silly("test_case:", test_case);
                    const class_name = test_case['@_classname'];
                    const name = test_case['@_name'];
                    let failures: string[] = undefined;
                    if (test_case['failure'] !== undefined) {
                        let f = wrapArray(test_case['failure']);
                        failures = f.map(failure => failure['#text']);
                    }
                    if (!this.handleTestCaseResult(class_name, name, test_run, failures, test_case['error']?.['#text'])) {
                        all_cases_handled = false;
                    }
                }
            }
        }

        if (!all_cases_handled) {
            return "UnmatchedTestCase";
        } else {
            return "AllHandled";
        }
    }

    handleTestFixtureResult(classname: string, test_run: vscode.TestRun, failures: number, errors: number): boolean {
        for (const child of this.children) {
            if (child.handleTestFixtureResult(classname, test_run, failures, errors)) {
                return true;
            }
        }
        return false;
    }

    handleTestCaseResult(classname: string, name: string, test_run: vscode.TestRun, failure?: string[], error?: string): boolean {
        for (const child of this.children) {
            if (child.handleTestCaseResult(classname, name, test_run, failure, error)) {
                return true;
            }
        }
        return false;
    }

    public getFixtureFilter(): string {
        return undefined;
    }
    public abstract getTestFilter(): string;

    protected htmlEncode(s: string) {
        return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;');
    }
    protected escapeFilter(filter: String) {
        if (filter.indexOf("::") > 0) {
            // gtest replaces '::' with something else internally because '::' is used as the separator
            return filter.replace(/::/gi, "*");
        } else {
            return filter;
        }
    }


    public async makeBuildTestCommand() {
        let test = this.test_instance.test;
        if (test.build_target === undefined) {
            // build package instead if test build target is not known?
            throw Error(`Build target of test ${test.id.evaluate({})} is undefined`);
        }

        let command = "";
        if (!fs.existsSync(test.build_space)) {
            // TODO: specialize here for build tools
            command += `${test.package.workspace.workspace_provider.makePackageBuildCommand(test.package.name)};`;
        }
        command += `cd "${test.build_space}";`;
        command += `env GCC_COLORS= make -j $(nproc); `;
        command += `{ make -q install ; [ "$?" = "1" ] && make install; }; `;

        if (test.type !== 'suite') {
            // generic target to build all tests
            command += `{ make -q tests ; [ "$?" = "1" ] && env GCC_COLORS= make -j $(nproc) tests; }; `;
            // try to build the requrested test:
            command += `{ make -q ${test.build_target.cmake_target} ; [ "$?" = "1" ] && env GCC_COLORS= make -j $(nproc) ${test.build_target.cmake_target}; } `;
        } else {
            command += `env GCC_COLORS= make -j $(nproc) ${test.build_target.cmake_target}`;
        }
        return this.workspace.makeCommand(command);
    }
}
