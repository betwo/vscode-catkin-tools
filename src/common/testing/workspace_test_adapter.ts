import * as child_process from 'child_process';
import * as vscode from 'vscode';
import {
    IPackage,
    WorkspaceTestInterface,
    WorkspaceTestReport,
    WorkspaceTestInstance,
    WorkspaceTestParameters,
    WorkspaceTestHandler,
    WorkspaceTestIdentifierTemplate
} from 'vscode-catkin-tools-api';
import * as fs from 'fs';
import { Workspace } from '../workspace';
import { TestHandlerCollection } from "./test_handler_collection";
import { TestHandlerComposite } from "./test_handler_composite";
import * as treekill from 'tree-kill';
import { InternalAPI } from '../../internal_api';
import { logger } from '../logging';

export class NullCancellationToken implements vscode.CancellationToken {
    isCancellationRequested = false;
    onCancellationRequestedEmitter = new vscode.EventEmitter<boolean>();
    onCancellationRequested = this.onCancellationRequestedEmitter.event;
}

/**
 * Implementation of the TestAdapter interface for workspace tests.
 */
export class WorkspaceTestAdapter {
    item_to_test: Map<vscode.TestItem, WorkspaceTestInstance> = new Map<vscode.TestItem, WorkspaceTestInstance>();
    id_to_item: Map<string, vscode.TestItem> = new Map<string, vscode.TestItem>();
    id_to_test: Map<string, WorkspaceTestInstance> = new Map<string, WorkspaceTestInstance>();

    public item_to_test_runner = new Map<vscode.TestItem, WorkspaceTestHandler>();

    public workspace_test_interface: WorkspaceTestInterface;
    public workspace_test_item: vscode.TestItem;
    public workspace_test_handler: TestHandlerCollection;

    private cancel_requested: boolean = false;
    private active_process: child_process.ChildProcess;

    private diagnostics: vscode.DiagnosticCollection;

