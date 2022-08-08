import * as vscode from 'vscode';
import {
    WorkspaceTestInterface, WorkspaceTestReport,
    WorkspaceTestRunReport,
    WorkspaceTestRunReportKind,
    IWorkspace,
    WorkspaceTestInstance,
    WorkspaceTestHandler
} from 'vscode-catkin-tools-api';
import * as fs from 'fs';
import * as compiler_problem_matcher from '../compiler_problem_matcher';
import { runCatkinCommand } from '../../catkin_tools/catkin_command';
import { WorkspaceTestAdapter } from './workspace_test_adapter';
import { TestHandlerComposite } from "./test_handler_composite";
import { ShellOutput } from '../shell_command';
import { GoogleTestFixtureHandler } from './gtest/test_fixture_handler';
import { GoogleTestExecutableHandler } from './gtest/test_executable_handler';
import { logger } from '../logging';
import { Package } from '../package';


export class TestHandlerCatkinPackage extends TestHandlerComposite {
    workspace: IWorkspace;
    private tests: Map<WorkspaceTestInterface, WorkspaceTestHandler>
        = new Map<WorkspaceTestInterface, WorkspaceTestHandler>();

    constructor(
        protected pkg: Package,
        children: WorkspaceTestHandler[],
        package_test_instance: WorkspaceTestInstance,
        protected adapter: WorkspaceTestAdapter
    ) {
        super(package_test_instance, children);
        if (package_test_instance.item === undefined) {
            throw Error("Test item is undefined");
        }
        this.workspace = adapter.workspace;


        pkg.onTestSuiteModified.event(async () => {
            await this.updateWithInstance();
        });
    }
    async updateWithInstance() {
        let instance = this.pkg.test_instance;
        if(!instance.test.id.prefix.startsWith("package_")) {
            throw Error(`Logic error, tried to treat ${instance.test.id.prefix} as a package`);
        }
        for (let executable of instance.test.children) {
            await this.updateExecutable(executable);
        }
        logger.silly("...");
    }

    async updateExecutable(executable: WorkspaceTestInterface) {
        if(!executable.id.prefix.startsWith("exec_")) {
            throw Error(`Logic error, tried to treat ${executable.id.prefix} as an executable`);
        }
        logger.silly(executable.id.evaluate({}));
        let handler = this.tests.get(executable);
        if (handler !== undefined) {
            console.log("already have executable");
            await handler.reload();
        } else {
            console.log("create executable");
            const pkg = this.test_instance.test.package;
            let child_parameters = { ...this.test_instance.parameters }; // TODO: is this all that is needed?

            let handler = new GoogleTestExecutableHandler(executable, child_parameters, this, pkg, this.workspace, this.adapter);
            this.tests.set(executable, handler);
        }
    }

    dispose(): void {
        // FIXME:
        logger.info("TODO: dispose of catkin package");
    }
    async loadTests(build_dir: fs.PathLike, devel_dir: fs.PathLike, query_for_cases: boolean): Promise<void> {
        await this.pkg.loadTests(build_dir, devel_dir, query_for_cases);
        await super.reload();
    }

    async reload(): Promise<void> {
        logger.info("TODO: reload of catkin package");
        await this.loadTests(await this.workspace.getBuildDir(), await this.workspace.getDevelDir(), true);
    }

    async compile(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        cwd: fs.PathLike
    ): Promise<WorkspaceTestRunReport> {
        const pkg = this.test_instance.test.package;
        try {
            test_run.started(this.test_instance.item);
            await runCatkinCommand(["build", pkg.getName()],
                cwd,
                undefined,
                undefined,
                undefined,
                out => out.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`)),
                err => err.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`))
            );

            await runCatkinCommand(["build", pkg.getName(), "--make-args", "tests"],
                cwd,
                undefined,
                undefined,
                undefined,
                out => out.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`)),
                err => err.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`))
            );

            const build_dir = await this.workspace.workspace_provider.getBuildDir();
            const devel_dir = await this.workspace.workspace_provider.getDevelDir();

            await pkg.loadTests(build_dir, devel_dir, true);

            return new WorkspaceTestRunReport(WorkspaceTestRunReportKind.TestSucceeded);

        } catch (error_output: any) {
            let error = [new vscode.TestMessage("Compilation failed")];
            if (error_output instanceof ShellOutput) {
                error_output.stdout.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`));
                error_output.stderr.split("\n").forEach(line => test_run.appendOutput(`${line}\r\n`));
            }

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

    async run(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        environment: [string, string][],
        cwd: fs.PathLike
    ): Promise<WorkspaceTestReport> {
        if (this.children.length === 0) {
            // not build yet, so compile first
            const result = await this.compile(test_run, token, diagnostics, cwd);
            if (!result.succeeded()) {
                return new WorkspaceTestReport(false);
            }
        }
        return super.run(test_run, token, diagnostics, environment, cwd);
    }

    async debug(
        test_run: vscode.TestRun,
        token: vscode.CancellationToken,
        diagnostics: vscode.DiagnosticCollection,
        environment: [string, string][],
        cwd: fs.PathLike
    ): Promise<void> {
        throw Error("Cannot debug a package test");
    }
}
