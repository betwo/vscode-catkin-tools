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

type TestType = "gtest" | "ctest" | "python";

class CatkinTestCase {
    public package: CatkinPackage;
    public build_space: fs.PathLike;
    public build_target: String;
    public executable: fs.PathLike;
    public filter: String;
    public info: TestInfo;
    public type: TestType;

    public global_build_dir: String;
    public global_devel_dir: String;
}

class CatkinTestExecutable {
    public package: CatkinPackage;
    public build_space: fs.PathLike;
    public build_target: String;
    public executable: fs.PathLike;
    public filter: String;
    public info: TestSuiteInfo;
    public tests: CatkinTestCase[];
    public type: TestType;

    public global_build_dir: String;
    public global_devel_dir: String;
}

class CatkinTestSuite {
    public package: CatkinPackage;
    public info: TestSuiteInfo;

    public executables: CatkinTestExecutable[];
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

    constructor(
        public readonly workspaceRootDirectoryPath: string,
        public readonly catkin_workspace: CatkinWorkspace,
        private readonly output_channel: vscode.OutputChannel,
        private readonly testsEmitter: vscode.EventEmitter<TestLoadEvent>,
        private readonly testStatesEmitter: vscode.EventEmitter<TestRunEvent>,
        private readonly autorunEmitter: vscode.EventEmitter<void>
    ) {
        this.output_channel.appendLine('Initializing catkin_tools test adapter');
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
                        let pkg_suite = await this.loadPackageTests(catkin_package, build_dir, devel_dir);
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
                this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished' });
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

    private async loadPackageTests(catkin_package: CatkinPackage, build_dir: String, devel_dir: String):
        Promise<CatkinTestSuite> {
        let build_space = `${build_dir}/${catkin_package.name}`;

        // TODO: only do this when the test is run, or when the user expands the entry
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
        {
            try {
                let output = await runShellCommand('ctest -N -V', build_space);
                console.log(output.stdout);
                let current_executable: string = undefined;
                let current_test_type: TestType = undefined;
                for (let line of output.stdout.split('\n')) {

                    let test_command = line.match(/[0-9]+: Test command:\s+(.*)$/);
                    if (test_command) {
                        current_executable = test_command[1];
                        current_test_type = 'gtest';
                        if (line.indexOf('catkin_generated') > 0) {
                            current_test_type = 'python';
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
                            build_targets.push({
                                cmake_target: path.basename(missing_exec_match[1]),
                                exec_path: missing_exec_match[1],
                                type: 'ctest'
                            });
                        } else {
                            let ctest_match = line.match(/\s+Test\s+#[0-9]+:\s+([^\s]+)/);
                            if (ctest_match) {
                                if (current_executable === undefined) {
                                    continue;
                                }
                                let target = ctest_match[1];
                                if (target.length > 1 && target !== 'cmake') {
                                    build_targets.push({
                                        cmake_target: target,
                                        exec_path: current_executable,
                                        type: 'ctest'
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.log(`Cannot call ctest for ${catkin_package.name}`);
                throw err;
            }
        }
        if (build_targets.length === 0) {
            throw Error("No tests in package");
        }

        // create the test suite
        let pkg_suite: CatkinTestSuite = {
            package: catkin_package,
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
                package: catkin_package,
                build_space: build_space,
                build_target: build_target.cmake_target,
                global_build_dir: build_dir,
                global_devel_dir: devel_dir,
                executable: build_target.exec_path,
                filter: build_target.type === 'python' ? undefined : "*",
                type: build_target.type,
                info: {
                    type: 'suite',
                    id: `exec_${build_target.cmake_target}`,
                    label: build_target.cmake_target,
                    children: []
                },
                tests: []
            };

            try {
                // try to extract test names, if the target is compiled
                let output = await runShellCommand(`${build_target.exec_path} --gtest_list_tests`, build_space);
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
                                label: `${build_target.cmake_target} :: ${test_label}`
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

                let test_case: CatkinTestCase = {
                    package: catkin_package,
                    build_space: build_space,
                    build_target: build_target.cmake_target,
                    global_build_dir: build_dir,
                    global_devel_dir: devel_dir,
                    executable: build_target.exec_path,
                    filter: build_target.type === 'python' ? undefined : `*`,
                    type: build_target.type,
                    info: {
                        type: 'test',
                        id: `test_${build_target.cmake_target}`,
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
        this.cancel_requested = false;

        this.output_channel.appendLine(`Running test(s): ${nodeIds.join(', ')}`);
        this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests: nodeIds });
        let repeat_ids: string[] = await vscode.window.withProgress<string[]>({
            location: vscode.ProgressLocation.Notification,
            title: nodeIds.join(', '),
            cancellable: true,
        }, async (progress, token) => {
            token.onCancellationRequested(() => {
                this.cancel_requested = true;
            });
            let repeat_ids: string[] = [];
            try {
                for (let id of nodeIds) {
                    let ids: string[];
                    if (id.startsWith("package_") || id.startsWith("exec_") || id === "all_tests") {
                        ids = await this.runTestSuite(id, progress, token);

                    } else if (id.startsWith("test_")) {
                        ids = await this.runTest(id, progress, token);
                    }
                    repeat_ids = repeat_ids.concat(ids);
                }
            } catch (err) {
                this.output_channel.appendLine(`Run failed: ${err}`);
                console.log(`Run failed: ${err}`);
            }
            return repeat_ids;
        });

        this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });

        if (repeat_ids.length > 0) {
            this.run(repeat_ids);
        }
    }

    public async runTest(id: string,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken): Promise<string[]> {
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
            return [];
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
        token: vscode.CancellationToken): Promise<string[]> {
        this.output_channel.appendLine(`Running catkin_tools test suite ${id}`);

        let tests: CatkinTestExecutable[] = [];
        let ids = [];
        if (id.startsWith("package_")) {
            let suite: CatkinTestSuite = this.suites.get(id);
            suite.executables.forEach((exe, key) => {
                ids.push(exe.info.id);
                tests.push(exe);
            });

        } else if (id.startsWith("exec_")) {
            let exe = this.executables.get(id);
            ids.push(id);
            tests.push(exe);

        } else if (id === "all_tests") {
            this.suites.forEach((suite, key) => {
                suite.executables.forEach((exe, key) => {
                    ids.push(exe.info.id);
                    tests.push(exe);
                });
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

        let repeat_ids: string[] = [];
        for (let test of tests) {
            if (this.cancel_requested) {
                this.skipTest(test.info.id);
            } else {
                let ids: string[] = await this.runTest(test.info.id, progress, token);
                repeat_ids = repeat_ids.concat(ids);
            }
        }
        return repeat_ids;
    }

    private async makeBuildCommand(test: any) {
        return this.makePackageBuildCommand(test.package, test.build_space, test.build_target);
    }
    private async makePackageBuildCommand(catkin_package: CatkinPackage, build_space: fs.PathLike, build_target: String) {
        const setup_bash = await this.catkin_workspace.getSetupBash();
        let command = `echo "source ${setup_bash}"; source ${setup_bash}; set -x;`;
        command += `pushd . > /dev/null; cd "${this.workspaceRootDirectoryPath}";`;
        if (!fs.existsSync(build_space)) {
            command += `catkin build ${catkin_package.name} --no-notify --no-status;`;
        }
        command += `cd "${build_space}";`;
        command += `make -j $(nproc) ${build_target}; popd > /dev/null; set +x;`;
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
        token: vscode.CancellationToken): Promise<string[]> {

        this.output_channel.appendLine(`running test command for ${id}`);

        let command: string;
        let test: CatkinTestCase | CatkinTestExecutable;
        let tests: CatkinTestCase[] = [];

        if (id.startsWith('test_')) {
            // single test case 
            test = this.testcases.get(id);
            this.output_channel.appendLine(`Id ${id} maps to test in package ${test.package.name}`);
            command = await this.makeBuildCommand(test);
            if (test.filter !== undefined) {
                command += `${test.executable} --gtest_filter=${test.filter}`;
            }
            tests.push(test);

        } else if (id.startsWith('exec_')) {
            // full unit test run
            test = this.executables.get(id);
            this.output_channel.appendLine(`Id ${id} maps to executable in package ${test.package.name}`);
            command = await this.makeBuildCommand(test);
            command += `${test.executable}`;
            test.tests.forEach((test: CatkinTestCase, key) => {
                tests.push(test);
            });

        } else {
            throw Error(`Cannot handle test with id ${id}`);
        }

        let output_file: string;

        if (test.type !== 'python') {
            let gtest_xml = /--gtest_output=xml:([^'"`\s]+)/.exec(command);
            if (gtest_xml === undefined || gtest_xml === null) {
                this.sendResultForTest(test, undefined, `Cannot parse ${command}`);
                console.log(gtest_xml);
                return [];
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

        // run the test
        let test_result_message: string;
        let success = false;
        try {
            this.output_channel.appendLine(`command: ${command}`);
            let output = await this.runCommand(command, progress, token, '/tmp');
            this.output_channel.appendLine(`${output.stdout}`);
            test_result_message = output.stdout;
            success = true;

        } catch (error_output) {
            this.output_channel.appendLine("ERROR: stdout:");
            this.output_channel.appendLine(`${error_output.stdout}`);
            this.output_channel.appendLine("stderr:");
            this.output_channel.appendLine(`${error_output.stderr}`);

            test_result_message = error_output.stdout + '\n' + error_output.stderr;
        }

        if (test.type === 'python') {
            tests.forEach((test) => {
                let result: TestEvent = {
                    type: 'test',
                    test: test.info.id,
                    state: success ? 'passed' : 'failed',
                    message: test_result_message
                };
                this.testStatesEmitter.fire(result);
            });
            return;
        }

        let repeat_ids = [];
        let dom = undefined;
        try {
            let options = {
                ignoreAttributes: false,
                attrNodeName: "attr"
            };
            dom = xml.parse(fs.readFileSync(output_file).toString(), options);
        } catch (error) {
            test_result_message += `\n(Cannot read the test results results from ${output_file})`;

            if (id.startsWith('exec_')) {
                // suite failed, run tests individually
                repeat_ids = this.executables.get(id).tests.map((test) => test.info.id);
            }
        }

        // send the result for all matching ids
        tests.forEach((test) => {
            this.sendResultForTest(test, dom, test_result_message);
        });

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

            // send the test results again
            pkg_suite.executables.forEach((exe) => {
                exe.tests.forEach((test) => {
                    this.sendResultForTest(test, dom, test_result_message);
                });
            });
        }

        return repeat_ids;
    }

    private sendResultForTest(test: CatkinTestCase | CatkinTestExecutable, dom, message: string) {
        let result: TestEvent = {
            type: 'test',
            test: test.info.id,
            state: 'errored',
            message: message
        };
        let test_suite = test.filter.substr(0, test.filter.lastIndexOf('.'));
        if (dom !== undefined) {
            let node_suites = dom['testsuites']['testsuite'];
            if (!Array.isArray(node_suites)) {
                node_suites = [node_suites];
            }
            for (let node of node_suites) {
                if (node.attr['@_name'] === test_suite) {
                    if (node.attr['@_failures'] > 0) {
                        result.state = 'failed';
                    } else {
                        result.state = 'passed';
                    }
                    break;
                }
            }
        }
        this.testStatesEmitter.fire(result);
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
                let config: vscode.DebugConfiguration = {
                    type: 'cppdbg',
                    name: test.executable.toString(),
                    request: 'launch',
                    MIMode: 'gdb',
                    cwd: this.workspaceRootDirectoryPath,
                    program: test.executable.toString(), //"${workspaceFolder}",
                    args: ['--gtest_break_on_failure', `--gtest_filter=${test.filter}`]
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
