
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as glob from 'fast-glob';
import * as xml from 'fast-xml-parser';
import * as path from 'path';

import { IPackage, WorkspaceTestInterface, IBuildTarget, WorkspaceTestIdentifierTemplate, WorkspaceTestParameters, isTemplateEqual, WorkspaceTestInstance } from 'vscode-catkin-tools-api';

import { Workspace } from './workspace';
import { parsePackageForTests, skimCmakeListsForTests } from './testing/cmake_test_parser';
import { wrapArray } from './utils';
import { getCTestTargets as getCTestTargetExecutables } from './testing/ctest_query';
import { updateTestsFromExecutable } from './testing/gtest/test_binary_parser';
import { logger } from '../common/logging';
import { TestHandlerCatkinPackage } from './testing/test_handler_catkin_package';
import { WorkspaceTestAdapter } from './testing/workspace_test_adapter';

export class Package implements IPackage {
  public current_build_dir?: fs.PathLike;
  public current_devel_dir?: fs.PathLike;
  public current_build_space?: fs.PathLike;

  public name: string;
  public dependencies: string[];
  public dependees: string[];
  public package_xml: any;

  public has_tests: boolean;
  public tests_loaded: boolean;
  public package_test_suite: WorkspaceTestInterface;
  public test_instance: WorkspaceTestInstance;

  public path: string;
  public relative_path: fs.PathLike;
  public absolute_path: fs.PathLike;
  public cmakelists_path: string;

  public onTestSuiteModified = new vscode.EventEmitter<void>();

  public constructor(
    public package_xml_path: fs.PathLike,
    public workspace: Workspace) {

    this.has_tests = false;
    this.tests_loaded = false;
  }

  private async loadPackageXml() {
    const raw_content = await fs.promises.readFile(this.package_xml_path);
    this.package_xml = xml.parse(raw_content.toString(),
      {
        parseAttributeValue: true,
        ignoreAttributes: false
      }
    );
    if (this.package_xml === undefined || this.package_xml === "" ||
      !('package' in this.package_xml)) {
      throw Error(`Invalid package xml file: ${this.package_xml_path}`);
    }
    const pkg = this.package_xml.package;
    let dependencies = new Set<string>();
    this.name = pkg.name;
    if (pkg['@_format'] === 2) {
      if (pkg.depend !== undefined) {
        for (const dep of wrapArray(pkg.depend)) {
          dependencies.add(dep);
        }
      }
      if (pkg.build_depend !== undefined) {
        for (const dep of wrapArray(pkg.build_depend)) {
          dependencies.add(dep);
        }
      }
      if (pkg.exec_depend !== undefined) {
        for (const dep of wrapArray(pkg.exec_depend)) {
          dependencies.add(dep);
        }
      }
    } else {
      if (pkg.build_depend !== undefined) {
        for (const dep of wrapArray(pkg.build_depend)) {
          dependencies.add(dep);
        }
      }
      if (pkg.run_depend !== undefined) {
        for (const dep of wrapArray(pkg.run_depend)) {
          dependencies.add(dep);
        }
      }
    }
    this.dependencies = Array.from(dependencies);
    this.dependees = [];

    let src_path = path.dirname(this.package_xml_path.toString());

    this.cmakelists_path = path.join(src_path, "CMakeLists.txt");

    return true;
  }

  public static async loadFromXML(package_xml_path: fs.PathLike, workspace: Workspace) {
    let instance = new Package(package_xml_path, workspace);
    let package_xml_loaded = await instance.loadPackageXml();
    instance.has_tests = await skimCmakeListsForTests(instance);
    return instance;
  }

  public getName(): string {
    return this.name;
  }

  public getAbsolutePath(): fs.PathLike {
    if (this.absolute_path === undefined) {
      let src_path = path.normalize(path.dirname(this.package_xml_path.toString()));
      this.absolute_path = src_path;
    }
    return this.absolute_path;
  }


  public async getRelativePath(): Promise<fs.PathLike> {
    if (this.relative_path === undefined) {
      let src_path = path.dirname(this.package_xml_path.toString());
      let prefix = await this.workspace.getRootPath();
      this.relative_path = src_path.replace(prefix + '/', "");
    }
    return this.relative_path;
  }

