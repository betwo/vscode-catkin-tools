import * as vscode from 'vscode';
import {
    WorkspaceTestInterface, IWorkspace, IPackage, WorkspaceTestInstance, WorkspaceTestParameters, WorkspaceTestHandler
} from 'vscode-catkin-tools-api';
import { logger } from '../../logging';
import { Package } from '../../package';
import { WorkspaceTestCommandlineParameters } from '../test_parameters';
import { WorkspaceTestAdapter } from '../workspace_test_adapter';
import { AbstractGoogleTestHandler } from './abstract_handler';



export class GoogleTestCaseHandler extends AbstractGoogleTestHandler<undefined> {
    private test_case: WorkspaceTestInterface;
    private class_name: string;
    private test_name: string;

    constructor(
        test_interface: WorkspaceTestInterface,
        parameters: WorkspaceTestParameters,
        parent: AbstractGoogleTestHandler<GoogleTestCaseHandler>,
        pkg: IPackage,
        workspace: IWorkspace,
        adapter: WorkspaceTestAdapter
    ) {
        super(test_interface, parameters, parent, pkg, workspace, adapter);

        this.test_case = this.test_instance.test;
        this.class_name = parent.getFixtureFilter();
        this.test_name = this.getTestCaseFilter();
    }

    async reload(): Promise<void> {
        await super.reload();
    }

    async makeCommands(): Promise<WorkspaceTestCommandlineParameters> {
        let test = this.test_instance.test;
        let command: WorkspaceTestCommandlineParameters;
        if (test.build_target === undefined) {
            let gtest_parent = this.parent as AbstractGoogleTestHandler<GoogleTestCaseHandler>;
            command = new WorkspaceTestCommandlineParameters(await gtest_parent.makeBuildTestCommand(), gtest_parent.test().executable);
        } else {
            command = new WorkspaceTestCommandlineParameters(await this.makeBuildTestCommand(), this.test_case.executable);
        }
        let filter = this.getTestFilter();
        if (filter !== undefined) {
            command.args = [`--gtest_filter=${this.escapeFilter(filter)}`];
        }
        return command;
    }

    getTestCaseFilter(): string {
        let filter = this.test_instance.test.id.test;
        if(this.parameters.instance !== undefined) {
            filter = `${this.parameters.instance}/${filter}`;
        }
        if(this.parameters.generator !== undefined) {
            filter = `${filter}/${this.parameters.generator}`;
        }
        return filter;
    }

    override getTestFilter(): string {
        const parent = this.parent as AbstractGoogleTestHandler<GoogleTestCaseHandler>;
        const fixture_filter = parent.getFixtureFilter();
        const filter = this.getTestCaseFilter();
        return `${fixture_filter}.${filter}`;
    }

    override handleTestCaseResult(classname: string, name: string, test_run: vscode.TestRun, failure?: string, error?: string) : boolean {
        if (classname !== this.class_name || name !== this.test_name) {
            return false;
        }

        let all_succeeded = true;
        if (failure !== undefined) {
            test_run.failed(this.item(), new vscode.TestMessage(failure));
            all_succeeded = false;
        } else {
            if (error !== undefined) {
                test_run.errored(this.item(), new vscode.TestMessage(error));
                all_succeeded = false;
            } else {
                test_run.passed(this.item());
            }
        }

        super.handleTestCaseResult(classname, name, test_run, failure, error);

        return all_succeeded;
    }

    enumerateTests(run_tests_individually: boolean, tests: WorkspaceTestInstance[]) {
        if (run_tests_individually) {
            tests.push(this.test_instance);
        }
    }
}
