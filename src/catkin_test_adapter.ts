import * as child_process from 'child_process';
import * as vscode from 'vscode';
import {
    TestEvent,
    testExplorerExtensionId,
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
import { runShellCommand, ShellOutput } from './catkin_command';

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
}

class CatkinTestExecutable {
    public package: CatkinPackage;
    public build_space: fs.PathLike;
    public build_target: String;
    public executable: fs.PathLike;
    public info: TestSuiteInfo;
    public tests: CatkinTestCase[];
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

        let build_dir = await this.catkin_workspace.getBuildDir();
        let devel_dir = await this.catkin_workspace.getDevelDir();

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
                let progress_relative = (1.0 / packages_with_tests);
                let accumulated_progress = 0.0;
                let test_packages: CatkinTestSuite[] = [];
                for (let catkin_package of this.catkin_workspace.packages) {
                    if (!catkin_package.has_tests) {
                        continue;
                    }

                    accumulated_progress += progress_relative;
                    if (accumulated_progress > 1.0) {
                        let integer_progress = Math.floor(accumulated_progress);
                        accumulated_progress -= integer_progress;
                        progress.report({
                            increment: integer_progress,
                            message: `Parsing ${catkin_package.name} for tests`
                        });
                    }

                    let build_space = `${build_dir}/${catkin_package.name}`;

                    // discover build targets:
                    // ctest -N 
                    //  ->
                    // _ctest_csapex_math_tests_gtest_csapex_math_tests
                    //                                `---------------`
                    let options: child_process.ExecSyncOptionsWithStringEncoding = {
                        'cwd': build_space,
                        'encoding': 'utf8'
                    };

                    // find gtest build targets
                    let build_targets = [];
                    {
                        try {
                            let stdout = child_process.execSync('ctest -N -V', options);
                            console.log(stdout);
                            for (let line of stdout.split('\n')) {
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
                            continue;
                        }
                    }
                    if (build_targets.length === 0) {
                        continue;
                    }

                    // generate a list of all tests in this target
                    let pkg_executables: CatkinTestExecutable[] = [];
                    for (let build_target of build_targets) {
                        let exe = `${devel_dir}/.private/${catkin_package.name}/lib/${catkin_package.name}/${build_target}`;

                        let test_cases: CatkinTestCase[] = [];
                        {
                            try {
                                // try to extract test names, if the target is compiled
                                let stdout = child_process.execSync(`${exe} --gtest_list_tests`, options);
                                for (let line of stdout.split('\n')) {
                                    let match = line.match(/^([^\s]+)\.\s*$/);
                                    if (match) {
                                        let test_label = match[1];
                                        let test_case: CatkinTestCase = {
                                            package: catkin_package,
                                            build_space: build_space,
                                            build_target: build_target,
                                            executable: exe,
                                            filter: `${test_label}.*`,
                                            info: {
                                                type: 'test',
                                                id: `test_${build_target}_${test_label}`,
                                                label: test_label
                                            }
                                        };
                                        this.testcases[test_case.info.id] = test_case;
                                        test_cases.push(test_case);
                                    }
                                }
                            } catch (err) {
                                // if the target is not compiled, do not add filters
                                console.log(`Cannot determine ${exe}'s tests`);

                                let test_case: CatkinTestCase = {
                                    package: catkin_package,
                                    build_space: build_space,
                                    build_target: build_target,
                                    executable: exe,
                                    filter: `*`,
                                    info: {
                                        type: 'test',
                                        id: `test_${build_target}`,
                                        label: build_target
                                    }
                                };
                                this.testcases[test_case.info.id] = test_case;
                                test_cases.push(test_case);
                            }
                        }

                        // create the executable
                        let test_exec: CatkinTestExecutable = {
                            package: catkin_package,
                            build_space: build_space,
                            build_target: build_target,
                            executable: exe,
                            info: {
                                type: 'suite',
                                id: `exec_${build_target}`,
                                label: build_target,
                                children: test_cases.map(test => test.info)
                            },
                            tests: test_cases
                        };
                        this.executables[test_exec.info.id] = test_exec;
                        pkg_executables.push(test_exec);
                    }

                    // create the test suite
                    let pkg_suite: CatkinTestSuite = {
                        package: catkin_package,
                        info: {
                            type: 'suite',
                            id: `package_${catkin_package.name}`,
                            label: catkin_package.name,
                            children: pkg_executables.map(exec => exec.info)
                        },
                        executables: pkg_executables
                    };
                    this.suites[pkg_suite.info.id] = (pkg_suite);
                    test_packages.push(pkg_suite);
                }

                let catkin_tools_tests: TestSuiteInfo = {
                    id: "all_tests", label: "catkin_tools", type: 'suite', children: test_packages.map(suite => suite.info)
                };

                progress.report({ increment: 100, message: `Found ${test_packages.length} test suites` });
                this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: catkin_tools_tests });
            } catch (err) {
                this.output_channel.appendLine(`Error loading catkin tools tests: ${err}`);
                this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished' });
            }
        });
    }

    public async run(nodeIds: string[]): Promise<void> {
        this.output_channel.appendLine(`Running test(s): ${nodeIds.join(', ')}`);
        this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests: nodeIds });
        try {
            await Promise.all(nodeIds.map(async id => {
                if (id.startsWith("package_") || id.startsWith("exec_") || id === "all_tests") {
                    let results = await this.runTestSuite(id);
                    for (let result of results) {
                        this.testStatesEmitter.fire(<TestEvent>result);
                    }

                } else if (id.startsWith("test_")) {
                    let result = await this.runTestCommand(id);
                    this.testStatesEmitter.fire(<TestEvent>result);
                }
            }));
        } catch (err) {
            this.output_channel.appendLine(`Run failed: ${err}`);
            console.log(`Run failed: ${err}`);
        }

        this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
    }

    public async runTest(id: string): Promise<TestEvent> {
        this.output_channel.appendLine(`Running catkin_tools test for package ${id}`);

        try {
            return this.runTestCommand(id);
        } catch (err) {
            let result: TestEvent = {
                type: 'test',
                test: id,
                state: 'errored',
                message: err
            };
            return result;
        }
    }

    private async runTestSuite(id: string): Promise<TestEvent[]> {
        this.output_channel.appendLine(`Running catkin_tools test suite ${id}`);

        let tests: CatkinTestCase[] = [];
        let ids = [];
        if (id.startsWith("package_")) {
            let suite: CatkinTestSuite = this.suites[id];
            for (let exe of suite.executables) {
                ids.push(exe.info.id);
                tests = tests.concat(exe.tests);
            }

        } else if (id.startsWith("exec_")) {
            let exe = this.executables[id];
            ids.push(id);
            tests = tests.concat(exe.tests);

        } else if (id === "all_tests") {
            for (let id in this.suites) {
                for (let exe of this.suites[id].executables) {
                    ids.push(exe.info.id);
                    tests = tests.concat(exe.tests);
                }
            }
        }

        if (tests.length === 0) {
            this.output_channel.appendLine(`No test found with id ${id}`);
            return ids.map((id): TestEvent => {
                return {
                    state: 'errored',
                    type: 'test',
                    test: id,
                    message: `No test found with id ${id}`
                };
            });
        }

        try {
            const results: TestEvent[] = await Promise.all(tests.map(async test => {
                const output: TestEvent = await this.runTest(test.info.id);
                return output;
            }));

            this.output_channel.appendLine(`Resolving catkin_tools test suite with ${results.length} results`);
            return [].concat(...results);

        } catch (err) {
            this.output_channel.appendLine(`Test suite error ${err}`);
            return ids.map((id): TestEvent => {
                return {
                    type: 'test',
                    state: 'errored',
                    test: id,
                    message: `Failure running test ${id}: ${err}`
                };
            });
        }
    }

    private async runTestCommand(id: string): Promise<TestEvent> {
        this.output_channel.appendLine(`running test command for ${id}`);

        let test = this.testcases[id];
        this.output_channel.appendLine(`Id ${id} maps to test in package ${test.package.name}`);

        const setup_bash = await this.catkin_workspace.getSetupBash();
        let command = `source ${setup_bash};`;

        if (!fs.existsSync(test.build_space)) {
            command += `catkin build ${test.package.name} --no-status;`;
        }
        command += `pushd .; cd "${test.build_space}"; make -j $(nproc) ${test.build_target}; popd;`;
        command += `${test.executable} --gtest_filter=${test.filter} --gtest_output=xml`;

        this.output_channel.appendLine(`command: ${command}`);

        let result: TestEvent = {
            type: 'test',
            test: id,
            state: 'errored',
            message: 'unknown error'
        };

        try {
            const output = await runShellCommand(`bash -c '${command}'`);
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

        return result;
    }

    public async debug(_tests: string[]): Promise<void> {
        throw new Error('Debugging is not supported.');
    }

    public cancel(): void {
        throw new Error('Canceling ist not supported.');
    }

    public dispose(): void {
        this.cancel();
    }
}
