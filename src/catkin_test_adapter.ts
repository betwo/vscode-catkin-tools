import * as child_process from 'child_process';
import * as vscode from 'vscode';
import {
    TestEvent,
    TestHub,
    TestLoadStartedEvent,
    TestLoadFinishedEvent,
    TestRunStartedEvent,
    TestRunFinishedEvent,
    TestSuiteEvent,
    TestAdapter,
    TestSuiteInfo,
    TestInfo
} from 'vscode-test-adapter-api';
import { TestAdapterRegistrar } from 'vscode-test-adapter-util';
import * as fs from 'fs';
import * as path from 'path';
import { CatkinPackage } from './catkin_package';
import { CatkinWorkspace } from './catkin_workspace';
import { runBashCommand } from './catkin_command';
import { CatkinTestInterface, CatkinTestCase, CatkinTestExecutable, CatkinTestSuite } from './catkin_test_types';
import * as gtest_problem_matcher from './gtest_problem_matcher';
import * as xml from 'fast-xml-parser';

export const registerAdapter = (
    testExplorerExtension: vscode.Extension<TestHub>,
    context: vscode.ExtensionContext,
    adapterFactory: (workspaceFolder: vscode.WorkspaceFolder) => CatkinTestAdapter) => {
    const testHub = testExplorerExtension.exports;
    context.subscriptions.push(new TestAdapterRegistrar(testHub, adapterFactory));
    // vscode.commands.executeCommand('test-explorer.reload');
};

type TestRunEvent = TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent;
type TestLoadEvent = TestLoadStartedEvent | TestLoadFinishedEvent;

export function registerCatkinTest(context: vscode.ExtensionContext,
    catkin_workspace: CatkinWorkspace,
    testExplorerExtension,
    outputChannel) {

    const testsEmitter = new vscode.EventEmitter<TestLoadEvent>();
    const testStatesEmitter = new vscode.EventEmitter<TestRunEvent>();
    const autorunEmitter = new vscode.EventEmitter<void>();
    const adapterFactory = workspaceFolder => new CatkinTestAdapter(
        workspaceFolder.uri.fsPath,
        catkin_workspace,
        outputChannel,
        testsEmitter,
        testStatesEmitter,
        autorunEmitter
    );
    registerAdapter(testExplorerExtension, context, adapterFactory);
}

class TestRunRepeatRequest {
    test: CatkinTestSuite;
    dom;
    output: string;
}
class TestRunResult {
    public repeat_ids: string[];
    public reload_packages: TestRunRepeatRequest[];

    constructor() {
        this.repeat_ids = [];
        this.reload_packages = [];
    }
}

/**
 * Implementation of the TestAdapter interface for catkin_tools tests.
 */
export class CatkinTestAdapter implements TestAdapter {
    suites: Map<string, CatkinTestSuite> = new Map<string, CatkinTestSuite>();
    executables: Map<string, CatkinTestExecutable> = new Map<string, CatkinTestExecutable>();
    testcases: Map<string, CatkinTestCase> = new Map<string, CatkinTestCase>();

    private cancel_requested: boolean = false;
    private active_process: child_process.ChildProcess;

    private catkin_tools_tests: TestSuiteInfo;

    private diagnostics: vscode.DiagnosticCollection;

    constructor(
        public readonly workspaceRootDirectoryPath: string,
        public readonly catkin_workspace: CatkinWorkspace,
        private readonly output_channel: vscode.OutputChannel,
        private readonly testsEmitter: vscode.EventEmitter<TestLoadEvent>,
        private readonly testStatesEmitter: vscode.EventEmitter<TestRunEvent>,
        private readonly autorunEmitter: vscode.EventEmitter<void>
    ) {
        this.catkin_workspace.test_adapter = this;
        this.output_channel.appendLine('Initializing catkin_tools test adapter');
        this.diagnostics = vscode.languages.createDiagnosticCollection(`catkin_tools`);
    }

    public get tests() { return this.testsEmitter.event; }
    public get testStates() { return this.testStatesEmitter.event; }
    public get autorun() { return this.autorunEmitter.event; }

