import * as vscode from 'vscode';
import { WorkspaceTestInterface, IWorkspace, IPackage, WorkspaceTestInstance, WorkspaceTestParameters, WorkspaceTestHandler } from 'vscode-catkin-tools-api';
import { logger } from '../../logging';
import { WorkspaceTestCommandlineParameters } from '../test_parameters';
import { WorkspaceTestAdapter } from '../workspace_test_adapter';
import { AbstractGoogleTestHandler } from './abstract_handler';
import { GoogleTestCaseHandler } from './test_case_handler';
import { GoogleTestCaseInstanceHandler } from './test_case_instance_handler';



export class GoogleTestFixtureHandler extends AbstractGoogleTestHandler<GoogleTestCaseHandler> {
    private test_fixture: WorkspaceTestInterface;
    private class_name: string;
    private instances: Map<WorkspaceTestInterface, GoogleTestCaseHandler | GoogleTestCaseInstanceHandler>
        = new Map<WorkspaceTestInterface, GoogleTestCaseHandler | GoogleTestCaseInstanceHandler>();

    constructor(
        test_interface: WorkspaceTestInterface,
        parameters: WorkspaceTestParameters,
        parent: AbstractGoogleTestHandler<GoogleTestFixtureHandler>,
        pkg: IPackage,
        workspace: IWorkspace,
        adapter: WorkspaceTestAdapter
    ) {
        super(test_interface, parameters, parent, pkg, workspace, adapter);

        this.test_fixture = this.test_instance.test;
        this.class_name = this.getFixtureFilter();

        // this.test_fixture.onChildAdded.event(child => {
        //     this.createChildHandler(child);
        // });
        // this.test_fixture.onModified.event(child => {
        //     this.updateFixture(child);
        // });
        // this.test_fixture.onChildRemoved.event(child => {
        //     this.removeChildHandler(child);
        // });

        this.updateFixture(false);
    }

    async reload(query_for_cases: boolean): Promise<void> {
        await this.updateFixture(query_for_cases);
        await super.reload(query_for_cases);
    }


    createChildHandler(child: WorkspaceTestInterface): GoogleTestCaseHandler | GoogleTestCaseInstanceHandler {
        let handler: GoogleTestCaseHandler | GoogleTestCaseInstanceHandler;
        if (child.is_parameterized) {
            handler = new GoogleTestCaseInstanceHandler(child, this.test_instance.parameters, this, this.pkg, this.workspace, this.adapter);
        } else {
            handler = new GoogleTestCaseHandler(child, this.test_instance.parameters, this, this.pkg, this.workspace, this.adapter);
        }
        this.instances.set(child, handler);
        return handler;
    }

    async updateFixture(query_for_cases: boolean) {
        let still_existing: (GoogleTestCaseHandler | GoogleTestCaseInstanceHandler)[] = [];
        for (let child of this.test_fixture.children) {
            let handler = this.instances.get(child);
            if (handler === undefined) {
                handler = this.createChildHandler(child);
            } else {
                await handler.reload(query_for_cases);
            }
            still_existing.push(handler);
        }
        // remove handlers that don't exist anymore
        for (let [itf, instance] of this.instances.entries()) {
            const i = still_existing.findIndex((handler) => handler === instance);
            if (i < 0) {
                // instance not found in still_existing
                // -> remove it
                instance.dispose();
                this.instances.delete(itf);
            }
        }
    }

    removeChildHandler(child: WorkspaceTestInterface) {
        let handler = this.instances.get(child);
        if (handler !== undefined) {
            logger.info(`Remove child case ${child.id.evaluate({})}`);
            handler.dispose();
        }
        this.instances.delete(child);
    }

    async makeCommands(): Promise<WorkspaceTestCommandlineParameters> {
        let command = new WorkspaceTestCommandlineParameters(await this.makeBuildTestCommand(), this.test_fixture.executable);
        let filter = this.getTestFilter();
        if (filter !== undefined) {
            command.args = [`--gtest_filter=${this.escapeFilter(filter)}`];
        }
        return command;
    }
    override getFixtureFilter(): string {
        let filter = this.test_instance.test.id.fixture;
        if (this.parameters.fixture?.instance !== undefined) {
            filter = `${this.parameters.fixture.instance}/${filter}`;
        }
        if (this.parameters.fixture?.generator !== undefined) {
            filter = `${filter}/${this.parameters.fixture.generator}`;
        }
        return filter;
    }

    override getTestFilter(): string {
        return `${this.getFixtureFilter()}.*`;
    }

    override handleTestFixtureResult(classname: string, test_run: vscode.TestRun, failures: number, errors: number): boolean {
        if (classname !== this.class_name) {
            return false;
        }

        if (errors > 0) {
            test_run.errored(this.item(), new vscode.TestMessage(`${errors} test(s) errored`));
        } else if (failures > 0) {
            test_run.failed(this.item(), new vscode.TestMessage(`${failures} test(s) failed`));
        } else {
            test_run.passed(this.item());
        }
        return true;
    }

    enumerateTests(run_tests_individually: boolean, tests: WorkspaceTestInstance[]) {
        if (!run_tests_individually) {
            tests.push(this.test_instance);
        }
    }
}
