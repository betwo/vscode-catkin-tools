import * as child_process from 'child_process';
import * as vscode from 'vscode';
import {
    IPackage,
    WorkspaceTestInterface,
    WorkspaceTestCase,
    WorkspaceTestExecutable,
    WorkspaceTestSuite,
    WorkspaceTestFixture,
    TestType,
    TestRunResult,
    TestRunReloadRequest,
    TestSuiteInfo,
    TestInfo
} from 'vscode-catkin-tools-api';
import * as fs from 'fs';
import * as path from 'path';
import { Package } from '../package';
import { Workspace } from '../workspace';
import { runShellCommand, runCommand } from '../shell_command';
import { WorkspaceTestParameters, WorkspaceTestRunResult, WorkspaceTestRunResultKind } from './test_parameters';
import { wrapArray } from '../utils';
import * as gtest_problem_matcher from './gtest/gtest_problem_matcher';
import * as compiler_problem_matcher from '../compiler_problem_matcher';
import * as xml from 'fast-xml-parser';
import * as treekill from 'tree-kill';

/**
 * Implementation of the TestAdapter interface for workspace tests.
 */
export class WorkspaceTestAdapter {
    suites: Map<string, WorkspaceTestSuite> = new Map<string, WorkspaceTestSuite>();
    executables: Map<string, WorkspaceTestExecutable> = new Map<string, WorkspaceTestExecutable>();
    testfixtures: Map<string, WorkspaceTestFixture> = new Map<string, WorkspaceTestFixture>();
    testcases: Map<string, WorkspaceTestCase> = new Map<string, WorkspaceTestCase>();

    private cancel_requested: boolean = false;
    private active_process: child_process.ChildProcess;

    private root_test_suite: TestSuiteInfo;

    private diagnostics: vscode.DiagnosticCollection;

