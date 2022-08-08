import * as vscode from 'vscode';
import {
    WorkspaceTestInterface, IWorkspace, IPackage, WorkspaceTestInstance, WorkspaceTestParameters, WorkspaceTestHandler
} from 'vscode-catkin-tools-api';
import { logger } from '../../logging';
import { Package } from '../../package';
import { WorkspaceTestCommandlineParameters } from '../test_parameters';
import { WorkspaceTestAdapter } from '../workspace_test_adapter';
import { AbstractGoogleTestHandler } from './abstract_handler';
import { GoogleTestCaseHandler } from './test_case_handler';



export class GoogleTestCaseInstanceHandler extends AbstractGoogleTestHandler<GoogleTestCaseHandler> {
    private test_case: WorkspaceTestInterface;
    private instances: Map<string, GoogleTestCaseHandler> = new Map<string, GoogleTestCaseHandler>();

    constructor(
        test_interface: WorkspaceTestInterface,
        parameters: WorkspaceTestParameters,
        parent: WorkspaceTestHandler,
        pkg: IPackage,
        workspace: IWorkspace,
        adapter: WorkspaceTestAdapter
    ) {
        super(test_interface, parameters, parent, pkg, workspace, adapter);

        this.test_case = this.test_instance.test;
        if (!this.test().is_parameterized) {
            logger.error("Tried to manage an non-parameterized test..");
        }
        if (this.test_case.instances === undefined) {
            logger.error("Tried to manage an test without instances");
        }

        this.updateTestCases();
    }

    async reload(): Promise<void> {
        await this.updateTestCases();
        await super.reload();
    }


    createChildHandler(instance: WorkspaceTestParameters) : GoogleTestCaseHandler {
        const handler = new GoogleTestCaseHandler(this.test_case, instance, this, this.pkg, this.workspace, this.adapter);
        let instance_id = `${instance.instance}_${instance.generator}`;
        this.instances.set(instance_id, handler);
        return handler;
    }
    async updateTestCases() {
        let still_existing: string[] = [];
        for (let instance of this.test_case.instances) {
            if (instance.fixture?.instance !== this.parameters.fixture?.instance ||
                instance.fixture?.generator !== this.parameters.fixture?.generator) {
                continue;
            }
            let instance_id = `${instance.instance}_${instance.generator}`;
            let handler = this.instances.get(instance_id);
            if (handler === undefined) {
                handler = this.createChildHandler(instance);
            } else {
                await handler.reload();
            }
            still_existing.push(instance_id);
        }
        // remove handlers that don't exist anymore
        for (let [instance, handler] of this.instances.entries()) {
            const i = still_existing.findIndex((existing_id) => existing_id === instance);
            if (i < 0) {
                // instance not found in still_existing
                // -> remove it
                handler.dispose();
                this.instances.delete(instance);
            }
        }
    }
    removeChildHandler(child: WorkspaceTestInterface) {
        // throw new Error('Method not implemented.');
    }

    handleTestCaseResult(classname: string, name: string, test_run: vscode.TestRun, failure?: string, error?: string): boolean {
        let all_succeeded = true;
        for (const child of this.children) {
            if (!child.handleTestCaseResult(classname, name, test_run, failure, error)) {
                all_succeeded = false;
            }
        }
        return all_succeeded;
    }

    async makeCommands(): Promise<WorkspaceTestCommandlineParameters> {
        let command = new WorkspaceTestCommandlineParameters(await this.makeBuildTestCommand(), this.test_case.executable);
        let filter = this.getTestFilter();
        if (filter !== undefined) {
            command.args = [`--gtest_filter=${this.escapeFilter(filter)}`];
        }
        return command;
    }
    override getFixtureFilter(): string {
        const parent = this.parent as AbstractGoogleTestHandler<GoogleTestCaseHandler>;
        return parent.getFixtureFilter();
    }

    override getTestFilter(): string {
        if (!this.test().is_parameterized) {
            logger.error("Tried to manage an non-parameterized test..");
        }
        let filter = this.test_instance.test.id.test;
        if (this.parameters.instance !== undefined) {
            filter = `${this.parameters.instance}/${filter}`;
        }
        if (this.parameters.generator !== undefined) {
            filter = `${filter}/${this.parameters.generator}`;
        } else {
            filter = `${filter}/*`;
        }

        const parent = this.parent as AbstractGoogleTestHandler<GoogleTestCaseHandler>;
        const fixture_filter = parent.getFixtureFilter();
        return `${fixture_filter}.${filter}`;
    }

    enumerateTests(run_tests_individually: boolean, tests: WorkspaceTestInstance[]) {
        if (run_tests_individually) {
            tests.push(this.test_instance);
        }
    }
}
