import * as assert from 'assert';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { TestParserGTest } from './test_source_parser';
import { parseGTestBinaryOutput, updateTestsFromExecutable } from './test_binary_parser';
import { Package } from '../../package';
import { IBuildTarget, IWorkspace, WorkspaceProvider, WorkspaceTestInterface, WorkspaceTestIdentifierTemplate } from 'vscode-catkin-tools-api';
import { createFakeBuildTarget } from './test_binary_parser.test';
import { Workspace } from '../../workspace';
import { MockupWorkspaceProvider } from '../../../test/mock/mockup_workspace_provider';
import { logger } from '../../logging';

describe('Test Source and Binary Parser', () => {
    describe('GTest', () => {
        it("Source and binary parsers extend each other", async () => {
            let parser = new TestParserGTest();
            const src = `
#include <gtest/gtest.h>

template <typename T>
class TypedTestWithMapping : public testing::Test
{
};

class MyTypeMapping>
{
public:
    template <typename T>
    static std::string GetName(int i)
    {
        return std::string("foo::bar::") + std::to_string(i);
    }
};

using MyTypes = ::testing::Types<char, int, unsigned int>;
TYPED_TEST_SUITE(TypedTestWithMapping, MyTypes, MyTypeMapping);

TYPED_TEST(TypedTestWithMapping, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST(TypedTestWithMapping, HasPropertyA)
{
    SUCCEED();
}
`;

            const prefix = "package_with_gtests-test";
            const source_fixtures = parser.analyzeSource(prefix, "dummy.cpp", src);
            expect(source_fixtures.length).to.equal(1);
            expect(source_fixtures[0].id.evaluate({})).to.equal(`fixture_${prefix}_TypedTestWithMapping`);
            expect(source_fixtures[0].id.fixture).to.equal(`TypedTestWithMapping`);
            expect(source_fixtures[0].line).to.equal(4);

            assert(source_fixtures[0].is_parameterized);
            assert(source_fixtures[0].instances !== undefined);
            expect(source_fixtures[0].children.length).to.equal(2);
            expect(source_fixtures[0].children[0].id.evaluate({})).to.equal(`test_${prefix}_TypedTestWithMapping_DoesBlah`);
            expect(source_fixtures[0].children[0].line).to.equal(21);
            expect(source_fixtures[0].children[1].id.evaluate({})).to.equal(`test_${prefix}_TypedTestWithMapping_HasPropertyA`);
            expect(source_fixtures[0].children[1].line).to.equal(26);

            let executable: WorkspaceTestInterface = {
                type: 'suite',
                id: new WorkspaceTestIdentifierTemplate(`exec`),
                is_parameterized: false,
                file: undefined,
                line: 0,
                children: [...source_fixtures],
            };

            let mockup_workspace_provider = new MockupWorkspaceProvider();
            let mockup_workspace = new Workspace(mockup_workspace_provider, undefined);

            let pkg = new Package("package.xml", mockup_workspace);

            expect(executable.children.length).to.equal(1);
            expect(executable.children[0].children.length).to.equal(2);

            const bin = `TypedTestWithMapping/foo::bar::0.  # TypeParam = char
  DoesBlah
  HasPropertyA
TypedTestWithMapping/foo::bar::1.  # TypeParam = int
  DoesBlah
  HasPropertyA
TypedTestWithMapping/foo::bar::2.  # TypeParam = unsigned int
  DoesBlah
  HasPropertyA`;

            let fake_build_targets: IBuildTarget[] = [{
                cmake_target: prefix,
                label: "package_with_gtests",
                exec_path: "path",
                type: 'suite'
            }];
            pkg.updatePackageImpl(fake_build_targets);

            expect(executable.children.length).to.equal(1);
            const binary = parseGTestBinaryOutput(bin, createFakeBuildTarget(prefix));

            for (const binary_fixture of binary.children) {
                let build_target = binary_fixture.build_target === undefined ? binary_fixture.build_target : executable.build_target;
                pkg.updateTestFixture(executable, binary_fixture, build_target, false, false);
            }

            // logger.silly("STATE");
            // logger.silly(`Executable:`, executable);
            // for (const fixture of executable.children) {
            //     logger.silly(`Fixture:`, fixture.id);
            // }

            expect(executable.children.length).to.equal(1);
            expect(executable.children[0].children.length).to.equal(2);
        });
    });
});