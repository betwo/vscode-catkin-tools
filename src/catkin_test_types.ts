
import { TestSuiteInfo, TestInfo } from 'vscode-test-adapter-api';
import * as fs from 'fs';

import { CatkinPackage, TestType } from './catkin_package';

export class CatkinTestInterface {
    public package: CatkinPackage;

    public type: TestType;
    public filter: String;
    public executable?: fs.PathLike;

    public build_space: fs.PathLike;
    public build_target: String;
    public global_build_dir: String;
    public global_devel_dir: String;

    public info: TestInfo | TestSuiteInfo;
}

export class CatkinTestCase extends CatkinTestInterface {
    public info: TestInfo;
}

export class CatkinTestExecutable extends CatkinTestInterface {
    public tests: CatkinTestCase[];
    public info: TestSuiteInfo;
}

export class CatkinTestSuite extends CatkinTestInterface {
    public executables: CatkinTestExecutable[];
    public info: TestSuiteInfo;
}