import { expect } from 'chai';
import { IBuildTarget } from 'vscode-catkin-tools-api';
import { expectIntegrationTestSuiteCorrect } from '../../../test/integration/integration_test_suite';
import { parseGTestBinaryOutput, parseGTestCaseIdentifier, parseGTestFixtureIdentifier, parseGTestIdentifier } from './test_binary_parser';

describe('GTest Fixture Id Parser', () => {
  it("Fixture is parsed correctly", async () => {
    const [id, parameters] = parseGTestFixtureIdentifier("Fixture");
    expect(id).to.equal("Fixture");
    expect(parameters.instance).to.equal(undefined);
    expect(parameters.generator).to.equal(undefined);
    // expect(id.name_separator).to.equal("/");
  });
  it("Fixture with generator is parsed correctly", async () => {
    const [id, parameters] = parseGTestFixtureIdentifier("Fixture/0");
    expect(id).to.equal("Fixture");
    expect(parameters.instance).to.equal(undefined);
    expect(parameters.generator).to.equal("0");
    // expect(id.name_separator).to.equal("/");
  });
  it("Instanced fixture is parsed correctly", async () => {
    const [id, parameters] = parseGTestFixtureIdentifier("Instance/Fixture");
    expect(id).to.equal("Fixture");
    expect(parameters.instance).to.equal("Instance");
    expect(parameters.generator).to.equal(undefined);
    // expect(id.name_separator).to.equal("/");
  });
  it("Instanced fixture with generator is parsed correctly", async () => {
    const [id, parameters] = parseGTestFixtureIdentifier("Instance/Fixture/0");
    expect(id).to.equal("Fixture");
    expect(parameters.instance).to.equal("Instance");
    expect(parameters.generator).to.equal("0");
    // expect(id.name_separator).to.equal("/");
  });
  it("Fixture with mapping is parsed correctly", async () => {
    const [id, parameters] = parseGTestFixtureIdentifier("Fixture/Mapping::0");
    expect(id).to.equal("Fixture");
    expect(parameters.instance).to.equal(undefined);
    expect(parameters.generator).to.equal("Mapping::0");
    // expect(id.name_separator).to.equal(undefined);
  });
});

describe('GTest Case Id Parser', () => {
  it("Case is parsed correctly", async () => {
    const [id, parameters] = parseGTestCaseIdentifier("Case");
    expect(id).to.equal("Case");
    expect(parameters.generator).to.equal(undefined);
    // expect(id.name_separator).to.equal("/");
  });
  it("Case with generator is parsed correctly", async () => {
    const [id, parameters] = parseGTestCaseIdentifier("Case/0");
    expect(id).to.equal("Case");
    expect(parameters.generator).to.equal("0");
    // expect(id.name_separator).to.equal("/");
  });
  // it("Instanced Case is parsed correctly", async () => {
  //   const [id, parameters] = parseGTestCaseIdentifier("Instance/Case");
  //   expect(id).to.equal("Case");
  //   expect(parameters.test_instance).to.equal("Instance");
  //   expect(parameters.generator).to.equal(undefined);
  //   // expect(id.name_separator).to.equal("/");
  // });
  // it("Instanced Case with generator is parsed correctly", async () => {
  //   const [id, parameters] = parseGTestCaseIdentifier("Instance/Case/0");
  //   expect(id).to.equal("Case");
  //   expect(parameters.test_instance).to.equal("Instance");
  //   expect(parameters.generator).to.equal("0");
  //   // expect(id.name_separator).to.equal("/");
  // });
});