  public async getWorkspacePath(src_dir: string = undefined): Promise<string[]> {
    const relative_path = await this.getRelativePath();
    let parts = relative_path.toString().split(path.sep);
    const src = src_dir !== undefined ? src_dir : await this.workspace.workspace_provider.getSrcDir();
    if (parts[0] === path.basename(src)) {
      return parts.slice(1);
    }
    return parts;
  }

  public static async getNameFromPackageXML(package_xml_path: fs.PathLike): Promise<string> {
    try {
      const content_raw = await fs.promises.readFile(package_xml_path);
      let package_xml = xml.parse(content_raw.toString());
      return package_xml['package']['name'];
    } catch (err) {
      return null;
    }
  }

  public containsFile(file: vscode.Uri) {
    if (file.fsPath.toString().startsWith((this.getAbsolutePath() + "/").toString())) {
      return true;
    }
    return false;
  }

  public isBuilt(build_dir: string): boolean {
    const build_space = path.join(build_dir, this.name);
    return fs.existsSync(build_space);
  }

  public async iteratePossibleSourceFiles(header_file: vscode.Uri, async_filter: (uri: vscode.Uri) => Promise<boolean>): Promise<boolean> {
    const include_prefix = "/include/";
    const include_start_pos = header_file.fsPath.lastIndexOf(include_prefix);
    if (include_start_pos < 0) {
      logger.error(`Could not find include folder in ${header_file.fsPath.toString()}`);
      return false;
    }
    const include_relpath = header_file.fsPath.substr(include_start_pos + include_prefix.length);
    let sources = await glob(
      [`${this.getAbsolutePath()}/**/*.(c|cc|cpp|cxx)`]
    );
    for (let source of sources) {
      const code_raw = await fs.promises.readFile(source.toString());
      const code = code_raw.toString().split("\n");
      for (let line of code) {
        if (line.indexOf("#") >= 0 && line.indexOf("include") > 0) {
          if (line.indexOf(include_relpath) > 0) {
            if (await async_filter(vscode.Uri.file(source.toString()))) {
              return true;
            }
          }
        }
      }
    }
  }


  public async loadTests(build_dir: fs.PathLike, devel_dir: fs.PathLike, query_for_cases: boolean): Promise<WorkspaceTestInterface[]> {
    this.current_build_dir = build_dir;
    this.current_devel_dir = devel_dir;
    this.current_build_space = `${build_dir}/${this.name}`;

    if (!this.has_tests) {
      throw Error("No tests in package");
    }

    // find gtest build targets
    let test_build_targets: IBuildTarget[] = await getCTestTargetExecutables(build_dir, this.name, query_for_cases);
    this.updatePackageImpl(test_build_targets);

    // generate a list of all tests in this target
    let changed_executables: WorkspaceTestInterface[] = [];
    await this.updateTestExecutableFromSource(query_for_cases, false, false);
    for (let build_target of test_build_targets) {
      const changed = await updateTestsFromExecutable(build_target, this, query_for_cases);
      changed_executables = changed_executables.concat(changed);
    }

    if (query_for_cases) {
      this.tests_loaded = true;
    }

    if (this.test_instance === undefined) {
      this.test_instance = this.workspace.test_adapter.createTestInstance(this.package_test_suite, {});
      this.test_instance.handler = new TestHandlerCatkinPackage(this, [], this.test_instance, this.workspace.test_adapter);

      this.workspace.test_adapter.registerTestHandler(
        this.workspace.test_adapter.workspace_test_handler,
        this.test_instance.handler,
        this.test_instance
      );
    }
    await this.test_instance.handler?.updateTestItem();
    if (changed_executables.length > 0) {
      this.onTestSuiteModified.fire();
    }

    return changed_executables;
  }

  public async updateTestExecutableFromSource(query_for_cases: boolean,
    only_update_existing: boolean,
    is_partial_update: boolean): Promise<WorkspaceTestInterface[]> {
    let changed_tests = [];

    if (query_for_cases) {
      try {
        const parsed_test_executables = await parsePackageForTests(this);
        for (const parsed_executable of parsed_test_executables) {
          let [test_exec, exec_was_changed] = await this.updateTestExecutable(parsed_executable, only_update_existing, is_partial_update);
          if (exec_was_changed) {
            changed_tests.push(test_exec);
          }
        }
      } catch (err) {
        logger.error(`Cannot determine gtest details: ${err}`);
      }
    }

    return changed_tests;
  }

