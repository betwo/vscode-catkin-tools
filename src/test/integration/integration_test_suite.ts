import * as assert from 'assert';
import { expect } from 'chai';
import { WorkspaceTestInterface } from 'vscode-catkin-tools-api';



export function expectIntegrationTestSuiteCorrect(executable: WorkspaceTestInterface, prefix: string, has_source = false) {
  const fixtures = executable.children;
  expect(fixtures.length).to.equal(6);

  function extractFixture(name: string): WorkspaceTestInterface {
    for (const fixture of fixtures) {
      if (fixture.id.fixture === name) {
        return fixture;
      }
    }
    assert(false);
  }

  {
    let fixture = extractFixture("SimpleSuite");
    //  SimpleSuite.
    //   SimpleTest
    expect(fixture.is_parameterized).to.equal(false);
    expect(fixture.id.evaluate({})).to.equal(`fixture_${prefix}_SimpleSuite`);
    expect(fixture.children[0].id.evaluate({})).to.equal(`test_${prefix}_SimpleSuite_SimpleTest`);
  }

  {
    // Fixture.
    //   DoesBlah
    //   HasPropertyA
    let fixture = extractFixture("Fixture");
    expect(fixture.is_parameterized).to.equal(false);
    expect(fixture.id.evaluate({})).to.equal(`fixture_${prefix}_Fixture`);
    expect(fixture.children[0].id.evaluate({})).to.equal(`test_${prefix}_Fixture_DoesBlah`);
    expect(fixture.children[1].id.evaluate({})).to.equal(`test_${prefix}_Fixture_HasPropertyA`);
  }


  {
    // TypedTest/0.  # TypeParam = char
    // DoesBlah
    // HasPropertyA
    // TypedTest/1.  # TypeParam = int
    // DoesBlah
    // HasPropertyA
    // TypedTest/2.  # TypeParam = unsigned int
    // DoesBlah
    // HasPropertyA
    let fixture = extractFixture("TypedTest");
    expect(fixture.is_parameterized).to.equal(true);
    for (let instance of [0, 1, 2]) {
      let fixture_parameters = fixture.instances[instance];
      expect(fixture_parameters).not.to.equal(undefined);
      expect(fixture_parameters.fixture.instance).to.equal(undefined);
      expect(fixture_parameters.fixture.generator).to.equal(`${instance}`);
      expect(fixture_parameters.generator).to.equal(undefined);

      expect(fixture.id.fixture).to.equal(`TypedTest`);
      expect(fixture.id.evaluate(fixture_parameters)).to.equal(`fixture_${prefix}_TypedTest/${instance}`);

      expect(fixture.line).to.equal(has_source ? 3 : undefined);
      expect(fixture.is_parameterized).to.equal(true);
      expect(fixture.instances.length).to.equal(3);
      expect(fixture.children.length).to.equal(2);

      expect(fixture.children[0].id.evaluate(fixture_parameters)).to.equal(`test_${prefix}_TypedTest/${instance}_DoesBlah`);
      expect(fixture.children[0].line).to.equal(has_source ? 10 : undefined);
      expect(fixture.children[1].id.evaluate(fixture_parameters)).to.equal(`test_${prefix}_TypedTest/${instance}_HasPropertyA`);
      expect(fixture.children[1].line).to.equal(has_source ? 15 : undefined);
    }
  }
  {
    // InstanceP/TypedTestP/0.  # TypeParam = char
    //   DoesBlah
    //   HasPropertyA
    // InstanceP/TypedTestP/1.  # TypeParam =InstanceName/TestSuite
    // InstanceP/TypedTestP/2.  # TypeParam = unsigned int
    //   DoesBlah
    //   HasPropertyA
    // OtherInstanceP/TypedTestP/0.  # TypeParam = float
    //   DoesBlah
    //   HasPropertyA
    // OtherInstanceP/TypedTestP/1.  # TypeParam = double
    //   DoesBlah
    //   HasPropertyA
    let fixture = extractFixture("TypedTestP");
    expect(fixture.is_parameterized).to.equal(true);
    expect(fixture.instances).not.to.equal(undefined);
    expect(fixture.instances.length).to.equal(5);

    expect(fixture.line).to.equal(has_source ? 3 : undefined);

    expect(fixture.children.length).to.equal(2);
    expect(fixture.children[0].is_parameterized).to.equal(false);
    expect(fixture.children[0].line).to.equal(has_source ? 9 : undefined);
    expect(fixture.children[1].is_parameterized).to.equal(false);
    expect(fixture.children[1].line).to.equal(has_source ? 14 : undefined);

    let expected_descriptions = ["TypeParam = char", "TypeParam = int", "TypeParam = unsigned int"];
    for (let i = 0; i < 3; ++i) {
      let instance_1_params = fixture.instances[i];
      expect(instance_1_params).not.to.equal(undefined);
      expect(instance_1_params.fixture.instance).to.equal("InstanceP");
      expect(instance_1_params.fixture.generator).to.equal(`${i}`);
      expect(instance_1_params.generator).to.equal(undefined);
      expect(instance_1_params.fixture.description).to.equal(expected_descriptions[i]);

      expect(fixture.id.evaluate(instance_1_params)).to.equal(`fixture_${prefix}_InstanceP/TypedTestP/${i}`);
      expect(fixture.children[0].id.evaluate(instance_1_params)).to.equal(`test_${prefix}_InstanceP/TypedTestP/${i}_DoesBlah`);
      expect(fixture.children[1].id.evaluate(instance_1_params)).to.equal(`test_${prefix}_InstanceP/TypedTestP/${i}_HasPropertyA`);
    }

    expected_descriptions = ["TypeParam = float", "TypeParam = double"];
    for (let i = 0; i < 2; ++i) {
      let instance_2_params = fixture.instances[3 + i];
      expect(instance_2_params).not.to.equal(undefined);
      expect(instance_2_params.fixture.instance).to.equal("OtherInstanceP");
      expect(instance_2_params.fixture.generator).to.equal(`${i}`);
      expect(instance_2_params.generator).to.equal(undefined);
      expect(instance_2_params.fixture.description).to.equal(expected_descriptions[i]);

      expect(fixture.id.evaluate(instance_2_params)).to.equal(`fixture_${prefix}_OtherInstanceP/TypedTestP/${i}`);
      expect(fixture.children[0].id.evaluate(instance_2_params)).to.equal(`test_${prefix}_OtherInstanceP/TypedTestP/${i}_DoesBlah`);
      expect(fixture.children[1].id.evaluate(instance_2_params)).to.equal(`test_${prefix}_OtherInstanceP/TypedTestP/${i}_HasPropertyA`);
    }
  }

  {
    // TypedTestWithMapping/foo::bar::0.  # TypeParam = char
    //   DoesBlah
    //   HasPropertyA
    // TypedTestWithMapping/foo::bar::1.  # TypeParam = int
    //   DoesBlah
    //   HasPropertyA
    // TypedTestWithMapping/foo::bar::2.  # TypeParam = unsigned int
    //   DoesBlah
    //   HasPropertyA
    let fixture = extractFixture("TypedTestWithMapping");
    expect(fixture.is_parameterized).to.equal(true);
    expect(fixture.instances).not.to.equal(undefined);
    expect(fixture.instances.length).to.equal(3);

    for (let i of [0, 1, 2]) {
      let params = fixture.instances[i];

      expect(fixture.id.evaluate(params)).to.equal(`fixture_${prefix}_TypedTestWithMapping/foo::bar::${i}`);
      expect(fixture.line).to.equal(has_source ? 3 : undefined);
      expect(fixture.is_parameterized).to.equal(true);

      expect(fixture.children.length).to.equal(2);
      expect(fixture.children[0].id.evaluate(params)).to.equal(`test_${prefix}_TypedTestWithMapping/foo::bar::${i}_DoesBlah`);
      expect(fixture.children[0].line).to.equal(has_source ? 20 : undefined);
      expect(fixture.children[1].id.evaluate(params)).to.equal(`test_${prefix}_TypedTestWithMapping/foo::bar::${i}_HasPropertyA`);
      expect(fixture.children[1].line).to.equal(has_source ? 25 : undefined);
    }
  }

  {
    // Instance/TestP.
    //  succeeds/0  # GetParam() = true
    //  fails/0  # GetParam() = true
    // AnotherInstance/TestP.
    //  succeeds/0  # GetParam() = false
    //  succeeds/1  # GetParam() = true
    //  fails/0  # GetParam() = false
    //  fails/1  # GetParam() = true
    let fixture = extractFixture("TestP");
    expect(fixture.is_parameterized).to.equal(true);
    expect(fixture.instances).not.to.equal(undefined);
    expect(fixture.instances.length).to.equal(2);

    const expected_instance_names = ["Instance", "AnotherInstance"];
    for (let i of [0, 1]) {
      let fixture_parameters = fixture.instances[i];
      expect(fixture_parameters).not.to.equal(undefined);
      expect(fixture_parameters.fixture.instance).to.equal(expected_instance_names[i]);
      expect(fixture_parameters.fixture.generator).to.equal(undefined);
      expect(fixture_parameters.generator).to.equal(undefined);

      expect(fixture.id.fixture).to.equal(`TestP`);
      expect(fixture.id.evaluate(fixture_parameters)).to.equal(`fixture_${prefix}_${expected_instance_names[i]}/TestP`);

      expect(fixture.line).to.equal(has_source ? 2 : undefined);

      expect(fixture.children.length).to.equal(2);
      const expected_test_names = ["succeeds", "fails"];
      const expected_test_lines = [6, 11];
      const expected_test_instances = [1, 2];
      const expected_descriptions = [
        ["GetParam() = true", "GetParam() = true"],
        ["GetParam() = false", "GetParam() = true", "GetParam() = false", "GetParam() = true"]
      ];
      const expected_test_instances_sum = expected_test_instances.reduce((sum, current) => sum + current)
      for (let case_idx of [0, 1]) {
        let test_case = fixture.children[case_idx];
        expect(test_case.instances.length).to.equal(expected_test_instances_sum);
        expect(test_case.is_parameterized).to.equal(true);
        expect(test_case.line).to.equal(has_source ? expected_test_lines[case_idx] : undefined);

        const this_instances = test_case.instances.filter((item) =>
          item.fixture.instance === fixture_parameters.fixture.instance &&
          item.fixture.generator === fixture_parameters.fixture.generator &&
          item.fixture.description === fixture_parameters.fixture.description
        );
        expect(this_instances.length).to.equal(expected_test_instances[i]);

        for (let test_instance = 0; test_instance < this_instances.length; ++test_instance) {
          let test_case_parameters = this_instances[test_instance];
          expect(test_case_parameters.description).to.equal(expected_descriptions[i][test_instance]);
          expect(test_case_parameters.fixture.instance).to.equal(expected_instance_names[i]);
          expect(test_case_parameters.fixture.generator).to.equal(undefined);
          expect(test_case_parameters.generator).to.equal(`${test_instance}`);

          expect(test_case.id.evaluate(test_case_parameters)).to.equal(`test_${prefix}_${expected_instance_names[i]}/TestP_${expected_test_names[case_idx]}/${test_instance}`);
          expect(test_case.id.evaluate(test_case_parameters)).to.equal(`test_${prefix}_${expected_instance_names[i]}/TestP_${expected_test_names[case_idx]}/${test_instance}`);
        }
      }
    }
  }
}
