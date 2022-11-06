import * as vscode from 'vscode';
import {
    WorkspaceTestInterface, IWorkspace, IPackage, WorkspaceTestInstance, WorkspaceTestParameters, WorkspaceTestHandler
} from 'vscode-catkin-tools-api';
import { logger } from '../../logging';
import { Package } from '../../package';
import { parsePackageForTests } from '../cmake_test_parser';
import { WorkspaceTestCommandlineParameters } from '../test_parameters';
import { WorkspaceTestAdapter } from '../workspace_test_adapter';
import { AbstractGoogleTestHandler } from './abstract_handler';
import { updateTestsFromExecutable } from './test_binary_parser';
import { GoogleTestFixtureHandler } from './test_fixture_handler';
import { GoogleTestFixtureInstanceHandler } from './test_fixture_instance_handler';



export class GoogleTestExecutableHandler extends AbstractGoogleTestHandler<GoogleTestFixtureHandler> {
    private test_executable: WorkspaceTestInterface;
    private fixtures: Map<WorkspaceTestInterface, GoogleTestFixtureHandler | GoogleTestFixtureInstanceHandler>
        = new Map<WorkspaceTestInterface, GoogleTestFixtureHandler | GoogleTestFixtureInstanceHandler>();

    constructor(
        test_interface: WorkspaceTestInterface,
        parameters: WorkspaceTestParameters,
        parent: WorkspaceTestHandler,
        pkg: IPackage,
        workspace: IWorkspace,
        adapter: WorkspaceTestAdapter
    ) {
        super(test_interface, parameters, parent, pkg, workspace, adapter);

        this.test_executable = this.test_instance.test;
        this.updateExecutable(false);
    }

    async reload(query_for_cases: boolean): Promise<void> {
        // update from source first
        const catkin_pkg = this.test_interface.package as Package;

        const changes_in_source = await catkin_pkg.updateTestExecutableFromSource(true, false, false);

        // then update from binary
        const changes_in_binary = await updateTestsFromExecutable(
            this.test_executable.build_target,
            catkin_pkg,
            true
        );
        if(changes_in_source.length > 0 || changes_in_binary.length > 0) {
            await this.updateExecutable(query_for_cases);
        }
        await super.reload(query_for_cases);
    }

    async updateExecutable(query_for_cases: boolean) {
        for (let child of this.test_executable.children) {
            let handler = this.fixtures.get(child);
            if (handler === undefined) {
                this.createChildHandler(child);
            } else {
                await handler.reload(query_for_cases);
            }
        }
    }

    // this class should create new fixtures when the executable changes...
    createChildHandler(child: WorkspaceTestInterface) {
        let handler: GoogleTestFixtureHandler | GoogleTestFixtureInstanceHandler;
        let parameters: WorkspaceTestParameters = {};
        if (child.is_parameterized) {
            handler = new GoogleTestFixtureInstanceHandler(child, parameters, this, this.pkg, this.workspace, this.adapter);
        } else {
            handler = new GoogleTestFixtureHandler(child, parameters, this, this.pkg, this.workspace, this.adapter);
        }
        this.fixtures.set(child, handler);
    }

    removeChildHandler(child: WorkspaceTestInterface) {
        let handler = this.fixtures.get(child);
        if (handler !== undefined) {
            logger.info(`Remove child fixture ${child.id.evaluate({})}`);
            handler.dispose();
        }
        this.fixtures.delete(child);
    }

    async makeCommands(): Promise<WorkspaceTestCommandlineParameters> {
        return new WorkspaceTestCommandlineParameters(await this.makeBuildTestCommand(), this.test_executable.executable);
    }

    public addFixtureHandler(child: GoogleTestFixtureHandler) {
        this.children.push(child);
    }

    getTestFilter(): string {
        return "*";
    }

    enumerateTests(run_tests_individually: boolean, tests: WorkspaceTestInstance[]) {
        for (const child of this.test_instance.test.children) {
            for (const instance of this.adapter.getTestInstances(child)) {
                tests.push(instance);
            }
        }
    }
}