  public async updateTestExecutable(
    parsed_executable: WorkspaceTestInterface,
    only_update_existing: boolean,
    is_partial_update: boolean
  ): Promise<[WorkspaceTestInterface, boolean]> {
    let [test_exec, exec_was_changed] = this.updateTestExecutableImpl(parsed_executable.id, parsed_executable.build_target, parsed_executable.file, parsed_executable.line);

    for (const existing_executable of this.package_test_suite.children) {
      if (isTemplateEqual(existing_executable.id, parsed_executable.id)) {
        if (!is_partial_update) {
          // remove all fixtures that don't exist anymore
          for (const existing_fixture of existing_executable.children) {
            const entry = parsed_executable.children.find(parsed_fixture => isTemplateEqual(parsed_fixture.id, existing_fixture.id));
            if (entry === undefined) {
              logger.silly(`Fixture ${existing_fixture.id} was removed`);
            }
          }
        }
        // update all other fixtures
        for (const parsed_fixture of parsed_executable.children) {
          let build_target = parsed_executable.build_target !== undefined ? parsed_executable.build_target : existing_executable.build_target;
          this.updateTestFixture(existing_executable, parsed_fixture, build_target, only_update_existing, is_partial_update);
        }
        break;
      }
    }

    return [test_exec, exec_was_changed];
  }

  public updateTestFixture(
    test_executable: WorkspaceTestInterface,
    partial_test_ifc: WorkspaceTestInterface,
    build_target: IBuildTarget,
    only_update_existing: boolean,
    is_partial_update: boolean
  ) {
    // first update the fixture, without updating children
    let updated_fixture = this.updateTestFixtureImpl(
      test_executable,
      partial_test_ifc.id,
      build_target,
      partial_test_ifc.file,
      partial_test_ifc.line,
      partial_test_ifc.is_parameterized,
      partial_test_ifc.instances,
      only_update_existing
    );

    if (updated_fixture === undefined) {
      return undefined;
    }

    let [existing_fixture, fixture_changed] = updated_fixture;

    if (!is_partial_update) {
      // remove all fixtures that don't exist anymore
      let removed_cases: WorkspaceTestInterface[] = [];
      for (const existing_case of existing_fixture.children) {
        const entry = partial_test_ifc.children.find(parsed_case => isTemplateEqual(parsed_case.id, existing_case.id));
        if (entry === undefined) {
          logger.silly(`Case ${existing_case.id} was removed`);
          removed_cases.push(existing_case);
        }
      }
      if (removed_cases.length > 0) {
        let isCaseRemoved = (testcase: WorkspaceTestInterface) => removed_cases.indexOf(testcase) >= 0;
        existing_fixture.children = existing_fixture.children.filter(testcase => !isCaseRemoved(testcase));
      }
    }

    // update the children now
    for (const existing_fixture of test_executable.children) {
      if (isTemplateEqual(existing_fixture.id, partial_test_ifc.id)) {
        for (const parsed_case of partial_test_ifc.children) {
          this.updateTestCase(existing_fixture, parsed_case);
        }
        break;
      }
    }

    return updated_fixture;
  }

  public updateTestCase(
    test_ifc: WorkspaceTestInterface,
    partial_test_ifc: WorkspaceTestInterface,
    only_update_existing: boolean = false
  ) {
    return this.updateTestCaseImpl(
      test_ifc,
      partial_test_ifc.id,
      partial_test_ifc.build_target !== undefined ? partial_test_ifc.build_target : test_ifc.build_target,
      partial_test_ifc.file,
      partial_test_ifc.line,
      partial_test_ifc.is_parameterized,
      partial_test_ifc.instances,
      only_update_existing
    );
  }


  updatePackageImpl(
    test_build_targets: IBuildTarget[]
  ): boolean {
    const test_id = new WorkspaceTestIdentifierTemplate(`package_${this.name}`);
    const build_target: IBuildTarget = {
      cmake_target: this.workspace.workspace_provider.getDefaultRunTestTargetName(),
      label: this.workspace.workspace_provider.getDefaultRunTestTargetName(),
      exec_path: undefined,
      type: "suite"
    };
    const new_values = {
      package: this,
      build_space: this.current_build_space,
      build_target: build_target,
      id: test_id,
      debuggable: false,
      label: this.name,
      file: this.cmakelists_path,
      description: "📦",
    };

    if (this.package_test_suite === undefined) {
      this.package_test_suite = {
        type: 'suite',
        children: [],
        resolvable: test_build_targets.length === 0,
        is_parameterized: false,
        ...new_values
      };
    } else {
      let changed = false;
      for (let k in new_values) {
        if (this.package_test_suite[k] !== new_values[k]) {
          this.package_test_suite[k] = new_values[k];
          changed = true;
        }
      }
      return changed;
    }
  }

