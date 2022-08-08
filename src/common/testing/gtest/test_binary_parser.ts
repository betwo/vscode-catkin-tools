import * as path from 'path';

import { IBuildTarget, WorkspaceTestInterface, WorkspaceTestIdentifierTemplate, WorkspaceTestParameters, WorkspaceFixtureParameters } from "vscode-catkin-tools-api";
import { logger } from '../../logging';
import { Package } from '../../package';
import { runShellCommand } from '../../shell_command';

export async function updateTestsFromExecutable(
  build_target: IBuildTarget,
  pkg: Package,
  query_for_cases: boolean
): Promise<WorkspaceTestInterface[]> {
  // create the executable
  const test_id = new WorkspaceTestIdentifierTemplate(`exec_${build_target.cmake_target}`);

  const executable_source_file = undefined;
  const executable_line_number = undefined;

  let changed_tests = [];
  let [test_exec, exec_was_changed]: [WorkspaceTestInterface, boolean] = pkg.updateTestExecutableImpl(
    test_id, build_target, executable_source_file, executable_line_number, true);
  if(exec_was_changed) {
    console.log("EXEC WAS CHANGED");
    changed_tests.push(test_exec);
  }

  if (query_for_cases) {
    try {
      // try to extract test names, if the target is compiled
      const cmd = await pkg.workspace.makeCommand(`${build_target.exec_path} --gtest_list_tests`);
      const output = await runShellCommand(cmd, pkg.current_build_space);

      const parsed_executable = parseGTestBinaryOutput(output.stdout, build_target);

      pkg.updateTestExecutable(parsed_executable, true, true);

    } catch (err) {
      // if the target is not compiled, do not add filters
      if (err.error !== undefined) {
        logger.error(`Cannot determine ${build_target.exec_path}'s tests: ${err.error.message}`);
      } else {
        logger.error(`Cannot determine ${build_target.exec_path}'s tests: ${err}`);
      }
    }
  }
  return changed_tests;
}

function areFixtureParametersEqual(left: WorkspaceTestParameters, right: WorkspaceTestParameters) {
  return left.fixture.instance === right.fixture.instance &&
    left.fixture.generator === right.fixture.generator &&
    left.fixture.description === right.fixture.description;
}

