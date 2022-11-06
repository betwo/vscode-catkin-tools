import * as vscode from 'vscode';
import {
    WorkspaceTestInterface, WorkspaceTestReport,
    WorkspaceTestRunReport,
    WorkspaceTestRunReportKind,
    IPackage,
    WorkspaceTestInstance,
    WorkspaceTestHandler
} from 'vscode-catkin-tools-api';
import * as fs from 'fs';
import { logger } from '../logging';

export class TestHandlerComposite implements WorkspaceTestHandler {
    public onModified = new vscode.EventEmitter<void>();

    constructor(
        protected test_instance: WorkspaceTestInstance,
        protected children: WorkspaceTestHandler[]
    ) { }

    dispose(): void { }

    addChild(child: WorkspaceTestHandler) {
        this.children.push(child);
        this.test_instance.item.children.add(child.item());
        // child.onModified.event(() => { this.onModified.fire(); })
    }

    removeChild(child: WorkspaceTestHandler) {
        const index = this.children.indexOf(child);
        if (index > -1) {
            const id = child.item().id;
            this.children.splice(index, 1);
            this.test_instance.item.children.delete(id);
        }
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


    async loadTests(build_dir: fs.PathLike, devel_dir: fs.PathLike, query_for_cases: boolean): Promise<void> {
        return;
    }

    async reload(query_for_cases: boolean): Promise<void> {
        for(let child of this.children) {
            await child.reload(query_for_cases);
        }
        return;
    }

    test(): WorkspaceTestInterface {
        return this.test_instance.test;
    }

    instance(): WorkspaceTestInstance {
        return this.test_instance;
    }

    item(): vscode.TestItem {
        return this.test_instance?.item;
    }

    async enqueue(test_run: vscode.TestRun): Promise<void> {
        if (this.test_instance?.item !== undefined) {
            test_run.enqueued(this.test_instance.item);
        }
        this.children.forEach(async (c) => await c.enqueue(test_run));
    }
    async compile(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        cwd: fs.PathLike
    ): Promise<WorkspaceTestRunReport> {
        let success = true;
        for (const child of this.children) {
            const result = await child.compile(test_run, token, diagnostics, cwd);
            if (!result.succeeded()) {
                test_run.errored(this.test_instance.item, new vscode.TestMessage("Child compilation failed"));
                success = false;
            }
        }
        if (success) {
            return new WorkspaceTestRunReport(WorkspaceTestRunReportKind.TestSucceeded);
        } else {
            return new WorkspaceTestRunReport(WorkspaceTestRunReportKind.BuildFailed);
        }
    }

    async run(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        environment: [string, string][],
        cwd: fs.PathLike
    ): Promise<WorkspaceTestReport> {
        await this.enqueue(test_run);

        if (this.test_instance?.item !== undefined) {
            test_run.started(this.test_instance.item);
        }

        let success = true;
        let error = false;
        for (const child of this.children) {
            if (token.isCancellationRequested) {
                await child.skip(test_run);
            } else {
                try {
                    const subresult = await child.run(test_run, token, diagnostics, environment, cwd);
                    if (!subresult.succeeded()) {
                        success = false;
                    }
                } catch (error) {
                    logger.error(error);
                    success = false;
                    error = true;
                }
            }
        }

        if (this.item()) {
            if (success) {
                test_run.passed(this.item());
            } else if (error) {
                test_run.errored(this.item(), new vscode.TestMessage("One ore more tests errored"));
            } else {
                test_run.failed(this.item(), new vscode.TestMessage("One ore more tests failed"));
            }
        }

        return new WorkspaceTestReport(success);
    }


    async debug(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        environment: [string, string][],
        cwd: fs.PathLike
    ): Promise<void> {
        throw Error("Cannot debug a composite test");
    }

    async skip(test_run: vscode.TestRun): Promise<void> {
        this.children.forEach(async (c) => await c.skip(test_run));
    }

    enumerateTests(run_tests_individually: boolean, tests: WorkspaceTestInstance[]) {
        this.children.forEach(async (c) => await c.enumerateTests(run_tests_individually, tests));
    }
    enumeratePackages(packages: IPackage[]) {
        if (this.test_instance.test !== undefined) {
            if (packages.indexOf(this.test_instance.test.package) < 0) {
                packages.push(this.test_instance.test.package);
            }
        }
        this.children.forEach(async (c) => c.enumeratePackages(packages));
    }
}
