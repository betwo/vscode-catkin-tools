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

    private cancel_requested: boolean = false;
    private active_process: child_process.ChildProcess;

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
                let test_packages: CatkinTestSuite[] = [];

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
                        const pkg_suite = await this.loadPackageTests(catkin_package, build_dir, devel_dir);
                        test_packages.push(pkg_suite);
                    } catch (error) {
                        console.log(`Error loading tests of package ${catkin_package.name}`);
                    }
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

    private async loadPackageTests(catkin_package: CatkinPackage, build_dir: string, devel_dir: string):
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

        // generate a list of all tests in this target
        let pkg_executables: CatkinTestExecutable[] = [];
        for (let build_target of build_targets) {
            let exe = `${devel_dir}/.private/${catkin_package.name}/lib/${catkin_package.name}/${build_target}`;

            let test_cases: CatkinTestCase[] = [];
            {
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
                    console.log(`Cannot determine ${exe}'s tests: ${err.error.message}`);

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
            let result = await this.runTestCommand(id);
            this.testStatesEmitter.fire(result);
        } catch (err) {
            this.testStatesEmitter.fire(
                {
                    state: 'errored',
                    type: 'test',
                    test: id,
                    message: `Failure running test ${id}: ${err}`
                });
        }
    }

    private async runTestSuite(id: string): Promise<void> {
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
            ids.map((id) => {
                this.testStatesEmitter.fire(
                    {
                        state: 'errored',
                        type: 'test',
                        test: id,
                        message: `No test found with id ${id}`
                    });
            });
        }

        for (let test of tests) {
            if (this.cancel_requested) {
                break;
            }
            await this.runTest(test.info.id);
        }
    }

    private async makeBuildCommand(test: CatkinTestCase) {
        const setup_bash = await this.catkin_workspace.getSetupBash();
        let command = `source ${setup_bash};`;

        if (!fs.existsSync(test.build_space)) {
            command += `catkin build ${test.package.name} --no-status;`;
        }
        command += `pushd .; cd "${test.build_space}"; make -j $(nproc) ${test.build_target}; popd;`;
        return command;
    }

    private async runCommand(command: string) {
        let output_promise = runShellCommand(`bash -c '${command}'`, undefined, (process) => {
            this.active_process = process;
        });
        const output = await output_promise;
        this.active_process = undefined;
        return output;
    }

    private async runTestCommand(id: string): Promise<TestEvent> {
        this.output_channel.appendLine(`running test command for ${id}`);

        let test = this.testcases[id];
        this.output_channel.appendLine(`Id ${id} maps to test in package ${test.package.name}`);

        let command = await this.makeBuildCommand(test);
        command += `${test.executable} --gtest_filter=${test.filter} --gtest_output=xml`;

        this.output_channel.appendLine(`command: ${command}`);

        let result: TestEvent = {
            type: 'test',
            test: id,
            state: 'errored',
            message: 'unknown error'
        };

        try {
            let output = await this.runCommand(command);
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

    public async debug(test_ids: string[]): Promise<void> {
        for (let test_id of test_ids) {
            let test: CatkinTestCase = this.testcases[test_id];
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