describe('GTest Full Id Parser', () => {
  it("Instanced Suite with case generator is parsed correctly", async () => {
    const [id, parameters] = parseGTestIdentifier("FixtureInstance/TestSuite.Case/0");
    expect(id.fixture).to.equal("TestSuite");
    expect(parameters.fixture.instance).to.equal("FixtureInstance");
    expect(parameters.fixture.generator).to.equal(undefined);
    expect(id.test).to.equal("Case");
    expect(parameters.generator).to.equal("0");
  });

  it("Instanced Case with generator is parsed correctly", async () => {
    const [id, parameters] = parseGTestIdentifier("Fixture/Mapping::0.Case");
    expect(id.fixture).to.equal("Fixture");
    expect(parameters.fixture.instance).to.equal(undefined);
    expect(parameters.fixture.generator).to.equal("Mapping::0");
    expect(id.test).to.equal("Case");
    expect(parameters.generator).to.equal(undefined);
  });

  it("Instanced Suite with case generator is parsed correctly", async () => {
    const [id, parameters] = parseGTestIdentifier("FixtureInstance/TestSuite.Case/0");
    expect(id.fixture).to.equal("TestSuite");
    expect(parameters.fixture.instance).to.equal("FixtureInstance");
    expect(parameters.fixture.generator).to.equal(undefined);
    expect(id.test).to.equal("Case");
    expect(parameters.generator).to.equal("0");
  });
});

