
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as glob from 'fast-glob';
import * as xml from 'fast-xml-parser';
import * as path from 'path';

import { runBashCommand } from './catkin_command';
import { CatkinTestCase, CatkinTestExecutable, CatkinTestSuite } from './catkin_test_types';
import { CatkinWorkspace } from './catkin_workspace';

export type TestType = "unknown" | "gtest" | "generic" | "suite";

export class BuildTarget {
  constructor(public cmake_target: string,
    public exec_path: string,
    public type: TestType) { }
}

export class CatkinPackage {

  public build_space?: fs.PathLike;

  public name: string;
  public package_xml: any;

  public has_tests: boolean;
  public test_build_targets: BuildTarget[] = [];

  public path: string;
  public relative_path: fs.PathLike;
  public cmakelists_path: string;

  private constructor(
    public package_xml_path: fs.PathLike,
    public workspace: CatkinWorkspace) {

    this.package_xml = xml.parse(fs.readFileSync(package_xml_path).toString());
    if (this.package_xml === undefined || this.package_xml === "" ||
      !('package' in this.package_xml)) {
      throw Error(`Invalid package xml file: ${package_xml_path}`);
    }
    this.name = this.package_xml['package']['name'];

    let src_path = path.dirname(package_xml_path.toString());
    this.relative_path = src_path.replace(vscode.workspace.rootPath + '/', "");
    this.cmakelists_path = path.join(src_path, "CMakeLists.txt");

    this.has_tests = false;
  }

  public static async loadFromXML(package_xml_path: fs.PathLike, workspace: CatkinWorkspace) {
    let instance = new CatkinPackage(package_xml_path, workspace);
    await instance.parseCmakeListsForTests();
    return instance;
  }

  public static async getNameFromPackageXML(package_xml_path: fs.PathLike) {
    try {
      let package_xml = xml.parse(fs.readFileSync(package_xml_path).toString());
      return package_xml['package']['name'];
    } catch (err) {
      return null;
    }
  }

  private async parseCmakeListsForTests() {
    let config = vscode.workspace.getConfiguration('catkin_tools');
    let test_regexes = [];
    for (let expr of config['gtestMacroRegex']) {
      test_regexes.push(new RegExp(`.*(${expr})`));
    }

    this.has_tests = false;
    let cmake_files = await glob.async(
      [`${vscode.workspace.rootPath}/${this.relative_path}/**/CMakeLists.txt`]
    );
    for (let cmake_file of cmake_files) {
      let data = fs.readFileSync(cmake_file.toString());
      let cmake = data.toString();
      for (let test_regex of test_regexes) {
        for (let row of cmake.split('\n')) {
          let tests = row.match(test_regex);
          if (tests) {
            this.has_tests = true;
          }
        }
      }
    }
  }

  public async loadTests(build_dir: String, devel_dir: String, outline_only: boolean):
    Promise<CatkinTestSuite> {
    let build_space = `${build_dir}/${this.name}`;

    if (!this.has_tests) {
      throw Error("No tests in package");
    }

    // discover build targets:
    // ctest -N 
    //  ->
    // _ctest_csapex_math_tests_gtest_csapex_math_tests
    //                                `---------------`

    // find gtest build targets
    this.test_build_targets = [];
    try {
      let output = await runBashCommand('ctest -N -V', build_space);
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
          this.test_build_targets.push(target);
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
                if(exe.length === 0) {
                  // assume that the executable has the same name as the cmake target
                  exe = target;
                }
                this.test_build_targets.push({
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

    // create the test suite
    let pkg_suite: CatkinTestSuite = {
      type: 'suite',
      package: this,
      build_space: build_space,
      build_target: 'run_tests',
      global_build_dir: build_dir,
      global_devel_dir: devel_dir,
      filter: undefined,
      info: {
        type: 'suite',
        id: `package_${this.name}`,
        label: this.name,
        // file: this.cmakelists_path,
        children: []
      },
      executables: null
    };

    // generate a list of all tests in this target
    for (let build_target of this.test_build_targets) {
      // create the executable
      let test_exec: CatkinTestExecutable = {
        type: build_target.type,
        package: this,
        build_space: build_space,
        build_target: build_target.cmake_target,
        global_build_dir: build_dir,
        global_devel_dir: devel_dir,
        executable: build_target.exec_path,
        filter: build_target.type === 'generic' ? undefined : "\\*",
        info: {
          type: 'suite',
          id: `exec_${build_target.cmake_target}`,
          label: build_target.cmake_target,
          children: []
        },
        tests: []
      };

      if (!outline_only) {
        try {
          // try to extract test names, if the target is compiled
          let cmd = await this.workspace.makeCommand(`${build_target.exec_path} --gtest_list_tests`);
          let output = await runBashCommand(cmd, build_space);
          for (let line of output.stdout.split('\n')) {
            let match = line.match(/^([^\s]+)\.\s*$/);
            if (match) {
              let test_label = match[1];
              let test_case: CatkinTestCase = {
                package: this,
                build_space: build_space,
                build_target: build_target.cmake_target,
                global_build_dir: build_dir,
                global_devel_dir: devel_dir,
                executable: build_target.exec_path,
                filter: build_target.type === 'generic' ? undefined : `${test_label}.\\*`,
                type: build_target.type,
                info: {
                  type: 'test',
                  id: `test_${build_target.cmake_target}_${test_label}`,
                  label: test_label
                }
              };
              test_exec.tests.push(test_case);
              test_exec.info.children.push(test_case.info);
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
      if (test_exec.tests.length === 0) {
        let test_case: CatkinTestCase = {
          type: build_target.type,
          package: this,
          build_space: build_space,
          build_target: build_target.cmake_target,
          global_build_dir: build_dir,
          global_devel_dir: devel_dir,
          executable: build_target.exec_path,
          filter: build_target.type === 'generic' ? undefined : `\\*`,
          info: {
            type: 'test',
            id: `test_unknown_${build_target.cmake_target}`,
            label: "Run All Tests",
            description: "(no information about test cases)"
          }
        };
        test_exec.tests.push(test_case);
        test_exec.info.children.push(test_case.info);
      }

      if (pkg_suite.executables === null) {
        pkg_suite.executables = [];
      }
      pkg_suite.executables.push(test_exec);
      pkg_suite.info.children.push(test_exec.info);
    }
    return pkg_suite;
  }
}
