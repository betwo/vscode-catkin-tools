
import { TestSuiteInfo, TestInfo } from 'vscode-test-adapter-api';
import * as fs from 'fs';

import { BuildTarget, Package, TestType } from './package';

export class WorkspaceTestInterface {
    public package: Package;

    public type: TestType;
    public filter: String;
    public executable?: fs.PathLike;

    public build_space: fs.PathLike;
    public build_target: String;
    public global_build_dir: String;
    public global_devel_dir: String;

    public info: TestInfo | TestSuiteInfo;
}

export class WorkspaceTestCase extends WorkspaceTestInterface {
    public info: TestInfo;
}

export class WorkspaceTestFixture extends WorkspaceTestInterface {
    public cases: WorkspaceTestCase[];
    public info: TestSuiteInfo;
}
export class WorkspaceTestExecutable extends WorkspaceTestInterface {
    public fixtures: WorkspaceTestFixture[];
    public info: TestSuiteInfo;
}

export class WorkspaceTestSuite extends WorkspaceTestInterface {
    public executables: WorkspaceTestExecutable[];
    public info: TestSuiteInfo | TestInfo;

    public test_build_targets: BuildTarget[];
}