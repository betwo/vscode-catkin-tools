import * as vscode from 'vscode';
import { WorkspaceTestInterface, IWorkspace, IPackage, WorkspaceTestInstance, WorkspaceTestParameters, WorkspaceTestHandler, areTestParametersEqual } from 'vscode-catkin-tools-api';
import { logger } from '../../logging';
import { WorkspaceTestCommandlineParameters } from '../test_parameters';
import { WorkspaceTestAdapter } from '../workspace_test_adapter';
import { AbstractGoogleTestHandler } from './abstract_handler';
import { GoogleTestCaseHandler } from './test_case_handler';
import { GoogleTestFixtureHandler } from './test_fixture_handler';



export class GoogleTestFixtureInstanceHandler extends AbstractGoogleTestHandler<GoogleTestFixtureHandler> {
    private test_fixture: WorkspaceTestInterface;
    private instances: Map<string, GoogleTestFixtureHandler> = new Map<string, GoogleTestFixtureHandler>();

    constructor(
        test_interface: WorkspaceTestInterface,
        parameters: WorkspaceTestParameters,
        parent: WorkspaceTestHandler,
        pkg: IPackage,
        workspace: IWorkspace,
        adapter: WorkspaceTestAdapter
    ) {
        super(test_interface, parameters, parent, pkg, workspace, adapter);

        this.test_fixture = this.test_instance.test;

        this.updateFixture();
    }

    async reload(): Promise<void> {
        await this.updateFixture();
        await super.reload();
    }


    createChildHandler(instance: WorkspaceTestParameters): GoogleTestFixtureHandler {
        let handler = new GoogleTestFixtureHandler(this.test_fixture, instance, this, this.pkg, this.workspace, this.adapter);
        const fixture_id = `${instance.fixture.instance}_${instance.fixture.generator}`;
        const instance_id = `${fixture_id}_${instance.instance}_${instance.generator}`;
        this.instances.set(instance_id, handler);
        return handler;
    }

    async updateFixture() {
        let still_existing: string[] = [];
        for (let instance of this.test_fixture.instances) {
            const fixture_id = `${instance.fixture.instance}_${instance.fixture.generator}`;
            const instance_id = `${fixture_id}_${instance.instance}_${instance.generator}`;
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
    removeChildHandler(child: WorkspaceTestInstance) {
        const instance = child.parameters;
        const fixture_id = `${instance.fixture.instance}_${instance.fixture.generator}`;
        const instance_id = `${fixture_id}_${instance.instance}_${instance.generator}`;
        let handler = this.instances.get(instance_id);
        if (handler !== undefined) {
            handler.dispose();
        }
        this.instances.delete(instance_id);
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
        if (this.test_interface.is_parameterized && this.isInstanced()) {
            filter = `*/${filter}`;
        }
        if (this.test_interface.is_parameterized && this.isGenerated()) {
            filter = `${filter}/*`;
        }
        return filter;
    }

    override getTestFilter(): string {
        return `${this.getFixtureFilter()}.*`;
    }

    isInstanced(): boolean {
        for (const [_, child] of this.instances) {
            for (const param of child.test().instances) {
                if (param.fixture.instance !== undefined) {
                    return true;
                }
            }
        }
        return false;
    }
    isGenerated(): boolean {
        for (const [_, child] of this.instances) {
            for (const param of child.test().instances) {
                if (param.fixture.generator !== undefined) {
                    return true;
                }
            }
        }
        return false;
    }

    enumerateTests(run_tests_individually: boolean, tests: WorkspaceTestInstance[]) {
        if (!run_tests_individually) {
            tests.push(this.test_instance);
        }
    }
}