describe('GTest Binary Parser', () => {
  it("TEST_F is parsed correctly", async () => {
    const bin = `TestSuite.
  case_a
  case_b
`;
    const fixtures = parseGTestBinaryOutput(bin, createFakeBuildTarget("mockup"));

    expect(fixtures.children.length).to.equal(1);

    let fixture = fixtures.children[0];
    expect(fixture.id.evaluate({})).to.equal("fixture_mockup_TestSuite");
    expect(fixture.line).to.equal(undefined);
    expect(fixture.is_parameterized).to.equal(false);

    expect(fixture.children.length).to.equal(2);
    expect(fixture.children[0].id.evaluate({})).to.equal("test_mockup_TestSuite_case_a");
    expect(fixture.children[0].line).to.equal(undefined);
    expect(fixture.children[1].id.evaluate({})).to.equal("test_mockup_TestSuite_case_b");
    expect(fixture.children[1].line).to.equal(undefined);
  });


  it("TYPED_TEST is parsed correctly", async () => {
    const bin = `TestSuite/0.  # TypeParam = char
  case_a
  case_b
TestSuite/1.  # TypeParam = int
  case_a
  case_b
TestSuite/2.  # TypeParam = unsigned int
  case_a
  case_b
`;
    const fixtures = parseGTestBinaryOutput(bin, createFakeBuildTarget("mockup"));
    const expected_descriptions = ["TypeParam = char", "TypeParam = int", "TypeParam = unsigned int"];

    expect(fixtures.children.length).to.equal(1);
    let fixture = fixtures.children[0];

    for (let instance = 0; instance < 3; ++instance) {
      let fixture_parameters = fixture.instances[instance];
      expect(fixture_parameters.fixture.instance).to.equal(undefined);
      expect(fixture_parameters.fixture.generator).to.equal(`${instance}`);
      expect(fixture_parameters.fixture.description).to.equal(expected_descriptions[instance]);
      expect(fixture_parameters.generator).to.equal(undefined);

      expect(fixture.id.fixture).to.equal(`TestSuite`);
      expect(fixture.id.evaluate(fixture_parameters)).to.equal(`fixture_mockup_TestSuite/${instance}`);

      expect(fixture.line).to.equal(undefined);
      expect(fixture.is_parameterized).to.equal(true);
      expect(fixture.instances.length).to.equal(3);
      expect(fixture.children.length).to.equal(2);

      expect(fixture.children[0].id.evaluate(fixture_parameters)).to.equal(`test_mockup_TestSuite/${instance}_case_a`);
      expect(fixture.children[0].line).to.equal(undefined);
      expect(fixture.children[1].id.evaluate(fixture_parameters)).to.equal(`test_mockup_TestSuite/${instance}_case_b`);
      expect(fixture.children[1].line).to.equal(undefined);
    }
  });


  it("TEST_P is parsed correctly", async () => {
    const bin = `InstanceName/TestSuite.
  case_a/0  # GetParam() = false
  case_a/1  # GetParam() = true
`;
    const fixtures = parseGTestBinaryOutput(bin, createFakeBuildTarget("mockup"));

    expect(fixtures.children.length).to.equal(1);
    let fixture = fixtures.children[0];
    expect(fixture.is_parameterized).to.equal(true);
    expect(fixture.instances).not.to.equal(undefined);
    expect(fixture.instances.length).to.equal(1);

    let fixture_parameters = fixture.instances[0];
    expect(fixture_parameters.fixture.instance).to.equal("InstanceName");
    expect(fixture_parameters.fixture.generator).to.equal(undefined);
    expect(fixture_parameters.generator).to.equal(undefined);

    expect(fixture.id.fixture).to.equal(`TestSuite`);
    expect(fixture.id.evaluate(fixture_parameters)).to.equal(`fixture_mockup_InstanceName/TestSuite`);

    expect(fixture.line).to.equal(undefined);

    expect(fixture.children.length).to.equal(1);
    let test_case = fixture.children[0];
    expect(test_case.is_parameterized).to.equal(true);
    expect(test_case.line).to.equal(undefined);

    const expected_descriptions = ["GetParam() = false", "GetParam() = true"];

    for (let instance = 0; instance < 2; ++instance) {
      let test_case_parameters = test_case.instances[instance];
      expect(test_case_parameters.fixture.instance).to.equal("InstanceName");
      expect(test_case_parameters.fixture.generator).to.equal(undefined);
      expect(test_case_parameters.generator).to.equal(`${instance}`);
      expect(test_case_parameters.description).to.equal(expected_descriptions[instance]);

      expect(test_case.id.evaluate(test_case_parameters)).to.equal(`test_mockup_InstanceName/TestSuite_case_a/${instance}`);
    }
  });


  it("TYPED_TEST_P is parsed correctly", async () => {
    const bin = `InstanceName/TestSuite/0.  # TypeParam = char
  case_a
  case_b
InstanceName/TestSuite/1.  # TypeParam = int
  case_a
  case_b
InstanceName/TestSuite/2.  # TypeParam = unsigned int
  case_a
  case_b
OtherInstanceName/TestSuite/0.  # TypeParam = float
  case_a
  case_b
OtherInstanceName/TestSuite/1.  # TypeParam = double
  case_a
  case_b
`;
    const fixtures = parseGTestBinaryOutput(bin, createFakeBuildTarget("mockup"));
    expect(fixtures.children.length).to.equal(1);
    let fixture = fixtures.children[0];
    expect(fixture.is_parameterized).to.equal(true);
    expect(fixture.instances).not.to.equal(undefined);
    expect(fixture.instances.length).to.equal(5);

    expect(fixture.id.fixture).to.equal(`TestSuite`);
    expect(fixture.line).to.equal(undefined);

    expect(fixture.children.length).to.equal(2);
    expect(fixture.children[0].is_parameterized).to.equal(false);
    expect(fixture.children[0].line).to.equal(undefined);
    expect(fixture.children[1].is_parameterized).to.equal(false);
    expect(fixture.children[1].line).to.equal(undefined);

    for (let i = 0; i < 3; ++i) {
      let instance_1_params = fixture.instances[i];
      expect(instance_1_params.fixture.instance).to.equal("InstanceName");
      expect(instance_1_params.fixture.generator).to.equal(`${i}`);
      expect(instance_1_params.generator).to.equal(undefined);

      expect(fixture.id.evaluate(instance_1_params)).to.equal(`fixture_mockup_InstanceName/TestSuite/${i}`);
      expect(fixture.children[0].id.evaluate(instance_1_params)).to.equal(`test_mockup_InstanceName/TestSuite/${i}_case_a`);
      expect(fixture.children[1].id.evaluate(instance_1_params)).to.equal(`test_mockup_InstanceName/TestSuite/${i}_case_b`);
    }

    for (let i = 0; i < 2; ++i) {
      let instance_2_params = fixture.instances[3 + i];
      expect(instance_2_params.fixture.instance).to.equal("OtherInstanceName");
      expect(instance_2_params.fixture.generator).to.equal(`${i}`);
      expect(instance_2_params.generator).to.equal(undefined);

      expect(fixture.id.evaluate(instance_2_params)).to.equal(`fixture_mockup_OtherInstanceName/TestSuite/${i}`);
      expect(fixture.children[0].id.evaluate(instance_2_params)).to.equal(`test_mockup_OtherInstanceName/TestSuite/${i}_case_a`);
      expect(fixture.children[1].id.evaluate(instance_2_params)).to.equal(`test_mockup_OtherInstanceName/TestSuite/${i}_case_b`);
    }

  });


  it("TYPED_TEST with mapping is parsed correctly", async () => {
    const bin = `InstanceName/foo::bar::0.  # TypeParam = char
  case_a
  case_b
InstanceName/foo::bar::1.  # TypeParam = int
  case_a
  case_b
InstanceName/foo::bar::2.  # TypeParam = unsigned int
  case_a
  case_b
`;
    const fixtures = parseGTestBinaryOutput(bin, createFakeBuildTarget("mockup"));

    expect(fixtures.children.length).to.equal(1);
    let fixture = fixtures.children[0];
    expect(fixture.is_parameterized).to.equal(true);
    expect(fixture.instances).not.to.equal(undefined);
    expect(fixture.instances.length).to.equal(3);

    for (let i of [0, 1, 2]) {
      let params = fixture.instances[i];

      expect(fixture.id.evaluate(params)).to.equal(`fixture_mockup_InstanceName/foo::bar::${i}`);
      expect(fixture.line).to.equal(undefined);
      expect(fixture.is_parameterized).to.equal(true);

      expect(fixture.children.length).to.equal(2);
      expect(fixture.children[0].id.evaluate(params)).to.equal(`test_mockup_InstanceName/foo::bar::${i}_case_a`);
      expect(fixture.children[0].line).to.equal(undefined);
      expect(fixture.children[1].id.evaluate(params)).to.equal(`test_mockup_InstanceName/foo::bar::${i}_case_b`);
      expect(fixture.children[1].line).to.equal(undefined);
    }
  });
});

