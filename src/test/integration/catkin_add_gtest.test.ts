import * as assert from 'assert';
import { expect } from 'chai';
import { PathLike } from 'fs';
import * as vscode from 'vscode';
import { IWorkspace, IPackage } from 'vscode-catkin-tools-api';
import * as extension from '../../extension';

let root_test_triggered = false;
extension.api.setAutomaticTestMode();
extension.api.workspace_manager.onWorkspacesChanged.event(ws => {
	if (root_test_triggered) {
		return;
	}
	root_test_triggered = true;

	describe('Workspace catkin_add_gtest', () => {
		describe("catkin_add_gtest", () => {
			let workspace: IWorkspace;

			let build_dir: PathLike;
			let devel_dir: PathLike;

			before(async function () {
				// run once before all tests in this fixture
				this.timeout(50000);
				const workspaces = extension.api.getWorkspaces();
				expect(workspaces.size).to.equal(1);
				workspace = workspaces.get(vscode.workspace.workspaceFolders[0]);

				const default_catkin_workspace = await workspace.workspace_provider.getDefaultRosWorkspace();
				assert(await workspace.workspace_provider.isInitialized(), "workspace is not initialized");
				await workspace.workspace_provider.initialize([default_catkin_workspace]);

				await extension.api.ensureWorkspaceInitialized();


				build_dir = await workspace.getBuildDir();
				devel_dir = await workspace.getDevelDir();
				expect(workspace.packages.size).to.equal(3);

				const pkg_a = workspace.packages.get("package_a");
				const pkg_wo_tests = workspace.packages.get("package_wo_tests");
				assert(pkg_a.has_tests, "pkg_a should have tests");
				assert(!pkg_wo_tests.has_tests, "pkg_wo_tests should have no tests");

				assert(await extension.api.cleanWorkspace(workspace), "Cleaning should work");

				assert(await extension.api.buildWorkspace(workspace), "Workspace should be built");
				assert(await extension.api.buildWorkspaceTests(workspace), "Workspace should have tests");
			});

			it("contains one package", () => {
				const workspaces = extension.api.getWorkspaces();
				assert.strictEqual(workspaces.size, 1);
			}).timeout(50000);

			it("package_a tests can be loaded", async () => {
				const pkg_a = workspace.packages.get("package_a");
				const test_suite_pkg_a = await pkg_a.loadTests(build_dir.toString(), devel_dir.toString(), false);

				assert.strictEqual(test_suite_pkg_a.executables.length, 1);
				const test_exec = test_suite_pkg_a.executables[0];
				assert.strictEqual(test_exec.fixtures.length, 1);
				const test_fixture = test_exec.fixtures[0];

				assert.strictEqual(test_fixture.type, "gtest");
				assert.strictEqual(test_fixture.filter, "TestSuite.*");
				assert.strictEqual(test_fixture.build_target, "package_a-test");
				assert.strictEqual(test_fixture.cases.length, 2);

				assert.strictEqual(test_fixture.cases[0].info.label, "TestSuite::succeeds");
				assert.strictEqual(test_fixture.cases[1].info.label, "TestSuite::fails");
			}).timeout(50000);

			it("#package_a tests test result is detected", async () => {
				const pkg_a = workspace.packages.get("package_a");
				const test_suite_pkg_a = await pkg_a.loadTests(build_dir.toString(), devel_dir.toString(), false);

				const test_exec = test_suite_pkg_a.executables[0];
				const test_fixture = test_exec.fixtures[0];

				const pkg = workspace.packages.get("package_a");
				await workspace.loadPackageTests(pkg, false);
				const should_succed = await workspace.runTest(test_fixture.cases[0].info.id);
				assert(should_succed.success, `Running the test ${test_fixture.cases[0].info.id} failed`);

				expect(test_fixture.cases.length).to.be.above(1);
				assert.notStrictEqual(test_fixture.cases[1], undefined);
				assert.notStrictEqual(test_fixture.cases[1].info, undefined);
				assert.notStrictEqual(test_fixture.cases[1].info.id, undefined);

				const should_fail = await workspace.runTest(test_fixture.cases[1].info.id);
				assert(!should_fail.success, `Running the test ${test_fixture.cases[1].info.id} should have failed`);
			}).timeout(50000);


			it("#TEST macro is detected", async () => {
				const pkg_a = workspace.packages.get("package_a");
				const test_suite_pkg_a = await pkg_a.loadTests(build_dir.toString(), devel_dir.toString(), false);

				const test_exec = test_suite_pkg_a.executables[0];
				const test_fixture = test_exec.fixtures[0];

				const pkg = workspace.packages.get("package_a");
				await workspace.loadPackageTests(pkg, false);

				assert.strictEqual(test_fixture.info.label, "TestSuite");

			}).timeout(50000);


			it("#TEST location is correct", async () => {
				const pkg: IPackage = workspace.packages.get("package_a");

				const build_dir = await workspace.getBuildDir();
				assert(pkg.isBuilt(build_dir.toString()), `package ${pkg.package_xml_path} is not build`);

				const root = (await workspace.getRootPath()).toString();

				const test_suite = await workspace.loadPackageTests(pkg, false);
				expect(test_suite.info.label).to.equal("package_a");
				expect(test_suite.info.file).to.equal(`${root}/src/package_a/CMakeLists.txt`);

				const test_exec = test_suite.executables[0];
				expect(test_exec.info.label).to.equal("package_a-test");
				expect(test_exec.info.file).to.equal(`${root}/src/package_a/CMakeLists.txt`);
				expect(test_exec.info.line).to.equal(11 - 1, "text exec file line is incorrect"); // 0 index

				const test_fixture = test_exec.fixtures[0];
				expect(test_fixture.info.label).to.equal("TestSuite");
				expect(test_fixture.cases[0].info.label).to.equal("TestSuite::succeeds");
				expect(test_fixture.cases[1].info.label).to.equal("TestSuite::fails");
				expect(test_fixture.cases[0].info.line).to.equal(3 - 1); // 0 index
				expect(test_fixture.cases[1].info.line).to.equal(8 - 1); // 0 index
				expect(test_fixture.cases[0].info.file).to.equal(`${root}/src/package_a/test/test_package_a.cpp`);
				expect(test_fixture.cases[0].info.file).to.equal(`${root}/src/package_a/test/test_package_a.cpp`);

			}).timeout(50000);


			it("#TYPED_TEST_P macro is detected", async () => {
				const pkg = workspace.packages.get("package_with_gtests");
				// await workspace.loadPackageTests(pkg, false);
				let test_suite = await pkg.loadTests(build_dir.toString(), devel_dir.toString(), false);

				let suite = await workspace.loadPackageTests(pkg, false);
				assert(suite !== undefined, "suite is not defined");

				assert.strictEqual(test_suite.executables.length, 1);
				const test_exec = test_suite.executables[0];

				assert.strictEqual(test_exec.fixtures.length, 9);
				const test_fixture = test_exec.fixtures[0];
				assert.strictEqual(test_fixture.cases.length, 2);

				assert.strictEqual(test_exec.fixtures[3].info.label, "InstanceP/TypedTestP/0");
				assert.strictEqual(test_exec.fixtures[3].info.description, "TypeParam = char");
				assert.strictEqual(test_exec.fixtures[4].info.label, "InstanceP/TypedTestP/1");
				assert.strictEqual(test_exec.fixtures[4].info.description, "TypeParam = int");
				assert.strictEqual(test_exec.fixtures[5].info.label, "InstanceP/TypedTestP/2");
				assert.strictEqual(test_exec.fixtures[5].info.description, "TypeParam = unsigned int");

				assert.strictEqual(test_exec.fixtures[0].info.label, "TypedTest/0");
				assert.strictEqual(test_exec.fixtures[0].info.description, "TypeParam = char");
				assert.strictEqual(test_exec.fixtures[1].info.label, "TypedTest/1");
				assert.strictEqual(test_exec.fixtures[1].info.description, "TypeParam = int");
				assert.strictEqual(test_exec.fixtures[2].info.label, "TypedTest/2");
				assert.strictEqual(test_exec.fixtures[2].info.description, "TypeParam = unsigned int");

				assert.strictEqual(test_exec.fixtures[6].info.label, "TypedTestWithColon/foo::bar::0");
				assert.strictEqual(test_exec.fixtures[6].info.description, "TypeParam = char");
				assert.strictEqual(test_exec.fixtures[7].info.label, "TypedTestWithColon/foo::bar::1");
				assert.strictEqual(test_exec.fixtures[7].info.description, "TypeParam = int");
				assert.strictEqual(test_exec.fixtures[8].info.label, "TypedTestWithColon/foo::bar::2");
				assert.strictEqual(test_exec.fixtures[8].info.description, "TypeParam = unsigned int");
			}).timeout(50000);

		});
	});
	run();
});
