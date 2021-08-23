import * as assert from 'assert';
import { expect } from 'chai';
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
			let test_suite: WorkspaceTestSuite;
			let workspace: IWorkspace;

			before(async function () {
				this.timeout(50000);
				const workspaces = extension.api.getWorkspaces();
				assert.strictEqual(workspaces.size, 1);
				workspace = workspaces.get(vscode.workspace.workspaceFolders[0]);

				await extension.api.ensureWorkspaceInitialized();

				const build_dir = await workspace.getBuildDir();
				const devel_dir = await workspace.getDevelDir();
				assert.strictEqual(workspace.packages.size, 2);

				const pkg_a = workspace.packages.get("package_a");
				const pkg_wo_tests = workspace.packages.get("package_wo_tests");
				assert.strictEqual(pkg_a.has_tests, true);
				assert.strictEqual(pkg_wo_tests.has_tests, false);

				assert.ok(await extension.api.cleanWorkspace(workspace));
				assert.ok(await extension.api.buildWorkspace(workspace));
				assert.ok(await extension.api.buildWorkspaceTests(workspace));
				// assert.ok(await extension.api.buildPackage(pkg));
				// assert.ok(await extension.api.buildPackageTests(pkg));

				test_suite = await pkg_a.loadTests(build_dir.toString(), devel_dir.toString(), false);
			});

			it("contains one package", () => {
				const workspaces = extension.api.getWorkspaces();
				assert.strictEqual(workspaces.size, 1);
			}).timeout(50000);

			it("package_a tests can be loaded", async () => {
				assert.strictEqual(test_suite.executables.length, 1);
				const test_exec = test_suite.executables[0];
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
				const test_exec = test_suite.executables[0];
				const test_fixture = test_exec.fixtures[0];

				const pkg = workspace.packages.get("package_a");
				await workspace.loadPackageTests(pkg, false);
				const should_succed = await workspace.runTest(test_fixture.cases[0].info.id);
				assert.ok(should_succed.success);

				const should_fail = await workspace.runTest(test_fixture.cases[1].info.id);
				assert.ok(!should_fail.success);
			}).timeout(50000);

		});
	});
	run();
});