    constructor(
        public readonly workspaceRootDirectoryPath: string,
        public test_controller: vscode.TestController,
        public readonly workspace: Workspace,
        private readonly output_channel: vscode.OutputChannel,
        private api: InternalAPI
    ) {
        this.workspace.test_adapter = this;
        this.output_channel.appendLine(`Initializing test adapter for workspace ${workspaceRootDirectoryPath}`);
        this.diagnostics = vscode.languages.createDiagnosticCollection(`catkin_tools`);

        this.test_controller.resolveHandler = (item: vscode.TestItem) => this.resolveItem(item);

        this.test_controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => this.run(request, token, false), true);
        this.test_controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => this.run(request, token, true), false);
    }

    public getTestForItem(test_item: vscode.TestItem): WorkspaceTestInterface {
        for (const [entry, test] of this.item_to_test) {
            if (entry.id === test_item.id) {
                return test.test;
            }
        }
        return undefined;
    }


    public getTestHandlerForItem(test_item: vscode.TestItem): WorkspaceTestHandler {
        for (const [entry, test] of this.item_to_test_runner) {
            if (entry.id === test_item.id) {
                return test;
            }
        }
        return undefined;
    }

    public getTestInstances(test_ifc: WorkspaceTestInterface): WorkspaceTestInstance[] {
        const instances = [];
        for (const [entry, test] of this.item_to_test_runner) {
            if (test.test() === test_ifc) {
                instances.push(test.instance());
            }
        }
        return instances;
    }


    public hasTestItem(test_item: vscode.TestItem) {
        for (const [entry, _] of this.item_to_test_runner) {
            if (entry.id === test_item.id) {
                return true;
            }
        }
        return false;
    }

    public getEquivalentTestItem(query: vscode.TestItem) {
        for (const [test_item, _] of this.item_to_test_runner) {
            if (test_item.id === query.id) {
                return test_item;
            }
        }
        return undefined;
    }

    item_being_built: vscode.TestItem;
    item_build_queue: vscode.TestItem[] = [];

    public async buildTestItem(test_item: vscode.TestItem): Promise<boolean> {
        for (const enqueued of this.item_build_queue) {
            if (enqueued.id === test_item.id) {
                // already in queue
                return;
            }
        }
        if (this.item_being_built !== undefined && this.item_being_built.id === test_item.id) {
            // same item is currently being built
            return;
        }

        // push in queue
        // test_item.error = undefined;
        // test_item.busy = true;
        this.item_build_queue.push(test_item);

        if (this.item_being_built !== undefined) {
            // another item is currently being built, do nothing more
            return;
        }


        while (this.item_build_queue.length > 0) {
            // pop the first queued build target
            const front = this.item_build_queue.shift();
            this.item_being_built = front;
            // front.busy = true;

            let request = new vscode.TestRunRequest([front]);
            let test_run = this.test_controller.createTestRun(request);
            test_run.started(front);

            let handler = this.getTestHandlerForItem(front);
            const root_dir = await this.workspace.getRootPath();
            try {
                await handler.compile(test_run, undefined, this.diagnostics, root_dir);
                front.error = undefined;

            } catch (error) {
                logger.error("Failed to build test item:");
                logger.error(error);
                test_run.errored(front, new vscode.TestMessage(`${error}`));
            }
            // front.busy = false;

            this.reloadTestItem(this.item_being_built);
            this.item_being_built = undefined;

            test_run.end();
        }



        return true;
    }

    getPackagesForTestItem(front: vscode.TestItem): IPackage[] {
        const handler = this.getTestHandlerForItem(front);
        let packages: IPackage[] = [];
        handler.enumeratePackages(packages);
        return packages;
    }

    public async reloadTestItem(test_item: vscode.TestItem): Promise<boolean> {
        const handler = this.getTestHandlerForItem(test_item);
        await handler.reload();
        return true;
    }

    public async load(): Promise<void> {
        if (!this.workspace.isInitialized()) {
            this.output_channel.appendLine('Cannot load tests, workspace is not initialized');
            return;
        }

        this.output_channel.appendLine('Loading tests');

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

                    await this.updatePackageTests(workspace_package, true, build_dir, devel_dir);
                }

                progress.report({ increment: 100, message: `Found ${this.item_to_test_runner.size} test suites` });

            } catch (err) {
                this.output_channel.appendLine(`Error loading tests: ${err}`);
            }
        });
    }

    public async resolveItem(item: vscode.TestItem): Promise<void> {
        if (item === undefined) {
            logger.silly("Discover all!");
        } else {
            item.busy = true;

            const test = this.getTestInstance(item.id);
            if (test === undefined) {
                item.error = "Cannot resolve item, test not found";
                item.busy = false;
                return;
            }

            let pkg = test.test.package;
            const build_dir = await this.workspace.getBuildDir();
            if (!pkg.isBuilt(build_dir.toString())) {
                item.error = "This package has not been built, cannot show tests";
                item.busy = false;
                return;
            }
            await this.updatePackageTests(pkg, false);

            item.error = undefined;
            item.busy = false;
        }
    }

    public async updatePackageTests(workspace_package: IPackage,
        outline_only: boolean = false,
        build_dir?: fs.PathLike, devel_dir?: fs.PathLike): Promise<void> {
        await this.loadPackageTests(workspace_package, outline_only, build_dir, devel_dir);
    }

    public async loadPackageTests(workspace_package: IPackage,
        outline_only: boolean = false,
        build_dir?: fs.PathLike, devel_dir?: fs.PathLike
    ): Promise<void> {
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
            if (this.workspace_test_interface === undefined) {
                const root_test_id = await this.workspace.getName();
                this.workspace_test_interface = {
                    type: 'suite',
                    id: new WorkspaceTestIdentifierTemplate(`workspace`),
                    is_parameterized: false,
                    file: undefined,
                    line: 0,
                    children: [],
                };
                this.workspace_test_item = this.test_controller.createTestItem(root_test_id, await this.workspace.getName());
                let workspace_test_instance: WorkspaceTestInstance = {
                    test: this.workspace_test_interface,
                    item: this.workspace_test_item,
                    parameters: undefined,
                    handler: undefined
                };
                this.workspace_test_handler = new TestHandlerCollection(workspace_test_instance, []);
                this.test_controller.items.add(this.workspace_test_item);

                this.registerTestHandler(undefined, this.workspace_test_handler, workspace_test_instance);
                workspace_package.workspace.onTestsSetChanged.fire(true);
            }

            const changed_tests = await workspace_package.loadTests(build_dir, devel_dir, !outline_only);

            for (let changed_test of changed_tests) {
                for (let [item, handler] of this.item_to_test_runner) {
                    if (handler.test() === changed_test) {
                        await handler.reload();
                    }
                }
            }

        } catch (error) {
            logger.error(`Error loading tests of package ${workspace_package.name}:`, error);
        }
    }

    public createLabel(test: WorkspaceTestInterface, parameters: WorkspaceTestParameters): string {
        // return test.id.evaluate(parameters);
        if (test.id.prefix.startsWith("test_")) {
            if (test.is_parameterized) {
                let label: string;
                if (parameters.instance !== undefined) {
                    label = "*" + parameters.instance;
                } else {
                    label = "*" + test.id.test;
                }
                if (parameters.generator !== undefined) {
                    return `${label} / ${parameters.generator}`;
                } else {
                    return label;
                }
            } else {
                return test.id.test;
            }
        } else if (test.id.prefix.startsWith("fixture_")) {
            if (test.is_parameterized) {
                let label: string;
                if (parameters.fixture?.instance !== undefined) {
                    label = "*" + parameters.fixture?.instance;
                } else {
                    label = "*" + test.id.fixture;
                }
                if (parameters.fixture?.generator !== undefined) {
                    return `${label} / ${parameters.fixture?.generator}`;
                } else {
                    return label;
                }
            } else {
                return test.id.fixture;
            }
        } else if (test.id.prefix.startsWith("exec_")) {
            return test.id.prefix.substring(5);
        } else if (test.id.prefix.startsWith("package_")) {
            return test.package.getName();
        } else {
            return test.id.evaluate(parameters);
        }
    }

    public createTestInstance(test_interface: WorkspaceTestInterface, parameters: WorkspaceTestParameters)
        : WorkspaceTestInstance {

        if (test_interface.file === undefined) {
            logger.silly("Tried to add a test item without a file");
        }
        const uri = (test_interface.file !== undefined) ? vscode.Uri.parse(test_interface.file) : undefined;

        let test_item = this.test_controller.createTestItem(test_interface.id.evaluate(parameters), this.createLabel(test_interface, parameters), uri);

        if (test_interface.id.prefix.startsWith("test_")) {
            test_item.description = parameters.description;
        } else if (test_interface.id.prefix.startsWith("fixture_")) {
            test_item.description = parameters.fixture?.description;
        }

        if (test_interface.line !== undefined) {
            test_item.range = new vscode.Range(
                new vscode.Position(test_interface.line, 0),
                new vscode.Position(test_interface.line, 100));
        }
        test_item.canResolveChildren = test_interface.resolvable;

        let test_instance: WorkspaceTestInstance = {
            test: test_interface,
            parameters: parameters,
            item: test_item,
        };
        return test_instance;
    }

    public registerTestHandler(
        parent: WorkspaceTestHandler,
        handler: WorkspaceTestHandler,
        test: WorkspaceTestInstance
    ): void {
        logger.info(`Register test with id ${test.item.id}`);
        if (parent !== undefined) {
            logger.silly(`ADD CHILD ${test.item.id}`);
            parent.addChild(handler);
            logger.silly(parent.test().id.evaluate({}), parent.test().children.length);
        }
        this.item_to_test_runner.set(test.item, handler);
        this.item_to_test.set(test.item, test);
        this.id_to_item.set(test.test.id.evaluate(test.parameters), test.item);
        this.id_to_test.set(test.test.id.evaluate(test.parameters), test);
    }

    public async getTestCollectionForSubdirectory(path: fs.PathLike): Promise<TestHandlerCollection> {
        const segments = path.toString().split("/");
        // remove the lowest level, we want the collection where path is inside, not create a new one with the same name
        segments.pop();

        let parent_item: vscode.TestItem = this.workspace_test_item;
        let parent_handler = this.workspace_test_handler;

        while (segments.length > 0) {
            const next_label = segments.shift();
            let next_segment_item: vscode.TestItem;
            let next_segment_handler: TestHandlerCollection;
            parent_item.children.forEach(entry => {
                if (entry.label === next_label) {
                    next_segment_item = entry;
                    next_segment_handler = parent_handler.getChildHandler(entry);
                }
            });
            if (next_segment_item === undefined) {
                const accumulated_id = `hierarchy_${parent_item.label}_${next_label}`;
                next_segment_item = this.test_controller.createTestItem(accumulated_id, next_label);
                next_segment_item.description = "📁";
                parent_item.children.add(next_segment_item);

                next_segment_handler = parent_handler.createChildHandler(next_segment_item);
                this.item_to_test_runner.set(next_segment_item, next_segment_handler);
            }

            parent_item = next_segment_item;
            parent_handler = next_segment_handler;
        }

        return parent_handler;
    }


    public async run(request: vscode.TestRunRequest, token: vscode.CancellationToken, debug: boolean): Promise<void> {
        this.diagnostics.clear();
        let test_run = this.test_controller.createTestRun(request);
        if (debug) {
            this.debug(request, token, test_run);
        } else {
            this.cancel_requested = false;
            token.onCancellationRequested(() => {
                this.cancel_requested = true;
            });

            if (request.include !== undefined) {
                this.output_channel.appendLine(`Running test(s): ${request.include.join(', ')}`);
            } else {
                this.output_channel.appendLine(`Running all tests`);
            }

            const tests_to_run = this.enumerateTests(request);
            await this.performTestRun(tests_to_run, test_run, token);
        }
    }

    private enumerateTests(
        request: vscode.TestRunRequest,
        run_tests_individually: boolean = false
    ): WorkspaceTestHandler[] {
        if (request.include === undefined) {
            const tests_to_run: WorkspaceTestInstance[] = [];
            this.workspace_test_handler.enumerateTests(run_tests_individually, tests_to_run);
            return tests_to_run.map(instance => this.item_to_test_runner.get(instance.item));

        } else {
            const test_handlers: WorkspaceTestHandler[] = [];
            for (const item of request.include) {
                if (this.item_to_test_runner.has(item)) {
                    const test = this.item_to_test_runner.get(item);
                    test_handlers.push(test);
                }
            }
            return test_handlers;
        }
    }

    public async runTestWithId(id: string, test_run: vscode.TestRun): Promise<WorkspaceTestReport> {
        const test = this.getTestInstance(id);
        if (test === undefined) {
            logger.warn(`Tried to run test ${id}, but no handler is available`);
            return new WorkspaceTestReport(false);
        } else {
            const runner = this.item_to_test_runner.get(test.item);
            return this.performTestRun([runner], test_run, new NullCancellationToken());
        }
    }

    public async performTestRun(
        tests_to_run: WorkspaceTestHandler[],
        test_run: vscode.TestRun,
        token: vscode.CancellationToken
    ): Promise<WorkspaceTestReport> {
        if (tests_to_run.length === 0) {
            test_run.end();
            return new WorkspaceTestReport(true);
        }

        try {
            const working_dir = await this.workspace.getBuildDir();
            const test_environment = await this.workspace.getRuntimeEnvironment();

            let runner: WorkspaceTestHandler = this.createTestRunHandler(tests_to_run);
            return await runner.run(test_run, token, this.diagnostics, test_environment, working_dir);

        } catch (error) {
            test_run.appendOutput('Test handler did not handle error:\r\n');
            test_run.appendOutput(`${error.message} \r\n`);
            test_run.appendOutput(error.stack);
            let message: vscode.TestMessage[] = [
                `Test handler did not handle error:`,
                error.message,
            ];
            for (let test of tests_to_run) {
                test_run.errored(test.item(), message);
            }
            return new WorkspaceTestReport(false);

        } finally {
            test_run.end();
        }
    }

    public createTestRunHandler(tests_to_run: WorkspaceTestHandler[]): WorkspaceTestHandler {
        if (tests_to_run.length === 0) {
            throw Error("Cannot create empty test runner");
        }

        if (tests_to_run.length > 1) {
            return new TestHandlerComposite(undefined, tests_to_run);
        } else {
            return tests_to_run[0];
        }
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
            let runner: WorkspaceTestHandler = this.item_to_test_runner.get(request.include[0]);
            test_run.started(runner.item());

            const compile_result = await runner.compile(test_run, token, this.diagnostics, this.workspaceRootDirectoryPath);
            if (!compile_result.succeeded()) {
                return;
            }

            if (vscode.debug.activeDebugSession !== undefined) {
                vscode.window.showErrorMessage("Cannot start debugger, another session is opened.");

            } else {
                // start the debugging session
                let environment_variables = [];
                for (const [k, v] of await this.workspace.getRuntimeEnvironment()) {
                    environment_variables.push({
                        name: k,
                        value: v
                    });
                }

                runner.debug(test_run, token, this.diagnostics, environment_variables, this.workspaceRootDirectoryPath);
            }
        }
    }


    public getTestInstance(id: string): WorkspaceTestInstance | undefined {
        return this.id_to_test.get(id);
    }

    public async refreshPackage(workspace_package: IPackage) {
        await this.loadPackageTests(workspace_package, false);
    }

    private escapeFilter(filter: String) {
        if (filter.indexOf("::") > 0) {
            // gtest replaces '::' with something else internally because '::' is used as the separator
            return filter.replace(/::/gi, "*");
        } else {
            return filter;
        }
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