  updateTestExecutableImpl(
    test_id: WorkspaceTestIdentifierTemplate,
    build_target: IBuildTarget,
    source_file: string,
    line_number: number,
    only_update_existing: boolean = false
  ): [WorkspaceTestInterface, boolean] {
    const new_values = {
      type: build_target?.type,
      package: this,
      build_space: this.current_build_space,
      build_target: build_target,
      executable: build_target?.exec_path,
      id: test_id,
      file: source_file,
      line: line_number,
    };

    for (let old_entry of this.package_test_suite.children) {
      if (isTemplateEqual(old_entry.id, test_id)) {
        let changed = this.updateObject(old_entry, new_values);
        return [old_entry, changed];
      }
    }

    if (only_update_existing) {
      return undefined;
    }

    let executable: WorkspaceTestInterface = {
      children: [],
      is_parameterized: false,
      resolvable: true,
      ...new_values
    };

    this.package_test_suite.children.push(executable);

    return [executable, true];
  }

  updateTestFixtureImpl(
    executable: WorkspaceTestInterface,
    test_id: WorkspaceTestIdentifierTemplate,
    build_target: IBuildTarget,
    source_file: string,
    line_number: number,
    is_parameterized: boolean,
    instances: WorkspaceTestParameters[],
    only_update_existing: boolean = false
  ): [WorkspaceTestInterface, boolean] {
    const new_values = {
      package: this,
      build_space: this.current_build_space,
      build_target: build_target,
      executable: build_target?.exec_path,
      id: test_id,
      file: source_file,
      line: line_number,
      is_parameterized: is_parameterized,
      instances: instances,
    };

    for (let old_entry of executable.children) {
      if (isTemplateEqual(old_entry.id, test_id)) {
        // logger.silly("Update existing fixture", old_entry.id);
        let changed = this.updateObject(old_entry, new_values);
        return [old_entry, true];
      }
    }

    if (only_update_existing) {
      return undefined;
    }

    let fixture: WorkspaceTestInterface = {
      type: 'gtest',
      children: [],
      resolvable: false,
      ...new_values
    };

    executable.children.push(fixture);

    return [fixture, true];
  }

  updateTestCaseImpl(
    test_ifc: WorkspaceTestInterface,
    test_id: WorkspaceTestIdentifierTemplate,
    build_target: IBuildTarget,
    source_file: string,
    line_number: number,
    is_parameterized: boolean,
    instances: WorkspaceTestParameters[],
    only_update_existing: boolean = false
  ): [WorkspaceTestInterface, boolean] {
    const new_values = {
      package: this,
      build_space: this.current_build_space,
      build_target: build_target,
      executable: build_target?.exec_path,
      type: build_target?.type,
      id: test_id,
      file: source_file,
      line: line_number,
      is_parameterized: is_parameterized,
      instances: instances,
    };

    for (let old_entry of test_ifc.children) {
      if (isTemplateEqual(old_entry.id, test_id)) {
        let changed = this.updateObject(old_entry, new_values);
        return [old_entry, changed];
      }
    }

    if (only_update_existing) {
      return undefined;
    }

    let test_case: WorkspaceTestInterface = {
      resolvable: false,
      children: [],
      ...new_values
    };

    test_ifc.children.push(test_case);

    return [test_case, true];
  }


  updateObject(old_values: any, new_values: any): boolean {
    let changed = false;
    for (let key in new_values) {
      if (new_values[key] !== undefined && old_values[key] !== new_values[key]) {
        if (Array.isArray(old_values[key])) {
          if (old_values[key] !== new_values[key]) {
            old_values[key] = new_values[key];
            changed = true;
          }
        } else if (typeof old_values[key] === 'object') {
          if (this.updateObject(old_values[key], new_values[key])) {
            changed = true;
          }
        } else {
          old_values[key] = new_values[key];
        }
        changed = true;
      }
    }
    return changed;
  }

}