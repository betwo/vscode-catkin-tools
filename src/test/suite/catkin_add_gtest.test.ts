import * as assert from 'assert';
import { expect } from 'chai';
import { PathLike } from 'fs';
import * as vscode from 'vscode';
import { IWorkspace, WorkspaceTestSuite } from 'vscode-catkin-tools-api';
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
			let test_suite_pkg_a: WorkspaceTestSuite;
			let workspace: IWorkspace;

			let build_dir: PathLike;
			let devel_dir: PathLike;

			before(async function () {
				this.timeout(50000);
				const workspaces = extension.api.getWorkspaces();
				assert.strictEqual(workspaces.size, 1);
				workspace = workspaces.get(vscode.workspace.workspaceFolders[0]);

				await extension.api.ensureWorkspaceInitialized();

				build_dir = await workspace.getBuildDir();
				devel_dir = await workspace.getDevelDir();
				assert.strictEqual(workspace.packages.size, 3);

				const pkg_a = workspace.packages.get("package_a");
				const pkg_wo_tests = workspace.packages.get("package_wo_tests");
				assert.strictEqual(pkg_a.has_tests, true);
				assert.strictEqual(pkg_wo_tests.has_tests, false);

				assert.ok(await extension.api.cleanWorkspace(workspace));
				assert.ok(await extension.api.buildWorkspace(workspace));
				assert.ok(await extension.api.buildWorkspaceTests(workspace));
				// assert.ok(await extension.api.buildPackage(pkg));
				// assert.ok(await extension.api.buildPackageTests(pkg));

				test_suite_pkg_a = await pkg_a.loadTests(build_dir.toString(), devel_dir.toString(), false);
			});

			it("contains one package", () => {
				const workspaces = extension.api.getWorkspaces();
				assert.strictEqual(workspaces.size, 1);
			}).timeout(50000);

			it("package_a tests can be loaded", async () => {
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
				const test_exec = test_suite_pkg_a.executables[0];
				const test_fixture = test_exec.fixtures[0];

				const pkg = workspace.packages.get("package_a");
				await workspace.loadPackageTests(pkg, false);
				const should_succed = await workspace.runTest(test_fixture.cases[0].info.id);
				assert.ok(should_succed.success);

				const should_fail = await workspace.runTest(test_fixture.cases[1].info.id);
				assert.ok(!should_fail.success);
			}).timeout(50000);


			it("#TEST macro is detected", async () => {
				const test_exec = test_suite_pkg_a.executables[0];
				const test_fixture = test_exec.fixtures[0];

				const pkg = workspace.packages.get("package_a");
				await workspace.loadPackageTests(pkg, false);

				assert.strictEqual(test_fixture.info.label, "TestSuite");

			}).timeout(50000);


			it("#TYPED_TEST_P macro is detected", async () => {
				const pkg = workspace.packages.get("package_with_gtests");
				// await workspace.loadPackageTests(pkg, false);
				let test_suite = await pkg.loadTests(build_dir.toString(), devel_dir.toString(), false);

				let suite = await workspace.loadPackageTests(pkg, false);
				assert.ok(suite !== undefined);

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