    public async load(): Promise<void> {
        this.output_channel.appendLine('Loading catkin tools tests');
        this.signalReload();

        let build_dir_request = this.catkin_workspace.getBuildDir();
        let devel_dir_request = this.catkin_workspace.getDevelDir();

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Loading catkin test suites",
            cancellable: false
        }, async (progress, token) => {
            progress.report({ increment: 0, message: "Searching tests" });
            try {
                let packages_with_tests = 0;
                for (let catkin_package of this.catkin_workspace.packages) {
                    if (catkin_package.has_tests) {
                        packages_with_tests++;
                    }
                }
                let progress_relative = (100.0 / packages_with_tests);
                let accumulated_progress = 0.0;

                let build_dir = await build_dir_request;
                let devel_dir = await devel_dir_request;

                for (let catkin_package of this.catkin_workspace.packages) {
                    if (!catkin_package.has_tests) {
                        continue;
                    }
                    accumulated_progress += progress_relative;
                    console.log(catkin_package.name);
                    if (accumulated_progress > 1.0) {
                        let integer_progress = Math.floor(accumulated_progress);
                        accumulated_progress -= integer_progress;
                        progress.report({
                            increment: integer_progress,
                            message: `Parsing ${catkin_package.name} for tests`
                        });
                    }

                    await this.loadPackageTests(catkin_package, true, build_dir, devel_dir);
                }
                this.updateSuiteSet();

                progress.report({ increment: 100, message: `Found ${this.suites.size} test suites` });
                
            } catch (err) {
                this.output_channel.appendLine(`Error loading catkin tools tests: ${err}`);
                this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', errorMessage: err });
            }
        });
    }

    public signalReload() {
        this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
    }
    public updateSuiteSet() {
        let test_packages: CatkinTestSuite[] = [];
        this.suites.forEach((value, key) => {
            test_packages.push(value);
        });
        this.catkin_tools_tests = {
            id: "all_tests", label: "catkin_tools", type: 'suite', children: test_packages.map(suite => suite.info)
        };
        this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: this.catkin_tools_tests });
    }

    public async loadPackageTests(catkin_package: CatkinPackage,
        outline_only: boolean = false,
        build_dir?: String, devel_dir?: String):
        Promise<[CatkinTestSuite, CatkinTestSuite]> {

        if (!catkin_package.has_tests) {
            return;
        }

        if (build_dir === undefined) {
            build_dir = await this.catkin_workspace.getBuildDir();
        }
        if (devel_dir === undefined) {
            devel_dir = await this.catkin_workspace.getDevelDir();
        }

        try {
            console.log("loading tests for package");
            let suite = await catkin_package.loadTests(build_dir, devel_dir, outline_only);
            console.log(suite.info);

            if (suite.executables !== null) {
            for (let executable of suite.executables) {
                console.log(`add executable ${executable.info.id}`);
                console.log(executable);
                this.executables.set(executable.info.id, executable);
                for (let test_case of executable.tests) {
                    console.log(`add test case ${test_case.info.id}`);
                    this.testcases.set(test_case.info.id, test_case);
                }
            }
            }
            console.log(`setting suite ${suite.info.id}`);
            let old_suite = this.suites.get(suite.info.id);
            this.suites.set(suite.info.id, suite);

            return [suite, old_suite];
        } catch (error) {
            console.log(`Error loading tests of package ${catkin_package.name}: ${error}`);
        }
    }

    public async run(nodeIds: string[]): Promise<void> {
        this.diagnostics.clear();
        this.cancel_requested = false;

        this.output_channel.appendLine(`Running test(s): ${nodeIds.join(', ')}`);
        this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests: nodeIds });
        let result: TestRunResult = await vscode.window.withProgress<TestRunResult>({
            location: vscode.ProgressLocation.Notification,
            title: 'Test ' + (nodeIds.length > 1 ? "multiple tests" : nodeIds[0]),
            cancellable: true,
        }, async (progress, token) => {
            token.onCancellationRequested(() => {
                this.cancel_requested = true;
            });
            let result = new TestRunResult();
            try {
                for (let id of nodeIds) {
                    let intermediate_result: TestRunResult;
                    if (id.startsWith("package_") || id.startsWith("exec_") || id === "all_tests") {
                        intermediate_result = await this.runTestSuite(id, progress, token);

                    } else if (id.startsWith("test_")) {
                        intermediate_result = await this.runTest(id, progress, token);
                    }
                    result.repeat_ids = result.repeat_ids.concat(intermediate_result.repeat_ids);
                    result.reload_packages = result.reload_packages.concat(intermediate_result.reload_packages);
                }
            } catch (err) {
                this.output_channel.appendLine(`Run failed: ${err}`);
                console.log(`Run failed: ${err}`);
            }
            return result;
        });

        this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });

        if (result.reload_packages.length > 0) {
            for (let request of result.reload_packages) {
                console.log(`Requested to reload ${request.test.info.id}`);
                let change_suite = await this.reloadPackageIfChanged(request.test);
                if (change_suite !== undefined) {
                    console.log(`Changed suite: ${change_suite.info.id}`);
                    result.repeat_ids.push(change_suite.info.id);
                }
            }
        }

        if (result.repeat_ids.length > 0) {
            this.run(result.repeat_ids);
        }
    }

    public async runTest(id: string,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken): Promise<TestRunResult> {
        this.output_channel.appendLine(`Running catkin_tools test for package ${id}`);

        try {
            return await this.runTestCommand(id, progress, token);
        } catch (err) {
            this.testStatesEmitter.fire({
                state: 'errored',
                type: 'test',
                test: id,
                message: `Failure running test ${id}: ${err}`
            });
            return new TestRunResult();
        }
    }

    public async skipTest(id: string) {
        this.testStatesEmitter.fire({
            state: 'errored',
            type: 'test',
            test: id,
            message: `Skipped test ${id}`
        });
    }

    private async runTestSuite(id: string,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken): Promise<TestRunResult> {
        this.output_channel.appendLine(`Running catkin_tools test suite ${id}`);

        let tests: (CatkinTestExecutable | CatkinTestSuite)[] = [];
        let ids = [];
        if (id.startsWith("package_")) {
            let suite: CatkinTestSuite = this.suites.get(id);
            tests.push(suite);

        } else if (id.startsWith("exec_")) {
            let exe = this.executables.get(id);
            ids.push(id);
            tests.push(exe);

        } else if (id === "all_tests") {
            this.suites.forEach((suite, key) => {
                tests.push(suite);
            });
        }

        if (tests.length === 0) {
            this.output_channel.appendLine(`No test found with id ${id}`);
            this.testStatesEmitter.fire(
                {
                    state: 'errored',
                    type: 'test',
                    test: id,
                    message: `No test found with id ${id}`
                });
            return;
        }

        let result = new TestRunResult();
        for (let test of tests) {
            if (this.cancel_requested) {
                this.skipTest(test.info.id);
            } else {
                let intermediate_result = await this.runTest(test.info.id, progress, token);
                result.repeat_ids = result.repeat_ids.concat(intermediate_result.repeat_ids);
                result.reload_packages = result.reload_packages.concat(intermediate_result.reload_packages);
            }
        }
        return result;
    }

    private async makeBuildTestCommand(test: CatkinTestInterface) {
        let command = "";
        if (!fs.existsSync(test.build_space)) {
            command += `catkin build ${test.package.name} --no-notify --no-status;`;
        }
        command += `cd "${test.build_space}";`;
        if (test.type === 'suite') {
            command += `make -j $(nproc) tests;`;
        } else {
            command += `make -j $(nproc) ${test.build_target}`;
        }
        return this.catkin_workspace.makeCommand(command);
    }

    private async runCommand(command: string,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken,
        cwd?: string) {

        let output_promise = runBashCommand(command, cwd, (process) => {
            this.active_process = process;

            if (token !== undefined) {
                token.onCancellationRequested(() => {
                    this.active_process.kill();
                });
            }

            if (progress !== undefined) {
                let buffer = '';
                let last_update = 0;
                this.active_process.stdout.on('data', (data) => {
                    buffer += data.toString().replace(/\r/gi, '');

                    // split the data into lines
                    let lines = buffer.split('\n');
                    // assume that the last line is incomplete, add it back to the buffer
                    buffer = lines[lines.length - 1];

                    // log the complete lines
                    for (let lineno = 0; lineno < lines.length - 1; ++lineno) {
                        console.log(lines[lineno]);
                    }
                    // if enough time has passed (1 second), update the progress
                    let now = Date.now();
                    if (now - last_update > 250) {
                        progress.report({ message: lines[lines.length - 2], increment: 0 });
                        last_update = now;
                    }
                });
            }
        });
        const output = await output_promise;
        this.active_process = undefined;
        return output;
    }

    private async runTestCommand(id: string,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken): Promise<TestRunResult> {

        this.output_channel.appendLine(`running test command for ${id}`);

        let command: string;
        let test: CatkinTestInterface;

        if (id.startsWith('test_')) {
            // single test case 
            let testcase = this.testcases.get(id);
            this.output_channel.appendLine(`Id ${id} maps to test in package ${testcase.package.name}`);
            command = await this.makeBuildTestCommand(testcase);
            if (testcase.filter !== undefined) {
                command += `${testcase.executable} --gtest_filter=${testcase.filter}`;
            }
            test = testcase;

        } else if (id.startsWith('exec_')) {
            // full unit test run
            let exe = this.executables.get(id);
            this.output_channel.appendLine(`Id ${id} maps to executable ${exe.executable} in package ${exe.package.name}`);
            command = await this.makeBuildTestCommand(exe);
            command += `${exe.executable}`;
            test = exe;

        } else if (id.startsWith('package_')) {
            // full package test run
            let suite: CatkinTestSuite = this.suites.get(id);
            this.output_channel.appendLine(`Id ${id} maps to package ${suite.package.name}`);
            command = await this.makeBuildTestCommand(suite);
            test = suite;

        } else {
            throw Error(`Cannot handle test with id ${id}`);
        }

        let output_file: string;
        if (test.type !== 'suite') {
            if (test.type !== 'generic') {
                let gtest_xml = /--gtest_output=xml:([^'"`\s]+)/.exec(command);
                if (gtest_xml === undefined || gtest_xml === null) {
                    this.sendErrorForTest(test, `Cannot parse ${command}`);
                    console.log(`Cannot parse command ${command}`);
                    return new TestRunResult();
                }

                let gtest_xml_path = gtest_xml[1];
                if (gtest_xml_path.endsWith('.xml')) {
                    output_file = gtest_xml_path;
                } else {
                    output_file = path.join(gtest_xml_path, `${test.build_target}.xml`);
                }

                if (fs.existsSync(output_file)) {
                    fs.unlinkSync(output_file);
                }
            }
        }

        // run the test
        let test_result_message: string;
        let success = false;
        try {
            this.output_channel.appendLine(`command: ${command}`);
            let output = await this.runCommand(command, progress, token, '/tmp');
            this.output_channel.appendLine(`${output.stdout}`);
            this.output_channel.appendLine(`${output.stderr}`);
            test_result_message = output.stdout + '\n' + output.stderr;
            success = true;

        } catch (error_output) {
            this.output_channel.appendLine("ERROR: stdout:");
            this.output_channel.appendLine(`${error_output.stdout}`);
            this.output_channel.appendLine("stderr:");
            this.output_channel.appendLine(`${error_output.stderr}`);

            test_result_message = error_output.stdout + '\n' + error_output.stderr;
        }

        if (test.type === 'generic') {
            let tests = this.getTestCases(id);
            tests.forEach((test) => {
                let result: TestEvent = {
                    type: 'test',
                    test: test.info.id,
                    state: success ? 'passed' : 'failed',
                    message: test_result_message
                };
                this.testStatesEmitter.fire(result);
            });
            return new TestRunResult();

        } else if (test.type === 'suite') {
            let suite: CatkinTestSuite = this.suites.get(id);
            if (suite.executables === null) {
                console.log("Requested to run an empty suite, building and then retrying");
                return <TestRunResult>{
                    reload_packages: [<TestRunRepeatRequest>{
                        test: suite
                    }],
                    repeat_ids: [id]
                };
            } else {
                // run the individual executables of the suite
                return <TestRunResult>{
                    reload_packages: [],
                    repeat_ids: suite.executables.map((exe) => exe.info.id)
                };
            }
        } else {
            return await this.analyzeGtestResult(test, output_file, test_result_message);
        }
    }

    private getTestCases(id: string): CatkinTestCase[] {
        let tests: CatkinTestCase[] = [];

        if (id.startsWith('test_')) {
            // single test case 
            let testcase = this.testcases.get(id);
            tests.push(testcase);

        } else if (id.startsWith('exec_')) {
            // full unit test run
            let exe = this.executables.get(id);
            tests = tests.concat(exe.tests);

        } else if (id.startsWith('package_')) {
            // full package test run
            let suite = this.suites.get(id);

            if (suite.executables !== null) {
            suite.executables.forEach((exe) => {
                tests = tests.concat(exe.tests);
            });
            }

        } else {
            throw Error(`Cannot handle test with id ${id}`);
        }

        return tests;
    }
    private async analyzeCtestResult(test: CatkinTestInterface, test_result_message: string): Promise<TestRunResult> {
        let result = new TestRunResult();
        for (let line of test_result_message.split('\n')) {
            let match = /(\S*)[\s;]+--gtest_output=xml:(.*)$/g.exec(line);
            if (match !== null) {
                let exec: CatkinTestExecutable = this.getTestForExecutable(match[1]);
                if (exec !== undefined) {
                    let xml_file = match[2];
                    if (!match[2].endsWith('.xml')) {
                        xml_file = path.join(xml_file, `${exec.build_target}.xml`);
                    }
                    let intermediate_result = await this.analyzeGtestResult(exec, xml_file, test_result_message);
                    result.repeat_ids = result.repeat_ids.concat(intermediate_result.repeat_ids);
                    result.reload_packages = result.reload_packages.concat(intermediate_result.reload_packages);
                } else {
                    this.sendErrorForTest(test, test_result_message + `\nError: Cannot match executable ${match[1]}`);
                }
            }
        }
        return result;
    }

    private async analyzeGtestResult(test: CatkinTestInterface, output_file: string, test_output: string): Promise<TestRunResult> {
        let tests: CatkinTestCase[] = this.getTestCases(test.info.id);
        let dom = undefined;
        let result = new TestRunResult();
        try {
            let options = {
                ignoreAttributes: false,
                attrNodeName: "attr"
            };
            dom = xml.parse(fs.readFileSync(output_file).toString(), options);

            // send the result for all matching ids
            tests.forEach((test) => {
                this.sendResultForTest(test, dom, test_output);
            });

            if (test.info.id.startsWith("package_")) {
                result.reload_packages.push({
                    test: test as CatkinTestSuite,
                    dom: dom,
                    output: test_output
                });

            } else if (test.info.id.startsWith("exec_")) {
                let suite = this.getTestSuiteForExcutable(test.info.id);
                let contained = result.reload_packages.reduce((result, pkg) => {
                    if (pkg.test.info.id === suite.info.id) {
                        return true;
                    }
                    return result;
                }, false);
                if (!contained) {
                    result.reload_packages.push({
                        test: suite,
                        dom: dom,
                        output: test_output
                    });
                }
            }

        } catch (error) {
            test_output += `\n(Cannot read the test results results from ${output_file})`;
            this.sendErrorForTest(test, test_output);

            if (test.info.id.startsWith('exec_') || test.info.id.startsWith('package_')) {
                // suite failed, run tests individually
                result.repeat_ids = this.executables.get(test.info.id).tests.map((test) => test.info.id);
            }
        }

        return result;
    }

    private async reloadPackageIfChanged(test: CatkinTestInterface): Promise<CatkinTestSuite | undefined> {
        // check if a test suite was changed
        // this can happen, if a test executable was not compiled before the run,
        // or if the user changes the test itself between runs
        let [pkg_suite, old_suite] = await this.loadPackageTests(test.package, false, test.global_build_dir, test.global_devel_dir);
        if (!this.isSuiteEquivalent(old_suite, pkg_suite)) {
            // update the list of tests
            this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
            this.suites.set(pkg_suite.info.id, pkg_suite);
            old_suite = pkg_suite;
            this.updateSuiteSet();
            this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: this.catkin_tools_tests });

            if (old_suite.executables === null && pkg_suite.executables === null) {
                // if the old suite was not yet loaded, then this must be an empty suite
                pkg_suite.executables = [];
            }

            return pkg_suite;
        }

        return undefined;
    }

    private getTestForExecutable(exe_path: string): CatkinTestExecutable {
        for (let [id, exe] of this.executables.entries()) {
            if (exe.executable.toString().indexOf(exe_path) >= 0) {
                return exe;
            }
        }
        return undefined;
    }

    private getTestSuiteForExcutable(id: string): CatkinTestSuite {
        for (let [suite_id, suite] of this.suites.entries()) {
            if (suite.executables !== null) {
            for (let executable of suite.executables) {
                if (executable.info.id === id) {
                    return suite;
                }
            }
        }
        }
        return undefined;
    }

    private sendErrorForTest(test: CatkinTestInterface, message: string) {
        let result: TestEvent = {
            type: 'test',
            test: test.info.id,
            state: 'errored',
            message: message
        };
        this.testStatesEmitter.fire(result);
    }
    private sendResultForTest(test: CatkinTestInterface, dom, message: string) {
        let result: TestEvent = {
            type: 'test',
            test: test.info.id,
            state: 'errored',
            message: message
        };

        gtest_problem_matcher.analyze(dom, this.diagnostics);

        if (test.filter === undefined || test.filter === '*') {
            // this is the whole test executable
            let node_suites = dom['testsuites'];
            if (node_suites.attr['@_failures'] > 0 || node_suites.attr['@_errors'] > 0) {
                result.state = 'failed';
            } else {
                result.state = 'passed';
            }
            this.testStatesEmitter.fire(result);

        } else {
            // this is one single test case
            let node_suites = dom['testsuites']['testsuite'];
            if (!Array.isArray(node_suites)) {
                node_suites = [node_suites];
            }
            let test_suite = test.filter === undefined ? '*' : test.filter.substr(0, test.filter.lastIndexOf('.'));
            for (let node of node_suites) {
                if (node.attr['@_name'] === test_suite) {
                    if (node.attr['@_failures'] > 0 || node.attr['@_errors'] > 0) {
                        result.state = 'failed';
                    } else {
                        result.state = 'passed';
                    }
                    break;
                }
            }
            this.testStatesEmitter.fire(result);
        }
    }

    private isSuiteEquivalent(a: CatkinTestSuite, b: CatkinTestSuite): boolean {
        if (a.executables === null || b.executables === null) {
            return false;
        }
        if (a.executables.length !== b.executables.length) {
            return false;
        }
        for (let i = 0; i < a.executables.length; ++i) {
            if (!this.isExecutableEquivalent(a.executables[i], b.executables[i])) {
                return false;
            }
        }
        return true;
    }
    private isExecutableEquivalent(a: CatkinTestExecutable, b: CatkinTestExecutable): boolean {
        if (a.tests.length !== b.tests.length) {
            return false;
        }
        for (let i = 0; i < a.tests.length; ++i) {
            if (!this.isTestCaseEquivalent(a.tests[i], b.tests[i])) {
                return false;
            }
        }
        return true;
    }
    private isTestCaseEquivalent(a: CatkinTestCase, b: CatkinTestCase): boolean {
        return a.executable === b.executable && a.filter === b.filter;
    }

    public async debug(test_ids: string[]): Promise<void> {
        for (let test_id of test_ids) {
            let test: CatkinTestCase = this.testcases.get(test_id);
            this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests: [test_id] });

            // build the teset
            let command = await this.makeBuildTestCommand(test);
            await this.runCommand(command, undefined, undefined);

            if (vscode.debug.activeDebugSession !== undefined) {
                vscode.window.showInformationMessage("Cannot start debugger, another session is opened.");

            } else {
                // start the debugging session
                let parts: string[] = test.executable.toString().split(/\s/gi);
                let cmd: string = parts[0];
                parts.shift();
                let args: string[] = parts;

                let config: vscode.DebugConfiguration = {
                    type: 'cppdbg',
                    name: cmd,
                    request: 'launch',
                    MIMode: 'gdb',
                    cwd: this.workspaceRootDirectoryPath,
                    program: cmd, //"${workspaceFolder}",
                    args: args.concat(['--gtest_break_on_failure', `--gtest_filter=${test.filter}`])
                };
                await vscode.debug.startDebugging(undefined, config);
            }

            this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
        }
    }

    public cancel(): void {
        this.cancel_requested = true;
        if (this.active_process !== undefined) {
            this.active_process.kill();
        }
    }

    public dispose(): void {
        this.cancel();
    }
}