export function parseGTestBinaryOutput(
  output: String,
  build_target: IBuildTarget,
): WorkspaceTestInterface {
  let test_fixtures: WorkspaceTestInterface[] = [];

  let current_fixture_prefix: string = null;
  let current_fixture_description: string = null;
  let current_fixture: WorkspaceTestInterface;
  let current_fixture_parameters: WorkspaceFixtureParameters;
  // let current_fixture_instance: WorkspaceFixtureParameters;
  for (let line of output.split('\n')) {
    if (line.length === 0) {
      continue;
    }

    // The following test types can be present:

    // INSTANTIATE_TYPED_TEST_SUITE_P:
    // To distinguish different instances of the pattern, the first argument to the
    // INSTANTIATE_TYPED_TEST_SUITE_P macro is a prefix that will be added to the actual test suite name.
    // Remember to pick unique prefixes for different instances.
    //
    // <unique-name-for-instatiation-of-test-suite>/<name-of-test-pattern>/<parameter-generator>.

    // INSTANTIATE_TEST_SUITE_P:
    // You can instantiate a test pattern more than once, so to distinguish different instances of the pattern,
    // the instantiation name is added as a prefix to the actual test suite name.
    // Remember to pick unique prefixes for different instantiations.
    //
    // <unique-name-for-instatiation-of-test-suite>/<name-of-test-pattern>/<parameter-generator>.

    // <fixture>.
    // <fixture>/<parameter-generator>.
    // <instance-name>/<fixture>/<parameter-generator>.
    // <instance-name>/<fixture>/<parameter-generator>. ... # TypeParam = ...
    // <instance-name>/[<fixture>/ | <custom-type-mapping>]<parameter-generator>. ... # TypeParam = ...


    // <fixture>.<test-case>
    // <fixture>/<parameter-generator>.<test-case>
    // <instance-name>/<fixture>/<parameter-generator>.<test-case>
    // <instance-name>/[<fixture>/ | <custom-type-mapping>]<parameter-generator>.<test-case>
    // <instance-name>/<fixture>.<test-case>/<parameter-generator>

    let fixture_match = line.match(/^([^\s]+\.)\s*(#\s*(.*))?$/);
    if (fixture_match) {
      current_fixture_prefix = fixture_match[1];
      current_fixture_description = fixture_match[3];
      // current_fixture = undefined;
      continue;
    }
    let test = line.match(/^\s+.+/);
    if (!test) {
      continue;
    }

    let test_label = line.trimStart();
    const full_test_label = `${current_fixture_prefix}${test_label}`;
    let [id_template, id_parameters] = parseGTestIdentifier(full_test_label);

    let fixture_is_parameterized = id_parameters.fixture.generator !== undefined || id_parameters.fixture.instance !== undefined;
    if (fixture_is_parameterized) {
      id_parameters.fixture.description = current_fixture_description;
    }

    const full_fixture_id = new WorkspaceTestIdentifierTemplate(`fixture_${build_target.cmake_target}`, id_template.fixture);
    if ((current_fixture === undefined) || (current_fixture.id.fixture !== id_template.fixture)) {
      // logger.silly("NEW FIXTURE:", id_template.fixture, "OLD FIXTURE:", current_fixture?.id.fixture);
      current_fixture = {
        id: full_fixture_id,
        type: 'suite',
        children: [],
        is_parameterized: fixture_is_parameterized,
        instances: fixture_is_parameterized ?
          [{
            fixture: {
              instance: id_parameters.fixture.instance,
              generator: id_parameters.fixture.generator,
              description: current_fixture_description
            }
          }] :
          [{ fixture: { description: current_fixture_description } }],
        build_target: build_target,
      };

      test_fixtures.push(current_fixture);

    } else {
      if (fixture_is_parameterized) {
        let exists_already = false;
        for (const existing_instance of current_fixture.instances) {
          // logger.silly("check fixture:", existing_instance, id_parameters);
          if (areFixtureParametersEqual(existing_instance, id_parameters)) {
            // logger.warn(`ID PARAMETERS ALREADY PRESENT:`, id_parameters);
            exists_already = true;
            break;
          }
        }
        if (!exists_already) {
          // logger.warn(`PUSHING FIXTURE:`, id_parameters);
          current_fixture.instances.push({
            fixture: {
              instance: id_parameters.fixture.instance,
              generator: id_parameters.fixture.generator,
              description: current_fixture_description
            }
          });
        }
      }
    }
    current_fixture_parameters = {
      instance: id_parameters.fixture.instance,
      generator: id_parameters.fixture.generator,
      description: current_fixture_description
    };

    let test_description = undefined;
    if (test_label.indexOf("#") > 0) {
      // package is an instanced test of the form  <test_name>/<instance>#<parameters>
      let parts = test_label.split("#");
      test_label = parts[0].trim();
      test_description = parts[1].trim();
    }

    let test_is_parameterized = id_parameters.generator !== undefined;

    // const current_fixture_parameters = current_fixture.instances[current_fixture.instances.length - 1];
    let existing_test = current_fixture.children.find(e => e.id.test === id_template.test);
    if ((existing_test === undefined) || (existing_test.id.test !== id_template.test)) {
      const full_test_id = id_template;
      full_test_id.prefix = `test_${build_target.cmake_target}`;
      // logger.silly("NEW TEST", existing_test?.id.test, "vs", id_template.test, "=>", full_test_id.evaluate(id_parameters));
      existing_test = {
        id: full_test_id,
        type: 'gtest',
        children: [],
        build_target: build_target,
        is_parameterized: test_is_parameterized,
        instances: test_is_parameterized ? [{
          fixture: {
            instance: current_fixture_parameters.instance,
            generator: current_fixture_parameters.generator,
            description: current_fixture_parameters.description
          },
          instance: id_parameters.instance,
          generator: id_parameters.generator,
          description: test_description
        }] : [{ description: test_description }],
      };

      current_fixture.children.push(existing_test);

    } else {
      if (test_is_parameterized) {
        let exists_already = false;

        if (!exists_already) {
          existing_test.instances.push({
            fixture: {
              instance: current_fixture_parameters.instance,
              generator: current_fixture_parameters.generator,
              description: current_fixture_parameters.description
            },
            instance: id_parameters.instance,
            generator: id_parameters.generator,
            description: test_description
          });
        }
      }
    }
  }

  const parsed_executable: WorkspaceTestInterface = {
    type: 'suite',
    build_target: build_target,
    id: new WorkspaceTestIdentifierTemplate(`exec_${build_target.cmake_target}`),
    is_parameterized: false,
    file: undefined,
    line: undefined,
    children: test_fixtures,
  };

  return parsed_executable;
}

export function parseGTestIdentifier(full_test_label: string): [WorkspaceTestIdentifierTemplate, WorkspaceTestParameters] {
  let test_id_match = full_test_label.match(/^(?<full_fixture>[^\s]+)\.(?<full_case>[^\s\.]+)\s*(#.*)?$/);
  if (test_id_match === null) {
    throw Error(`Cannot parse GTest identifier: ${full_test_label}`);
  }
  const full_fixture_label = test_id_match.groups["full_fixture"];
  const full_case_label = test_id_match.groups["full_case"];

  let [fixture_name, fixture_parameters] = parseGTestFixtureIdentifier(full_fixture_label);
  let [case_name, case_parameters] = parseGTestCaseIdentifier(full_case_label);

  return [new WorkspaceTestIdentifierTemplate(undefined, fixture_name, case_name), {
    fixture: fixture_parameters,
    instance: case_parameters.instance,
    generator: case_parameters.generator,
  }];
}

export function parseGTestFixtureIdentifier(full_fixture_label: string): [string, WorkspaceFixtureParameters] {
  // parse fixture
  // possible values:
  //                   <fixture>
  //                   <fixture>/ <parameter-generator>
  // <instance-name> / <fixture>/ <parameter-generator>
  //                   <fixture>/ <custom-type-mapping><parameter-generator>
  // <instance-name> / <fixture>
  let generator_match = full_fixture_label.match(/^(?<instanced_name>.+)\/(?<generator>[^\/]*\d+)/);
  if (generator_match !== null) {
    let fixture_label_match = generator_match.groups["instanced_name"].match(/^((?<instance>[^\s]+)\/)?(?<name>.+)/);
    let name = fixture_label_match.groups["name"];
    if (name.endsWith("/")) {
      name = name.substring(0, name.length - 1);
    }
    const instance = fixture_label_match.groups["instance"];
    const generator = generator_match.groups["generator"];
    return [name, { instance: instance, generator: generator }];
  }

  let fixture_label_match = full_fixture_label.match(/^((?<instance>[^\s]+)\/)?(?<name>.+)/);
  return [fixture_label_match.groups["name"], { instance: fixture_label_match.groups["instance"] }];
}

export function parseGTestCaseIdentifier(full_case_label: string): [string, WorkspaceTestParameters] {
  // parse test case
  // possible values:
  //                   <case>
  //                   <case>/ <parameter-generator>
  let generator_match = full_case_label.match(/^(?<name>.+)\/(?<generator>[^\/]*\d+)/);
  if (generator_match !== null) {
    let fixture_label_match = generator_match.groups["name"].match(/^(?<name>.+)/);
    let name = fixture_label_match.groups["name"];
    if (name.endsWith("/")) {
      name = name.substring(0, name.length - 1);
    }
    const generator = generator_match.groups["generator"];
    return [name, { generator: generator }];
  }

  return [full_case_label, {}];
}
