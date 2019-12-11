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
import { runShellCommand } from './catkin_command';
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

type TestType = "gtest" | "ctest" | "python" | "suite";

class CatkinTestInterface {
    public package: CatkinPackage;

    public type: TestType;
    public filter: String;
    public executable?: fs.PathLike;

    public build_space: fs.PathLike;
    public build_target: String;
    public global_build_dir: String;
    public global_devel_dir: String;

    public info: TestInfo | TestSuiteInfo;
}

class CatkinTestCase extends CatkinTestInterface {
    public info: TestInfo;
}

class CatkinTestExecutable extends CatkinTestInterface {
    public tests: CatkinTestCase[];
    public info: TestSuiteInfo;
}

class CatkinTestSuite extends CatkinTestInterface {
    public executables: CatkinTestExecutable[];
    public info: TestSuiteInfo;
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
        this.output_channel.appendLine('Initializing catkin_tools test adapter');
        this.diagnostics = vscode.languages.createDiagnosticCollection(`catkin_tools`);
    }

    public get tests() { return this.testsEmitter.event; }
    public get testStates() { return this.testStatesEmitter.event; }
    public get autorun() { return this.autorunEmitter.event; }

    public async load(): Promise<void> {
        this.output_channel.appendLine('Loading catkin tools tests');
        this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });

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
                    try {
                        let pkg_suite = await this.loadPackageTests(catkin_package, build_dir, devel_dir, true);
                        this.suites.set(pkg_suite.info.id, pkg_suite);
                    } catch (error) {
                        console.log(`Error loading tests of package ${catkin_package.name}`);
                    }
                }
                this.updateSuiteSet();

                progress.report({ increment: 100, message: `Found ${this.suites.size} test suites` });
                this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: this.catkin_tools_tests });
            } catch (err) {
                this.output_channel.appendLine(`Error loading catkin tools tests: ${err}`);
                this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', errorMessage: err });
            }
        });
    }

    private updateSuiteSet() {
        let test_packages: CatkinTestSuite[] = [];
        this.suites.forEach((value, key) => {
            test_packages.push(value);
        });
        this.catkin_tools_tests = {
            id: "all_tests", label: "catkin_tools", type: 'suite', children: test_packages.map(suite => suite.info)
        };
    }

    private async loadPackageTests(catkin_package: CatkinPackage, build_dir: String, devel_dir: String, outline_only: boolean = false):
        Promise<CatkinTestSuite> {
        let build_space = `${build_dir}/${catkin_package.name}`;

        // discover build targets:
        // ctest -N 
        //  ->
        // _ctest_csapex_math_tests_gtest_csapex_math_tests
        //                                `---------------`

        // find gtest build targets
        class BuildTarget {
            constructor(public cmake_target: string,
                public exec_path: string,
                public type: TestType) { }
        }
        let build_targets: BuildTarget[] = [];
        try {
            let output = await runShellCommand('ctest -N -V', build_space);
            console.log(output.stdout);
            let current_executable: string = undefined;
            let current_test_type: TestType = undefined;
            let missing_exe = undefined;
            for (let line of output.stdout.split('\n')) {

                let test_command = line.match(/[0-9]+: Test command:\s+(.*)$/);
                if (test_command !== null) {
                    if (line.indexOf('catkin_generated') > 0) {
                        let python_gtest_wrapper = line.match(/[0-9]+: Test command:\s+.*env_cached.sh\s*.*"([^"]+\s+--gtest_output=[^"]+)".*/);
                        if (python_gtest_wrapper !== null) {
                            current_executable = python_gtest_wrapper[1];
                            current_test_type = 'gtest';
                        } else {
                            current_executable = test_command[1];
                            current_test_type = 'python';
                        }
                    } else {
                        current_executable = test_command[1];
                        current_test_type = 'gtest';
                    }
                    continue;
                }
                // GTest target test
                let gtest_match = line.match(/ Test\s+#.*gtest_(.*)/);
                if (gtest_match) {
                    if (current_executable === undefined) {
                        continue;
                    }
                    let target: BuildTarget = {
                        cmake_target: gtest_match[1],
                        exec_path: current_executable,
                        type: current_test_type
                    };
                    build_targets.push(target);
                } else {
                    if (line.indexOf('catkin_generated') > 0) {
                        continue;
                    }
                    // general CTest target test
                    let missing_exec_match = line.match(/Could not find executable\s+([^\s]+)/);
                    if (missing_exec_match) {
                        missing_exe = missing_exec_match[1];
                    } else {
                        let ctest_match = line.match(/\s+Test\s+#[0-9]+:\s+([^\s]+)/);
                        if (ctest_match) {
                            if (current_executable === undefined) {
                                continue;
                            }
                            let target = ctest_match[1];
                            if (target.length > 1 && target !== 'cmake') {
                                let cmd = current_executable;
                                if (missing_exe !== undefined) {
                                    cmd = missing_exe + " " + cmd;
                                }
                                build_targets.push({
                                    cmake_target: target,
                                    exec_path: cmd,
                                    type: 'ctest'
                                });
                            }
                            missing_exe = undefined;
                        }
                    }
                }
            }
        } catch (err) {
            console.log(`Cannot call ctest for ${catkin_package.name}`);
            throw err;
        }
        if (build_targets.length === 0) {
            throw Error("No tests in package");
        }

        // create the test suite
        let pkg_suite: CatkinTestSuite = {
            type: 'suite',
            package: catkin_package,
            build_space: build_space,
            build_target: 'run_tests',
            global_build_dir: build_dir,
            global_devel_dir: devel_dir,
            filter: undefined,
            info: {
                type: 'suite',
                id: `package_${catkin_package.name}`,
                label: catkin_package.name,
                children: []
            },
            executables: []
        };

        // generate a list of all tests in this target
        for (let build_target of build_targets) {
            // create the executable
            let test_exec: CatkinTestExecutable = {
                type: build_target.type,
                package: catkin_package,
                build_space: build_space,
                build_target: build_target.cmake_target,
                global_build_dir: build_dir,
                global_devel_dir: devel_dir,
                executable: build_target.exec_path,
                filter: build_target.type === 'python' ? undefined : "*",
                info: {
                    type: 'suite',
                    id: `exec_${build_target.cmake_target}`,
                    label: build_target.cmake_target,
                    children: []
                },
                tests: []
            };

            if(!outline_only) {    
                try {
                    // try to extract test names, if the target is compiled
                    let cmd = await this.makeWorkspaceCommand(`${build_target.exec_path} --gtest_list_tests`);
                    let output = await runShellCommand(cmd, build_space);
                    for (let line of output.stdout.split('\n')) {
                        let match = line.match(/^([^\s]+)\.\s*$/);
                        if (match) {
                            let test_label = match[1];
                            let test_case: CatkinTestCase = {
                                package: catkin_package,
                                build_space: build_space,
                                build_target: build_target.cmake_target,
                                global_build_dir: build_dir,
                                global_devel_dir: devel_dir,
                                executable: build_target.exec_path,
                                filter: build_target.type === 'python' ? undefined : `${test_label}.*`,
                                type: build_target.type,
                                info: {
                                    type: 'test',
                                    id: `test_${build_target.cmake_target}_${test_label}`,
                                    label: test_label
                                }
                            };
                            this.testcases.set(test_case.info.id, test_case);
                            test_exec.tests.push(test_case);
                            test_exec.info.children.push(test_case.info);
                        }
                    }
                } catch (err) {
                    // if the target is not compiled, do not add filters
                    console.log(`Cannot determine ${build_target.exec_path}'s tests: ${err.error.message}`);
                }
            }
            if (test_exec.tests.length === 0) {
                let test_case: CatkinTestCase = {
                    type: build_target.type,
                    package: catkin_package,
                    build_space: build_space,
                    build_target: build_target.cmake_target,
                    global_build_dir: build_dir,
                    global_devel_dir: devel_dir,
                    executable: build_target.exec_path,
                    filter: build_target.type === 'python' ? undefined : `*`,
                    info: {
                        type: 'test',
                        id: `exec_${build_target.cmake_target}`,
                        label: build_target.cmake_target
                    }
                };
                this.testcases.set(test_case.info.id, test_case);
                test_exec.tests.push(test_case);
                test_exec.info.children.push(test_case.info);
            }

            this.executables.set(test_exec.info.id, test_exec);
            pkg_suite.executables.push(test_exec);
            pkg_suite.info.children.push(test_exec.info);
        }

        return pkg_suite;
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

    private async makeBuildCommand(test: CatkinTestInterface) {
        let command = "";
        if (!fs.existsSync(test.build_space)) {
            command += `catkin build ${test.package.name} --no-notify --no-status;`;
        }
        command += `cd "${test.build_space}";`;
        if (test.type === 'suite') {
            command += `make -j $(nproc) tests;`;
            command += `make run_tests;`;
        } else {
            command += `make -j $(nproc) ${test.build_target}`;
        }
        return this.makeWorkspaceCommand(command);
    }

    private async makeWorkspaceCommand(payload: string) {
        const setup_bash = await this.catkin_workspace.getSetupBash();
        let command = `source ${setup_bash};`;
        command += `pushd . > /dev/null; cd "${this.workspaceRootDirectoryPath}";`;
        command += `${payload}`;
        if (!payload.endsWith(";")) {
            command += "; ";
        }
        command += `popd > /dev/null;`;
        return command;
    }

    private async runCommand(command: string,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken,
        cwd?: string) {

        let output_promise = runShellCommand(`bash -c '${command}'`, cwd, (process) => {
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
            command = await this.makeBuildCommand(testcase);
            if (testcase.filter !== undefined) {
                command += `${testcase.executable} --gtest_filter=${testcase.filter}`;
            }
            test = testcase;

        } else if (id.startsWith('exec_')) {
            // full unit test run
            let exe = this.executables.get(id);
            this.output_channel.appendLine(`Id ${id} maps to executable ${exe.executable} in package ${exe.package.name}`);
            command = await this.makeBuildCommand(exe);
            command += `${exe.executable}`;
            test = exe;

        } else if (id.startsWith('package_')) {
            // full package test run
            let suite: CatkinTestSuite = this.suites.get(id);
            this.output_channel.appendLine(`Id ${id} maps to package ${suite.package.name}`);
            command = await this.makeBuildCommand(suite);
            test = suite;

        } else {
            throw Error(`Cannot handle test with id ${id}`);
        }

        let output_file: string;
        if (test.type !== 'suite') {
            if (test.type !== 'python') {
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

        if (test.type === 'python') {
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
            return await this.analyzeCtestResult(test, test_result_message);
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
            suite.executables.forEach((exe) => {
                tests = tests.concat(exe.tests);
            });

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

            if (test.info.id.startsWith('exec_')) {
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
        let pkg_suite = await this.loadPackageTests(test.package, test.global_build_dir, test.global_devel_dir);
        let old_suite = this.suites.get(pkg_suite.info.id);
        if (!this.isSuiteEquivalent(old_suite, pkg_suite)) {
            // update the list of tests
            this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
            this.suites.set(pkg_suite.info.id, pkg_suite);
            old_suite = pkg_suite;
            this.updateSuiteSet();
            this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: this.catkin_tools_tests });

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
            for (let executable of suite.executables) {
                if (executable.info.id === id) {
                    return suite;
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
            let command = await this.makeBuildCommand(test);
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
