
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as glob from 'fast-glob';
import * as xml from 'fast-xml-parser';
import * as path from 'path';

import { runShellCommand, runCommand } from './catkin_command';
import { CatkinTestCase, CatkinTestExecutable, CatkinTestSuite, CatkinTestFixture } from './catkin_test_types';
import { CatkinWorkspace } from './catkin_workspace';
import { GTestSuite, parsePackageForTests, skimCmakeListsForTests } from './catkin_cmake_parser';
import { wrapArray } from './utils';

export type TestType = "unknown" | "gtest" | "generic" | "suite";

export class BuildTarget {
  constructor(public cmake_target: string,
    public exec_path: string,
    public type: TestType) { }
}

export class CatkinPackage {
  public build_space?: fs.PathLike;

  public name: string;
  public dependencies: string[];
  public dependees: string[];
  public package_xml: any;

  public has_tests: boolean;
  public tests_loaded: boolean;

  public path: string;
  public relative_path: fs.PathLike;
  public absolute_path: fs.PathLike;
  public cmakelists_path: string;

  private constructor(
    public package_xml_path: fs.PathLike,
    public workspace: CatkinWorkspace) {

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

  public static async loadFromXML(package_xml_path: fs.PathLike, workspace: CatkinWorkspace) {
    let instance = new CatkinPackage(package_xml_path, workspace);
    let package_xml_loaded = await instance.loadPackageXml();
    instance.has_tests = await skimCmakeListsForTests(instance);
    return instance;
  }

  public getName(): string {
    return this.name;
  }

  public getAbsolutePath(): fs.PathLike {
    if (this.absolute_path === undefined) {
      let src_path = path.dirname(this.package_xml_path.toString());
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
    const src = src_dir !== undefined ? src_dir : await this.workspace.getSrcDir();
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
    const compile_commands = path.join(build_space, "compile_commands.json");
    return fs.existsSync(compile_commands);
  }

  public async iteratePossibleSourceFiles(header_file: vscode.Uri, async_filter: (uri: vscode.Uri) => Promise<boolean>): Promise<boolean> {
    const include_prefix = "/include/";
    const include_start_pos = header_file.fsPath.lastIndexOf(include_prefix);
    if (include_start_pos < 0) {
      console.error(`Could not find include folder in ${header_file.fsPath.toString()}`);
      return false;
    }
    const include_relpath = header_file.fsPath.substr(include_start_pos + include_prefix.length);
    let sources = await glob.async(
      [`${this.getAbsolutePath()}/**/*.(c|cc|cpp|cxx)`]
    );
    for (let source of sources) {
      const code_raw = await fs.promises.readFile(source.toString());
      const code = code_raw.toString().split("\n");
      for (let line of code) {
        if (line.indexOf("#") >= 0 && line.indexOf("include") > 0) {
          if (line.indexOf(include_relpath) > 0) {
            if (await async_filter(vscode.Uri.file(source.toString()))) {
              console.log(source);
              console.log(line);
              return true;
            }
          }
        }
      }
    }
  }


  public async loadTests(build_dir: String, devel_dir: String, outline_only: boolean):
    Promise<CatkinTestSuite> {
    this.build_space = `${build_dir}/${this.name}`;

    if (!this.has_tests) {
      throw Error("No tests in package");
    }

    // discover build targets:
    // ctest -N
    //  ->
    // _ctest_csapex_math_tests_gtest_csapex_math_tests
    //                                `---------------`

    // find gtest build targets
    let test_build_targets = [];
    if (!outline_only) {
      try {
        let output = await runCommand('ctest', ['-N', '-V'], [], this.build_space);
        console.log(output.stdout);
        let current_executable: string = undefined;
        let current_test_type: TestType = undefined;
        let missing_exe = undefined;
        for (let line of output.stdout.split('\n')) {

          let test_command = line.match(/[0-9]+: Test command:\s+(.*)$/);
          if (test_command !== null) {
            if (line.indexOf('catkin_generated') > 0) {
              let python_gtest_wrapper = line.match(/[0-9]+: Test command:\s+.*env_cached.sh\s*.*"([^"]+\s+--gtest_output=[^"]+)".*/);
              if (python_gtest_wrapper !== null) {
                current_executable = python_gtest_wrapper[1];
                current_test_type = 'gtest';
              } else {
                current_executable = test_command[1];
                current_test_type = 'unknown';
              }
            } else {
              let gtest_output = line.match(/[0-9]+: Test command:\s+"([^"]+\s+--gtest_output=[^"]+)".*/);
              if (gtest_output !== null) {
                current_executable = gtest_output[1];
                current_test_type = 'gtest';
              } else {
                current_executable = test_command[1];
                current_test_type = 'unknown';
              }
            }
            continue;
          }
          // GTest target test
          let gtest_match = line.match(/ Test\s+#.*gtest_(.*)/);
          if (gtest_match) {
            if (current_executable === undefined) {
              continue;
            }
            let target: BuildTarget = {
              cmake_target: gtest_match[1],
              exec_path: current_executable,
              type: current_test_type
            };
            test_build_targets.push(target);
          } else {
            if (line.indexOf('catkin_generated') > 0) {
              continue;
            }
            // general CTest target test
            let missing_exec_match = line.match(/Could not find executable\s+([^\s]+)/);
            if (missing_exec_match) {
              missing_exe = missing_exec_match[1];
            } else {
              let ctest_match = line.match(/\s+Test\s+#[0-9]+:\s+([^\s]+)/);
              if (ctest_match) {
                if (current_executable === undefined) {
                  continue;
                }
                let target = ctest_match[1];
                if (target.length > 1 && target !== 'cmake') {
                  let cmd = current_executable;
                  if (missing_exe !== undefined) {
                    cmd = missing_exe + " " + cmd;
                  }

                  // determine executable
                  // trip quotes
                  let stripped_exe = current_executable.replace(/"/g, "");
                  // strip --gtest_output if present
                  stripped_exe = stripped_exe.replace(/--gtest_output\S+/g, "");
                  // then take the first argument when splitting with whitespace
                  let exe = path.basename(stripped_exe.split(/\s/)[0]);
                  if (exe.length === 0) {
                    // assume that the executable has the same name as the cmake target
                    exe = target;
                  }
                  test_build_targets.push({
                    cmake_target: exe,
                    exec_path: cmd,
                    type: current_test_type
                  });
                }
                missing_exe = undefined;
              }
            }
          }
        }
      } catch (err) {
        console.log(`Cannot call ctest for ${this.name}`);
        throw err;
      }
    }

    // create the test suite
    let pkg_suite: CatkinTestSuite = {
      type: 'suite',
      package: this,
      build_space: this.build_space,
      build_target: 'run_tests',
      global_build_dir: build_dir,
      global_devel_dir: devel_dir,
      filter: undefined,
      test_build_targets: test_build_targets,
      info: {
        type: test_build_targets.length === 0 ? 'test' : 'suite',
        id: `package_${this.name}`,
        debuggable: false,
        label: this.name,
        file: this.cmakelists_path,
        children: [],
        description: test_build_targets.length === 0 ? "(unloaded)" : "",
        tooltip: test_build_targets.length === 0 ?
          `Unloaded package test for ${this.name}. Run to load the test.` :
          `Package test for ${this.name}.`,
      },
      executables: null
    };

    let gtest_build_targets: GTestSuite;
    if (!outline_only) {
      try {
        gtest_build_targets = await parsePackageForTests(this);
      } catch (err) {
        console.log(`Cannot determine gtest details: ${err}`);
      }
    }
    if (gtest_build_targets === undefined) {
      // default to an empty suite
      gtest_build_targets = new GTestSuite([]);
    }

    // generate a list of all tests in this target
    for (let build_target of test_build_targets) {
      let matching_source_file: string;
      let matching_line: number;
      if (!outline_only) {
        let gtest_build_target = gtest_build_targets.getBuildTarget(build_target.cmake_target);
        if (gtest_build_target !== undefined) {
          matching_source_file = path.join(this.getAbsolutePath().toString(), gtest_build_target.package_relative_file_path.toString());
          matching_line = gtest_build_target.line;
        }
      }

      // create the executable
      let test_exec: CatkinTestExecutable = {
        type: build_target.type,
        package: this,
        build_space: this.build_space,
        build_target: build_target.cmake_target,
        global_build_dir: build_dir,
        global_devel_dir: devel_dir,
        executable: build_target.exec_path,
        filter: build_target.type === 'generic' ? undefined : "*",
        info: {
          type: 'suite',
          id: `exec_${build_target.cmake_target}`,
          label: build_target.cmake_target,
          children: [],
          tooltip: `Executable test ${build_target.cmake_target}.`,
          file: matching_source_file,
          line: matching_line
        },
        fixtures: []
      };

      if (!outline_only) {
        try {
          // try to extract test names, if the target is compiled
          let cmd = await this.workspace.makeCommand(`${build_target.exec_path} --gtest_list_tests`);
          let output = await runShellCommand(cmd, this.build_space);
          let current_fixture_label: string = null;
          let current_test_suite: string = null;
          for (let line of output.stdout.split('\n')) {
            let fixture_match = line.match(/^([^\s]+)\.\s*$/);
            if (fixture_match) {
              current_fixture_label = fixture_match[1];
              if (current_fixture_label.indexOf('/') > 0) {
                // This is an instanced test of the form  <module_name>/<test_name>
                // For now we ignore the module name
                // TODO: support multiple instance of a test module
                current_test_suite = current_fixture_label.substr(current_fixture_label.indexOf('/') + 1);
              } else {
                current_test_suite = current_fixture_label;
              }

              let matching_source_file: string;
              let matching_line: number;
              let [existing_fixture, source_file, _] = gtest_build_targets.getFixture(current_fixture_label);
              if (existing_fixture !== undefined) {
                matching_source_file = path.join(this.getAbsolutePath().toString(), source_file.package_relative_file_path.toString());
                matching_line = existing_fixture.line;
              }
              test_exec.fixtures.push({
                type: 'gtest',
                package: this,
                build_space: this.build_space,
                build_target: build_target.cmake_target,
                global_build_dir: build_dir,
                global_devel_dir: devel_dir,
                executable: build_target.exec_path,
                filter: build_target.type === 'generic' ? undefined : `${current_fixture_label}.*`,
                info: {
                  type: 'suite',
                  id: `fixture_${build_target.cmake_target}_${current_fixture_label}`,
                  label: current_fixture_label,
                  children: [],
                  tooltip: `Test fixture ${build_target.cmake_target}::${current_fixture_label}.`,
                  file: matching_source_file,
                  line: matching_line
                },
                cases: []
              });
              test_exec.info.children.push(test_exec.fixtures[test_exec.fixtures.length - 1].info);

            } else if (current_fixture_label !== null && line.length > 0) {
              let test_label = line.substr(2);
              let test_name = test_label;
              let test_description = undefined;
              if (test_label.indexOf("#") > 0) {
                // This is an instanced test of the form  <test_name>/<instance>#<parameters>
                let parts = test_label.split("#");
                test_label = parts[0].trim();
                test_description = parts[1].trim();
                const test_parts = parts[0].split('/');
                test_name = test_parts[0].trim();
              }

              let matching_source_file: string;
              let matching_line: number;
              let [existing_test_case, _, source_file, __] = gtest_build_targets.getTestCase(current_test_suite, test_name);
              if (existing_test_case !== undefined) {
                matching_source_file = path.join(this.getAbsolutePath().toString(), source_file.package_relative_file_path.toString());
                matching_line = existing_test_case.line;
              }
              let test_case: CatkinTestCase = {
                package: this,
                build_space: this.build_space,
                build_target: build_target.cmake_target,
                global_build_dir: build_dir,
                global_devel_dir: devel_dir,
                executable: build_target.exec_path,
                filter: build_target.type === 'generic' ? undefined : `${current_fixture_label}.${test_label}`,
                type: build_target.type,
                info: {
                  type: 'test',
                  id: `test_${build_target.cmake_target}_${current_fixture_label}_${test_label}`,
                  description: test_description,
                  label: `${current_fixture_label}::${test_label}`,
                  tooltip: `Test case ${build_target.cmake_target}::${current_fixture_label}::${test_label}.`,
                  file: matching_source_file,
                  line: matching_line
                }
              };
              let fixture = test_exec.fixtures[test_exec.fixtures.length - 1];
              fixture.cases.push(test_case);
              fixture.info.children.push(fixture.cases[fixture.cases.length - 1].info);
            }
          }
        } catch (err) {
          // if the target is not compiled, do not add filters
          if (err.error !== undefined) {
            console.log(`Cannot determine ${build_target.exec_path}'s tests: ${err.error.message}`);
          } else {
            console.log(`Cannot determine ${build_target.exec_path}'s tests: ${err}`);
          }
        }
      }
      if (test_exec.fixtures.length === 0) {
        let test_case: CatkinTestFixture = {
          type: build_target.type,
          package: this,
          build_space: this.build_space,
          build_target: build_target.cmake_target,
          global_build_dir: build_dir,
          global_devel_dir: devel_dir,
          executable: build_target.exec_path,
          cases: [],
          filter: build_target.type === 'generic' ? undefined : `*`,
          info: {
            type: 'suite',
            id: `fixture_unknown_${build_target.cmake_target}`,
            label: "Run All Tests",
            children: [],
            description: "(no information about test cases)",
            tooltip: `Unknown fixture. Run to detect tests.`,
          }
        };
        test_exec.fixtures.push(test_case);
        test_exec.info.children.push(test_case.info);
      }

      if (pkg_suite.executables === null) {
        pkg_suite.executables = [];
      }
      pkg_suite.executables.push(test_exec);
      if (pkg_suite.info.type === 'suite') {
        pkg_suite.info.children.push(test_exec.info);
      }
    }

    if (!outline_only) {
      this.tests_loaded = true;
    }

    return pkg_suite;
  }
}
