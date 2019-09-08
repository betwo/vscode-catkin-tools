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

export function registerCatkinTest(context: vscode.ExtensionContext,
    catkin_workspace: CatkinWorkspace,
    testExplorerExtension,
    outputChannel) {
    type TestRunEvent = TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent;
    type TestLoadEvent = TestLoadStartedEvent | TestLoadFinishedEvent;

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

class CatkinTestCase {
    public package: CatkinPackage;
    public build_space: fs.PathLike;
    public build_target: String;
    public executable: fs.PathLike;
    public filter: String;
    public info: TestInfo;

    public global_build_dir: String;
    public global_devel_dir: String;
}

class CatkinTestExecutable {
    public package: CatkinPackage;
    public build_space: fs.PathLike;
    public build_target: String;
    public executable: fs.PathLike;
    public info: TestSuiteInfo;
    public tests: CatkinTestCase[];

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
        private readonly testsEmitter,
        private readonly testStatesEmitter,
        private readonly autorunEmitter
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

        // discover build targets:
        // ctest -N 
        //  ->
        // _ctest_csapex_math_tests_gtest_csapex_math_tests
        //                                `---------------`

        // find gtest build targets
        let build_targets = [];
        {
            try {
                let output = await runShellCommand('ctest -N -V', build_space);
                console.log(output.stdout);
                for (let line of output.stdout.split('\n')) {
                    // GTest target test
                    let gtest_match = line.match(/ Test\s+#.*gtest_(.*)/);
                    if (gtest_match) {
                        build_targets.push(gtest_match[1]);
                    } else {
                        // general CTest target test
                        let missing_exec_match = line.match(/Could not find executable\s+([^\s]+)/);
                        if (missing_exec_match) {
                            build_targets.push(path.basename(missing_exec_match[1]));
                        } else {
                            if (line.indexOf('catkin_generated') > 0) {
                                continue;
                            }
                            let ctest_match = line.match(/Test command:\s+([^\s]+)/);
                            if (ctest_match) {
                                let target = path.basename(ctest_match[1]);
                                if (target.length > 1 && target !== 'cmake') {
                                    build_targets.push(target);
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
            let exe = `${devel_dir}/.private/${catkin_package.name}/lib/${catkin_package.name}/${build_target}`;

            // create the executable
            let test_exec: CatkinTestExecutable = {
                package: catkin_package,
                build_space: build_space,
                build_target: build_target,
                global_build_dir: build_dir,
                global_devel_dir: devel_dir,
                executable: exe,
                info: {
                    type: 'suite',
                    id: `exec_${build_target}`,
                    label: build_target,
                    children: []
                },
                tests: []
            };

            try {
                // try to extract test names, if the target is compiled
                let output = await runShellCommand(`${exe} --gtest_list_tests`, build_space);
                for (let line of output.stdout.split('\n')) {
                    let match = line.match(/^([^\s]+)\.\s*$/);
                    if (match) {
                        let test_label = match[1];
                        let test_case: CatkinTestCase = {
                            package: catkin_package,
                            build_space: build_space,
                            build_target: build_target,
                            global_build_dir: build_dir,
                            global_devel_dir: devel_dir,
                            executable: exe,
                            filter: `${test_label}.*`,
                            info: {
                                type: 'test',
                                id: `test_${build_target}_${test_label}`,
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
                console.log(`Cannot determine ${exe}'s tests: ${err.error.message}`);

                let test_case: CatkinTestCase = {
                    package: catkin_package,
                    build_space: build_space,
                    build_target: build_target,
                    global_build_dir: build_dir,
                    global_devel_dir: devel_dir,
                    executable: exe,
                    filter: `*`,
                    info: {
                        type: 'test',
                        id: `test_${build_target}`,
                        label: build_target
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
        try {
            await Promise.all(nodeIds.map(async id => {
                if (id.startsWith("package_") || id.startsWith("exec_") || id === "all_tests") {
                    await this.runTestSuite(id);

                } else if (id.startsWith("test_")) {
                    await this.runTest(id);
                }
            }));
        } catch (err) {
            this.output_channel.appendLine(`Run failed: ${err}`);
            console.log(`Run failed: ${err}`);
        }

        this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
    }

    public async runTest(id: string): Promise<void> {
        this.output_channel.appendLine(`Running catkin_tools test for package ${id}`);

        try {
            await this.runTestCommand(id);
        } catch (err) {
            this.testStatesEmitter.fire({
                state: 'errored',
                type: 'test',
                test: id,
                message: `Failure running test ${id}: ${err}`
            });
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

    private async runTestSuite(id: string): Promise<void> {
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

        for (let test of tests) {
            if (this.cancel_requested) {
                this.skipTest(test.info.id);
            } else {
                await this.runTest(test.info.id);
            }
        }
    }

    private async makeBuildCommand(test: any) {
        return this.makePackageBuildCommand(test.package, test.build_space, test.build_target);
    }
    private async makePackageBuildCommand(catkin_package: CatkinPackage, build_space: fs.PathLike, build_target: String) {
        const setup_bash = await this.catkin_workspace.getSetupBash();
        let command = `source ${setup_bash};`;

        if (!fs.existsSync(build_space)) {
            command += `catkin build ${catkin_package.name} --no-status;`;
        }
        command += `pushd .; cd "${build_space}"; make -j $(nproc) ${build_target}; popd;`;
        return command;
    }

    private async runCommand(command: string, cwd?: string) {
        let output_promise = runShellCommand(`bash -c '${command}'`, cwd, (process) => {
            this.active_process = process;
        });
        const output = await output_promise;
        this.active_process = undefined;
        return output;
    }

    private async runTestCommand(id: string): Promise<void> {
        this.output_channel.appendLine(`running test command for ${id}`);

        let command: string;
        let test: CatkinTestCase | CatkinTestExecutable;
        let tests: CatkinTestCase[] = [];

        if (id.startsWith('test_')) {
            // single test case 
            test = this.testcases.get(id);
            this.output_channel.appendLine(`Id ${id} maps to test in package ${test.package.name}`);
            command = await this.makeBuildCommand(test);
            command += `${test.executable} --gtest_filter=${test.filter} --gtest_output=xml`;
            tests.push(test);

        } else if (id.startsWith('exec_')) {
            // full unit test run
            test = this.executables.get(id);
            this.output_channel.appendLine(`Id ${id} maps to executable in package ${test.package.name}`);
            command = await this.makeBuildCommand(test);
            command += `${test.executable} --gtest_output=xml`;
            test.tests.forEach((test: CatkinTestCase, key) => {
                tests.push(test);
            });

        } else {
            throw Error(`Cannot handle test with id ${id}`);
        }

        let result: TestEvent = {
            type: 'test',
            test: id,
            state: 'errored',
            message: 'unknown error'
        };

        // run the test
        try {
            this.output_channel.appendLine(`command: ${command}`);
            let output = await this.runCommand(command, '/tmp');
            this.output_channel.appendLine(`${output.stdout}`);
            result.message = output.stdout;
            result.state = 'passed';

        } catch (error_output) {
            this.output_channel.appendLine("ERROR: stdout:");
            this.output_channel.appendLine(`${error_output.stdout}`);
            this.output_channel.appendLine("stderr:");
            this.output_channel.appendLine(`${error_output.stderr}`);

            result.message = error_output.stdout;
            result.state = 'failed';

        }

        let dom = undefined;
        let output_xml = "/tmp/test_detail.xml";
        try {
            let options = {
                ignoreAttributes: false,
                attrNodeName: "attr"
            };
            dom = xml.parse(fs.readFileSync(output_xml).toString(), options);
        } catch (error) {
            result.message = `Cannot read the test results results from ${output_xml}`;
        }

        // send the result for all matching ids
        tests.forEach((test) => {
           this.sendResultForTest(test, dom);
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
                    this.sendResultForTest(test, dom);
                });
            });

        }
    }

    private sendResultForTest(test: CatkinTestCase, dom) {
        let result: TestEvent = {
            type: 'test',
            test: test.info.id,
            state: 'errored',
            message: 'unknown error'
        };    
        let test_suite = test.filter.substr(0, test.filter.lastIndexOf('.'));
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
            await this.runCommand(command);

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