    constructor(
        public readonly workspaceRootDirectoryPath: string,
        public test_controller: vscode.TestController,
        public readonly workspace: Workspace,
        private readonly output_channel: vscode.OutputChannel
    ) {
        this.workspace.test_adapter = this;
        this.output_channel.appendLine(`Initializing test adapter for workspace ${workspaceRootDirectoryPath}`);
        this.diagnostics = vscode.languages.createDiagnosticCollection(`catkin_tools`);

        this.test_controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => this.run(request, token, false), true);
        this.test_controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => this.run(request, token, true), false);
    }

    public async load(): Promise<void> {
        if (!this.workspace.isInitialized()) {
            this.output_channel.appendLine('Cannot load tests, workspace is not initialized');
            return;
        }

        this.output_channel.appendLine('Loading tests');
        this.signalReload();

        let build_dir_request = this.workspace.workspace_provider.getBuildDir();
        let devel_dir_request = this.workspace.workspace_provider.getDevelDir();

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Loading test suites",
            cancellable: false
        }, async (progress, token) => {
            progress.report({ increment: 0, message: "Searching tests" });
            try {
                let packages_with_tests = 0;
                for (let [_, workspace_package] of this.workspace.packages) {
                    if (workspace_package.has_tests) {
                        packages_with_tests++;
                    }
                }
                let progress_relative = (100.0 / packages_with_tests);
                let accumulated_progress = 0.0;

                let build_dir = await build_dir_request;
                let devel_dir = await devel_dir_request;

                for (let [_, workspace_package] of this.workspace.packages) {
                    if (!workspace_package.has_tests) {
                        continue;
                    }
                    accumulated_progress += progress_relative;
                    if (accumulated_progress > 1.0) {
                        let integer_progress = Math.floor(accumulated_progress);
                        accumulated_progress -= integer_progress;
                        progress.report({
                            increment: integer_progress,
                            message: `Parsing ${workspace_package.name} for tests`
                        });
                    }

                    workspace_package.package_test_suite = await this.updatePackageTests(workspace_package, true, build_dir, devel_dir);
                }
                this.updateSuiteSet();

                progress.report({ increment: 100, message: `Found ${this.suites.size} test suites` });

            } catch (err) {
                this.output_channel.appendLine(`Error loading tests: ${err}`);
                // this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', errorMessage: err });
            }
        });
    }

    public signalReload() {
        // this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
    }
    public async updateSuiteSet() {
        let test_tree = <TestSuiteInfo>{
            id: "all_tests",
            label: await this.workspace.getName(),
            type: 'suite',
            children: []
        };
        const src_dir = await this.workspace.workspace_provider.getSrcDir();
        for (const [key, value] of this.suites) {
            let info = value.info;
            const workspace_path = await value.package.getWorkspacePath(src_dir);
            let subtree = WorkspaceTestAdapter.getSubtree(test_tree, "", workspace_path.slice(0, workspace_path.length - 1), true);
            subtree.children.push(info);
        }
        this.root_test_suite = test_tree;
        this.test_controller.items.replace([this.convertTestSuite(this.root_test_suite)]);
    }

    private convertTestSuite(info: TestSuiteInfo | TestInfo): vscode.TestItem {
        if ("children" in info) {
            return this.convertTestSuiteInfo(info);
        } else {
            return this.convertTestInfo(info);
        }
    }

    private convertTestSuiteInfo(info: TestSuiteInfo): vscode.TestItem {
        const uri = (info.file !== undefined) ? vscode.Uri.parse(info.file) : undefined;
        let result = this.test_controller.createTestItem(info.id, info.label, uri);
        result.description = info.description;
        if (info.line !== undefined) {
            result.range = new vscode.Range(
                new vscode.Position(info.line, 0),
                new vscode.Position(info.line, 100));
        }
        for (const e of info.children) {
            result.children.add(this.convertTestSuite(e));
        }
        return result;
    }

    private convertTestInfo(info: TestInfo): vscode.TestItem {
        let result = this.test_controller.createTestItem(info.id, info.label, vscode.Uri.parse(info.file));
        result.description = info.description;
        result.range = new vscode.Range(
            new vscode.Position(info.line, 0),
            new vscode.Position(info.line, 100));
        return result;
    }

    private static getSubtree(tree: TestSuiteInfo, prefix: string, key: string[], createIfNonExistent = false) {
        if (key.length === 0) {
            return tree;
        }
        const subdir = `${prefix}${key[0]}`;
        let matching = tree.children.filter((suite) => suite.type === 'suite' && suite.label === key[0]);
        if (matching.length > 0) {
            return WorkspaceTestAdapter.getSubtree(matching[0] as TestSuiteInfo, `${subdir}${path.sep}`, key.slice(1), createIfNonExistent);
        } else if (createIfNonExistent) {
            let layer = <TestSuiteInfo>{
                type: 'suite',
                id: `directory_${subdir}`,
                tooltip: `Subdirectory ${subdir}`,
                label: key[0],
                debuggable: false,
                children: []
            };
            tree.children.push(layer);
            return WorkspaceTestAdapter.getSubtree(layer, `${subdir}${path.sep}`, key.slice(1), createIfNonExistent);
        } else {
            return undefined;
        }
    }

    private getAllTestsOfTree(tree: TestSuiteInfo): WorkspaceTestSuite[] {
        let tests: WorkspaceTestSuite[] = [];
        for (const child of tree.children) {
            if (child.id.startsWith("directory_")) {
                let child_tests = this.getAllTestsOfTree(child as TestSuiteInfo);
                for (const test of child_tests) {
                    tests.push(test);
                }
            } else {
                let child_suite = this.suites.get(child.id);
                tests.push(child_suite);
            }
        }
        return tests;
    }

    public async updatePackageTests(workspace_package: IPackage,
        outline_only: boolean = false,
        build_dir?: String, devel_dir?: String): Promise<WorkspaceTestSuite> {
        if (outline_only && workspace_package.tests_loaded) {
            // no need to reload here
            return this.getTestSuiteForPackage(workspace_package);
        }
        let [suite, _] = await this.loadPackageTests(workspace_package, outline_only, build_dir);
        this.updatePackageTestsWith(suite);

        workspace_package.workspace.onTestsSetChanged.fire(true);

        return suite;
    }
    public async updatePackageTestsWith(suite: WorkspaceTestSuite) {
        if (suite.executables !== null) {
            for (let executable of suite.executables) {
                this.executables.set(executable.info.id, executable);
                for (let fixture of executable.fixtures) {
                    this.testfixtures.set(fixture.info.id, fixture);
                    for (let testcase of fixture.cases) {
                        this.testcases.set(testcase.info.id, testcase);
                    }
                }
            }
        }

        this.suites.set(suite.info.id, suite);
    }

    public async loadPackageTests(workspace_package: IPackage,
        outline_only: boolean = false,
        build_dir?: String, devel_dir?: String):
        Promise<[WorkspaceTestSuite, WorkspaceTestSuite]> {

        if (!workspace_package.has_tests) {
            return;
        }

        if (build_dir === undefined) {
            build_dir = await this.workspace.workspace_provider.getBuildDir();
        }
        if (devel_dir === undefined) {
            devel_dir = await this.workspace.workspace_provider.getDevelDir();
        }

        try {
            let suite = await workspace_package.loadTests(build_dir, devel_dir, outline_only);
            let old_suite = this.suites.get(suite.info.id);

            return [suite, old_suite];
        } catch (error) {
            console.error(`Error loading tests of package ${workspace_package.name}: ${error}`);
        }
    }

    public async run(request: vscode.TestRunRequest, token: vscode.CancellationToken, debug: boolean): Promise<void> {
        this.diagnostics.clear();
        let test_run = this.test_controller.createTestRun(request);

        if (debug) {
            this.debug(request, token, test_run);
        } else {
            this.runWithProgress(request, token, test_run);
        }
    }

    public async runWithProgress(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken,
        test_run: vscode.TestRun
    ): Promise<void> {
        this.cancel_requested = false;
        token.onCancellationRequested(() => {
            this.cancel_requested = true;
        });
        this.output_channel.appendLine(`Running test(s): ${request.include.join(', ')}`);

        let result = new TestRunResult(true);
        try {
            for (let item of request.include) {
                const id = item.id;
                let intermediate_result: TestRunResult;
                if (id.startsWith("package_") || id.startsWith("exec_") || id.startsWith("fixture_") || id === "all_tests") {
                    intermediate_result = await this.runTestSuite(id, test_run, token);
                } else if (id.startsWith("directory")) {
                    intermediate_result = await this.runTestSuite(id, test_run, token);
                } else if (id.startsWith("test_")) {
                    intermediate_result = await this.runTest(id, test_run, token);
                }
                result.merge(intermediate_result);
            }
        } catch (err) {
            this.output_channel.appendLine(`Run failed: ${err}`);
            console.error(`Run failed: ${err}`);
        }

        test_run.end();

        if (result.reload_packages.length > 0) {
            for (let request of result.reload_packages) {
                console.debug(`Requested to reload ${request.test.info.id}`);
                let change_suite = await this.reloadPackageIfChanged(request.test.package);
                if (change_suite !== undefined) {
                    console.debug(`Changed suite: ${change_suite.info.id}`);
                    result.repeat_tests.push(this.getTestItem(change_suite.info.id));
                }
            }
        }

        if (result.repeat_tests.length > 0) {
            const request = new vscode.TestRunRequest(result.repeat_tests);
            this.run(request, token, false);
        }
    }

    public async runTest(id: string,
        test_run: vscode.TestRun,
        token?: vscode.CancellationToken): Promise<TestRunResult> {
        this.output_channel.appendLine(`Running test for package ${id}`);

        try {
            return await this.runTestCommand(id, test_run, token);
        } catch (err) {
            let item = this.getTestItem(id);
            if (test_run !== undefined) {
                test_run.failed(item, err);
            } else {
                console.error("Running test failed!!!");
                console.error(err);
            }
            return new TestRunResult(false);
        }
    }

    private async runTestSuite(id: string,
        test_run: vscode.TestRun,
        token: vscode.CancellationToken): Promise<TestRunResult> {
        this.output_channel.appendLine(`Running test suite ${id}`);

        let tests: (WorkspaceTestExecutable | WorkspaceTestSuite | WorkspaceTestFixture)[] = [];
        if (id.startsWith("package_")) {
            let suite: WorkspaceTestSuite = this.suites.get(id);
            tests.push(suite);

        } else if (id.startsWith("exec_")) {
            let exe = this.executables.get(id);
            tests.push(exe);

        } else if (id.startsWith("fixture_")) {
            let fixture = this.testfixtures.get(id);
            tests.push(fixture);

        } else if (id.startsWith("directory_")) {
            const subdir = id.slice("directory_".length).split(path.sep);
            const st = WorkspaceTestAdapter.getSubtree(this.root_test_suite, "", subdir);
            for (const child of this.getAllTestsOfTree(st)) {
                tests.push(child);
            }

        } else if (id === "all_tests") {
            this.suites.forEach((suite, key) => {
                tests.push(suite);
            });
        }

        if (tests.length === 0) {
            this.output_channel.appendLine(`No test found with id ${id}`);
            test_run.errored(this.getTestItem(id), new vscode.TestMessage(`No test found with id ${id}`));
            return;
        }

        let result = new TestRunResult(true);
        for (let test of tests) {
            if (this.cancel_requested) {
                test_run.skipped(this.getTestItem(test.info.id));
            } else {
                let intermediate_result = await this.runTest(test.info.id, test_run, token);
                result.merge(intermediate_result);
            }
        }
        return result;
    }

    private async makeBuildTestCommand(test: WorkspaceTestInterface) {
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
            command += `{ make -q ${test.build_target} ; [ "$?" = "1" ] && env GCC_COLORS= make -j $(nproc) ${test.build_target}; } `;
        } else {
            command += `env GCC_COLORS= make -j $(nproc) ${test.build_target}`;
        }
        return this.workspace.makeCommand(command);
    }

    private async prepareGTestOutputFile(test: WorkspaceTestInterface, commands: WorkspaceTestParameters) {
        let output_file = await this.overwriteGTestOutputFile(test, commands);

        if (fs.existsSync(output_file)) {
            fs.unlinkSync(output_file);
        }

        return output_file;
    }

    private async overwriteGTestOutputFile(test: WorkspaceTestInterface, commands: WorkspaceTestParameters) {
        if (test.type === 'gtest') {
            const gtest_xml = /.*--gtest_output=.*/;
            commands.args = commands.args.filter((value, index) => {
                return value.match(gtest_xml) === null;
            });

            const output_file = `/tmp/gtest_output_${test.info.id}.xml`;
            commands.args.push(`--gtest_output=xml:${output_file}`);
            return output_file;
        } else {
            throw Error(`Cannot parse ${commands} for output file`);
        }
    }

    private async runCommands(
        commands: WorkspaceTestParameters,
        token: vscode.CancellationToken,
        cwd: fs.PathLike): Promise<WorkspaceTestRunResult> {
        let result = new WorkspaceTestRunResult(WorkspaceTestRunResultKind.BuildFailed);

        this.output_channel.appendLine(`command: ${commands.exe} ${commands.args.join(" ")}`);

        try {
            let build_output = await this.runShellCommand(commands.setup_shell_code, token, cwd);
            this.output_channel.appendLine(`${build_output.stdout}`);
            this.output_channel.appendLine(`${build_output.stderr}`);

        } catch (error_output) {
            this.output_channel.appendLine("ERROR: stdout:");
            this.output_channel.appendLine(`${error_output.stdout}`);
            this.output_channel.appendLine("stderr:");
            this.output_channel.appendLine(`${error_output.stderr}`);

            compiler_problem_matcher.analyze(this.workspace, error_output.stderr, this.diagnostics);

            result.state = WorkspaceTestRunResultKind.BuildFailed;
            result.message.message += error_output.stdout + '\n' + error_output.stderr + '\n';

            return result;
        }

        if (commands.exe !== undefined) {
            try {
                let test_output = await this.runExecutableCommand([commands.exe, commands.args], token, cwd);
                this.output_channel.appendLine(`${test_output.stdout}`);
                this.output_channel.appendLine(`${test_output.stderr}`);
                result.state = WorkspaceTestRunResultKind.TestSucceeded;

            } catch (error_output) {
                this.output_channel.appendLine("ERROR: stdout:");
                this.output_channel.appendLine(`${error_output.stdout}`);
                this.output_channel.appendLine("stderr:");
                this.output_channel.appendLine(`${error_output.stderr}`);

                result.state = WorkspaceTestRunResultKind.TestFailed;
                result.message.message += error_output.stdout + '\n' + error_output.stderr + '\n';
                if (error_output.error !== undefined) {
                    result.message.message = `Error: ${error_output.error.message}\n\n` + result.message.message;
                }
                result.error = error_output.error;

                return result;
            }
        } else {
            result.state = WorkspaceTestRunResultKind.TestSucceeded;
        }

        return result;
    }

    private async runExecutableCommand([exe, args]: [fs.PathLike, string[]],
        token: vscode.CancellationToken,
        cwd: fs.PathLike) {

        let environment = await this.getRuntimeEnvironment();

        let output_promise = runCommand(exe.toString(), args, environment, cwd, [], (process) => {
            this.active_process = process;

            if (token !== undefined) {
                token.onCancellationRequested(() => {
                    treekill(this.active_process.pid);
                });
            }
        });
        const output = await output_promise;
        this.active_process = undefined;
        return output;
    }

    private async runShellCommand(command: string,
        token: vscode.CancellationToken,
        cwd: fs.PathLike) {

        let output_promise = runShellCommand(command, cwd, (process) => {
            this.active_process = process;

            if (token !== undefined) {
                token.onCancellationRequested(() => {
                    treekill(this.active_process.pid);
                });
            }
        });
        const output = await output_promise;
        this.active_process = undefined;
        return output;
    }

    private async runTestCommand(id: string,
        test_run: vscode.TestRun,
        token?: vscode.CancellationToken): Promise<TestRunResult> {

        this.output_channel.appendLine(`running test command for ${id}`);

        let commands: WorkspaceTestParameters;
        let test: WorkspaceTestInterface | WorkspaceTestExecutable;

        if (id.startsWith("fixture_unknown_")) {
            // Run an unknown executable's tests
            let exe = this.getExecutableForTestFixture(id);
            this.output_channel.appendLine(`Id ${id} maps to executable ${exe.executable} in package ${exe.package.name}`);
            commands = new WorkspaceTestParameters(await this.makeBuildTestCommand(exe), exe.executable);
            test = exe;

        } else if (id.startsWith('test_')) {
            // single test case
            let testcase = this.testcases.get(id);
            this.output_channel.appendLine(`Id ${id} maps to test in package ${testcase.package.name}`);
            commands = new WorkspaceTestParameters(await this.makeBuildTestCommand(testcase), testcase.executable);
            if (testcase.filter !== undefined) {
                commands.args = [`--gtest_filter=${this.escapeFilter(testcase.filter)}`];
            }
            test = testcase;

        } else if (id.startsWith('fixture_')) {
            // test fixture
            let testfixture = this.testfixtures.get(id);
            this.output_channel.appendLine(`Id ${id} maps to test fixture in package ${testfixture.package.name}`);
            commands = new WorkspaceTestParameters(await this.makeBuildTestCommand(testfixture), testfixture.executable);
            if (testfixture.filter !== undefined) {
                commands.args = [`--gtest_filter=${this.escapeFilter(testfixture.filter)}`];
            }
            test = testfixture;

        } else if (id.startsWith('exec_')) {
            // full unit test run
            let exe = this.executables.get(id);
            this.output_channel.appendLine(`Id ${id} maps to executable ${exe.executable} in package ${exe.package.name}`);
            commands = new WorkspaceTestParameters(await this.makeBuildTestCommand(exe), exe.executable);
            test = exe;

        } else if (id.startsWith('package_')) {
            // full package test run
            let suite: WorkspaceTestSuite = this.suites.get(id);
            this.output_channel.appendLine(`Id ${id} maps to package ${suite.package.name}`);
            commands = new WorkspaceTestParameters(await this.makeBuildTestCommand(suite), undefined);
            test = suite;

        } else {
            throw Error(`Cannot handle test with id ${id}`);
        }

        let output_file: string;
        if (test.type === 'gtest') {
            output_file = await this.prepareGTestOutputFile(test, commands);
        }

        // run the test
        let test_result: WorkspaceTestRunResult = await this.runCommands(commands, token, '/tmp');

        if (test.type === 'gtest') {
            return await this.analyzeGtestResult(test_run, test, output_file, test_result.message.message.toString());

        } else if (test.type === 'suite') {
            let suite: WorkspaceTestSuite = this.suites.get(id);
            if (suite.executables === null) {
                if (test_result.state === WorkspaceTestRunResultKind.BuildFailed) {
                    test_run.errored(this.getTestItem(id), test_result.message);

                } else {
                    console.debug("Requested to run an empty suite, building and then retrying");
                    return <TestRunResult>{
                        reload_packages: [<TestRunReloadRequest>{
                            test: suite
                        }],
                        repeat_tests: []
                    };

                }
            } else {
                // run the individual executables of the suite
                return <TestRunResult>{
                    reload_packages: [<TestRunReloadRequest>{
                        test: suite
                    }],
                    repeat_tests: suite.executables.map((exe) => this.getTestItem(exe.info.id))
                };
            }
        } else {
            let tests = this.getTestCases(id);
            if (tests.length === 0) {
                if (id.startsWith("fixture_unknown_")) {
                    let exe = this.getExecutableForTestFixture(id);
                    exe.fixtures.forEach((test) => {
                        test_result.updateTestRunSuite(this.getTestItem(id), test_run);
                    });
                } else {
                    let exe = this.getTestForExecutable(test.executable.toString());
                    exe.fixtures.forEach((test) => {
                        test_result.updateTestRunSuite(this.getTestItem(id), test_run);
                    });
                }
            } else {
                tests.forEach((test) => {
                    if (test.info.id.startsWith('test_')) {
                        test_result.updateTestRunTest(this.getTestItem(id), test_run);
                    } else {
                        let exe = this.getTestForExecutable(test.executable.toString());
                        exe.fixtures.forEach((test) => {
                            test_result.updateTestRunTest(this.getTestItem(id), test_run);
                        });
                    }
                });
            }

            if (test.type === 'unknown') {
                test.type = await this.determineTestType(test);

                if (test.type !== 'generic') {
                    return new TestRunResult(
                        false,
                        [this.getTestItem(id)],
                        []
                    );
                }
            }
        }

        return new TestRunResult(false);
    }

    private async determineTestType(test: WorkspaceTestInterface): Promise<TestType> {
        try {
            let exe = test.executable.toString().split(new RegExp("\\s"))[0];
            let ws_command = await this.workspace.makeCommand(`${exe} --help`);
            let output = await runShellCommand(ws_command, test.build_space.toString());
            let needle = "This program contains tests written using Google Test";
            if (output.stdout.indexOf(needle) >= 0) {
                return "gtest";
            } else {
                return "generic";
            }
        } catch (_) {
            return "generic";
        }
    }

    private getTestItem(id: string): vscode.TestItem {
        return this.getTestItemFromCollection(id, this.test_controller.items);
    }

    private getTestItemFromCollection(id: string, suite: vscode.TestItemCollection): vscode.TestItem {
        let item = suite.get(id);
        if (item !== undefined) {
            return item;
        }
        suite.forEach(i => {
            let r = this.getTestItemChild(id, i);
            if (r !== undefined) {
                item = r;
            }
        });

        return item;
    }
    private getTestItemChild(id: string, item: vscode.TestItem): vscode.TestItem {
        if (item.id === id) {
            return item;
        } else if (item.children.size > 0) {
            return this.getTestItemFromCollection(id, item.children);
        }
    }

    private getTestCases(id: string): WorkspaceTestCase[] {
        let tests: WorkspaceTestCase[] = [];

        if (id.startsWith('test_')) {
            // single test case 
            let testcase = this.testcases.get(id);
            tests.push(testcase);

        } else if (id.startsWith('fixture_')) {
            // full unit test run
            let fixture = this.testfixtures.get(id);
            tests = fixture.cases;

        } else if (id.startsWith('exec_')) {
            // full unit test run
            let exe = this.executables.get(id);
            for (let fixture of exe.fixtures) {
                tests = tests.concat(fixture.cases);
            }

        } else if (id.startsWith('package_')) {
            // full package test run
            let suite = this.suites.get(id);

            if (suite.executables !== null) {
                suite.executables.forEach((exe) => {
                    for (let fixture of exe.fixtures) {
                        tests = tests.concat(fixture.cases);
                    }
                });
            }

        } else {
            throw Error(`Cannot handle test with id ${id}`);
        }

        return tests;
    }

    private async analyzeGtestResult(test_run: vscode.TestRun,
        test: WorkspaceTestInterface,
        output_file: string,
        test_output: string)
        : Promise<TestRunResult> {
        let tests: WorkspaceTestCase[] = this.getTestCases(test.info.id);
        let dom = undefined;
        let reload_packages = [];
        let all_succeeded = true;
        try {
            let options = {
                ignoreAttributes: false,
                attrNodeName: "attr"
            };
            const content_raw = await fs.promises.readFile(output_file);
            dom = xml.parse(content_raw.toString(), options);

            // send the result for all matching ids
            if (!this.sendGtestResultForTest(test_run, test, dom, test_output)) {
                all_succeeded = false;
            }
            tests.forEach((sub_test) => {
                if (!this.sendGtestResultForTest(test_run, sub_test, dom, test_output)) {
                    all_succeeded = false;
                }
            });

            if (test.info.id.startsWith("package_")) {
                reload_packages.push({
                    test: test as WorkspaceTestSuite,
                    dom: dom,
                    output: test_output
                });

            } else if (test.info.id.startsWith("exec_")) {
                let suite = this.getTestSuiteForExcutable(test.info.id);
                let contained = reload_packages.reduce((result, pkg) => {
                    if (pkg.test.info.id === suite.info.id) {
                        return true;
                    }
                    return result;
                }, false);
                if (!contained) {
                    reload_packages.push({
                        test: suite,
                        dom: dom,
                        output: test_output
                    });
                }
            } else {
                let executable = (test.info.id.startsWith("fixture_")) ? this.getExecutableForTestFixture(test.info.id) : this.getExecutableForTestCase(test.info.id);
                let suite = this.getTestSuiteForExcutable(executable.info.id);
                reload_packages.push({
                    test: suite,
                    dom: dom,
                    output: test_output
                });
            }

        } catch (error) {
            test_output += `\n(Cannot read the test results results from ${output_file})`;
            test_run.errored(this.getTestItem(test.info.id), new vscode.TestMessage(test_output));
            all_succeeded = false;
        }

        return new TestRunResult(all_succeeded, undefined, reload_packages);
    }

    public async reloadPackageIfChanged(workspace_package: IPackage): Promise<WorkspaceTestSuite | undefined> {
        // check if a test suite was changed
        // this can happen, if a test executable was not compiled before the run,
        // or if the user changes the test itself between runs
        let [pkg_suite, old_suite] = await this.loadPackageTests(workspace_package, false);
        if (!this.isSuiteEquivalent(old_suite, pkg_suite)) {
            // update the list of tests
            this.updatePackageTestsWith(pkg_suite);
            this.updateSuiteSet();
            return pkg_suite;

        } else {
            this.updateSuiteSet();
            return undefined;
        }
    }

    private getTestForExecutable(exe_path: string): WorkspaceTestExecutable {
        for (let [id, exe] of this.executables.entries()) {
            if (exe.executable.toString().indexOf(exe_path) >= 0) {
                return exe;
            }
        }
        return undefined;
    }

    private getTestSuiteForPackage(pkg: IPackage): WorkspaceTestSuite {
        for (let [suite_id, suite] of this.suites.entries()) {
            if (suite.package === pkg) {
                return suite;
            }
        }
        return undefined;
    }

    private getTestSuiteForExcutable(id: string): WorkspaceTestSuite {
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

    private getExecutableForTestFixture(id: string): WorkspaceTestExecutable {
        for (let [suite_id, suite] of this.suites.entries()) {
            if (suite.executables !== null) {
                for (let executable of suite.executables) {
                    for (let fiture of executable.fixtures) {
                        if (fiture.info.id === id) {
                            return executable;
                        }
                    }
                }
            }
        }
        return undefined;
    }

    private getExecutableForTestCase(id: string): WorkspaceTestExecutable {
        for (let [suite_id, suite] of this.suites.entries()) {
            if (suite.executables !== null) {
                for (let executable of suite.executables) {
                    for (let fixture of executable.fixtures) {
                        for (let testcase of fixture.cases) {
                            if (testcase.info.id === id) {
                                return executable;
                            }
                        }
                    }
                }
            }
        }
        return undefined;
    }

    private sendGtestResultForTest(
        test_run: vscode.TestRun,
        test: WorkspaceTestInterface,
        dom,
        message: string)
        : boolean {
        let all_succeeded = true;

        gtest_problem_matcher.analyze(dom, this.diagnostics);

        if (test.filter === undefined || test.filter.endsWith('*')) {
            // this is the whole test executable
            let node_suites = dom['testsuites'];
            if (node_suites.attr['@_failures'] > 0 || node_suites.attr['@_errors'] > 0) {
                test_run.failed(this.getTestItem(test.info.id), new vscode.TestMessage(message));
                all_succeeded = false;
            } else {
                test_run.passed(this.getTestItem(test.info.id));
            }

        } else {
            // this is one single test case
            let node_suites = wrapArray(dom['testsuites']['testsuite']);
            let test_fixture = test.filter === undefined ? '*' : this.htmlEncode(test.filter.substr(0, test.filter.lastIndexOf('.')));
            let test_case_id = test.filter === undefined ? null : this.htmlEncode(test.filter.substr(test.filter.lastIndexOf('.') + 1));
            for (let node of node_suites) {
                if (node.attr['@_name'] === test_fixture) {
                    if (test_case_id !== null) {
                        let testcases = wrapArray(node['testcase']);
                        for (let test_case of testcases) {
                            if (test_case.attr['@_name'] === test_case_id) {
                                let failure = test_case['failure'];
                                if (failure !== undefined) {
                                    test_run.failed(this.getTestItem(test.info.id), new vscode.TestMessage(failure['#text']));
                                    all_succeeded = false;
                                } else {
                                    test_run.passed(this.getTestItem(test.info.id));
                                }
                                break;
                            }
                        }
                    } else {
                        if (node.attr['@_failures'] > 0 || node.attr['@_errors'] > 0) {
                            test_run.failed(this.getTestItem(test.info.id), new vscode.TestMessage("unknown error"));
                            all_succeeded = false;
                        } else {
                            test_run.passed(this.getTestItem(test.info.id));
                        }
                    }
                    break;
                }
            }
        }
        return all_succeeded;
    }

    private htmlEncode(s) {
        return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;');
    }

    private isSuiteEquivalent(a: WorkspaceTestSuite, b: WorkspaceTestSuite): boolean {
        if (a === undefined || b === undefined) {
            return false;
        }
        if (a.executables === null && b.executables === null) {
            return true;
        } else if (a.executables === null || b.executables === null) {
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
    private isExecutableEquivalent(a: WorkspaceTestExecutable, b: WorkspaceTestExecutable): boolean {
        if (a.fixtures.length !== b.fixtures.length) {
            return false;
        }
        for (let i = 0; i < a.fixtures.length; ++i) {
            let fixture_a = a.fixtures[i];
            let fixture_b = b.fixtures[i];
            if (fixture_a.cases.length !== fixture_b.cases.length) {
                return false;
            }
            for (let j = 0; j < fixture_a.cases.length; ++j) {
                let case_a = fixture_a.cases[j];
                let case_b = fixture_b.cases[j];
                if (!this.isTestCaseEquivalent(case_a, case_b)) {
                    return false;
                }
            }
        }
        return true;
    }
    private isTestCaseEquivalent(a: WorkspaceTestCase, b: WorkspaceTestCase): boolean {
        return a.filter === b.filter;
    }

    public async debug(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken,
        test_run: vscode.TestRun
    ): Promise<void> {
        if (request.include.length > 1) {
            vscode.window.showWarningMessage("Debugging more than one test case is not yet supported.");
        }
        if (request.include.length > 0) {
            const test_item = request.include[0];
            const test_id = test_item.id;
            let test: WorkspaceTestFixture | WorkspaceTestCase | WorkspaceTestExecutable;
            if (test_id.startsWith("exec_")) {
                test = this.executables.get(test_id);
            } else if (test_id.startsWith("fixture_")) {
                test = this.testfixtures.get(test_id);
            } else {
                test = this.testcases.get(test_id);
            }

            // build the test
            let command = await this.makeBuildTestCommand(test);
            try {
                runShellCommand(command, await this.workspace.getRootPath());
            } catch (error) {
                console.error(error.stderr);
                throw Error(`Cannot rebuild test executable: ${error.stderr}`);
            }

            if (vscode.debug.activeDebugSession !== undefined) {
                vscode.window.showErrorMessage("Cannot start debugger, another session is opened.");

            } else {
                // start the debugging session
                let parts: string[] = test.executable.toString().split(/\s/gi);
                let cmd: string = parts[0];
                parts.shift();
                let args: string[] = parts;

                let environment_variables = [];
                for (const [k, v] of await this.getRuntimeEnvironment()) {
                    environment_variables.push({
                        name: k,
                        value: v
                    });
                }

                let config: vscode.DebugConfiguration = {
                    type: 'cppdbg',
                    name: cmd,
                    request: 'launch',
                    environment: environment_variables,
                    MIMode: 'gdb',
                    stopAtEntry: true,
                    setupCommands: [
                        {
                            "description": "Enable pretty-printing for gdb",
                            "text": "-enable-pretty-printing",
                            "ignoreFailures": true
                        }
                    ],
                    cwd: this.workspaceRootDirectoryPath,
                    program: cmd,
                    args: args.concat(['--gtest_break_on_failure', `--gtest_filter="${this.escapeFilter(test.filter)}"`])
                };
                await vscode.debug.startDebugging(undefined, config);
            }
        }
    }

    private escapeFilter(filter: String) {
        if (filter.indexOf("::") > 0) {
            // gtest replaces '::' with something else internally because '::' is used as the separator
            return filter.replace(/::/gi, "*");
        } else {
            return filter;
        }
    }

    private async getRuntimeEnvironment(): Promise<[string, string][]> {
        let environment: [string, string][] = [];
        let env_command = await this.workspace.makeCommand(`env`);
        try {
            let env_output = await runShellCommand(env_command, await this.workspace.getRootPath());
            environment = env_output.stdout.split("\n").filter((v) => v.indexOf("=") > 0).map((env_entry) => {
                let [name, value] = env_entry.split("=");
                return [name, value];
            });
        } catch (error) {
            console.error(error.stderr);
            throw Error(`Cannot determine environment: ${error.stderr}`);
        }

        return environment;
    }

    public cancel(): void {
        this.cancel_requested = true;
        if (this.active_process !== undefined) {
            treekill(this.active_process.pid);
        }
    }

    public dispose(): void {
        this.cancel();
    }
}