describe('GTest Integration Test', () => {
  it("Type instances are mapped to separate fixtures", async () => {
    const bin = `SimpleSuite.
  SimpleTest
Fixture.
  DoesBlah
  HasPropertyA
TypedTest/0.  # TypeParam = char
  DoesBlah
  HasPropertyA
TypedTest/1.  # TypeParam = int
  DoesBlah
  HasPropertyA
TypedTest/2.  # TypeParam = unsigned int
  DoesBlah
  HasPropertyA
InstanceP/TypedTestP/0.  # TypeParam = char
  DoesBlah
  HasPropertyA
InstanceP/TypedTestP/1.  # TypeParam = int
  DoesBlah
  HasPropertyA
InstanceP/TypedTestP/2.  # TypeParam = unsigned int
  DoesBlah
  HasPropertyA
OtherInstanceP/TypedTestP/0.  # TypeParam = float
  DoesBlah
  HasPropertyA
OtherInstanceP/TypedTestP/1.  # TypeParam = double
  DoesBlah
  HasPropertyA
TypedTestWithMapping/foo::bar::0.  # TypeParam = char
  DoesBlah
  HasPropertyA
TypedTestWithMapping/foo::bar::1.  # TypeParam = int
  DoesBlah
  HasPropertyA
TypedTestWithMapping/foo::bar::2.  # TypeParam = unsigned int
  DoesBlah
  HasPropertyA
Instance/TestP.
  succeeds/0  # GetParam() = true
  fails/0  # GetParam() = true
AnotherInstance/TestP.
  succeeds/0  # GetParam() = false
  succeeds/1  # GetParam() = true
  fails/0  # GetParam() = false
  fails/1  # GetParam() = true
`;
    const prefix = "package_with_gtests-test";
    const fixtures = parseGTestBinaryOutput(bin, createFakeBuildTarget(prefix));

    expectIntegrationTestSuiteCorrect(fixtures, prefix);
  });
});


export function createFakeBuildTarget(name: string): IBuildTarget {
  return {
    cmake_target: name,
    label: name,
    exec_path: undefined,
    type: 'suite'
  };
}
