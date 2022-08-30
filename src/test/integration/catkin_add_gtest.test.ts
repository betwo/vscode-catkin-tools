import * as assert from 'assert';
import { expect } from 'chai';
import { PathLike } from 'fs';
import * as vscode from 'vscode';
import { IWorkspace, IPackage } from 'vscode-catkin-tools-api';
import * as extension from '../../extension';
import { NoninteractiveTestRun } from '../mock/vscode/noninteractive_test_run';
import { expectIntegrationTestSuiteCorrect } from './integration_test_suite';

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
				await workspace.workspace_provider.initialize([default_catkin_workspace]);
				assert(await workspace.workspace_provider.isInitialized(), "workspace is not initialized");

				await extension.api.ensureWorkspaceInitialized();


				build_dir = await workspace.getBuildDir();
				devel_dir = await workspace.getDevelDir();
				expect(workspace.packages.size).to.equal(4);

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
				await pkg_a.loadTests(build_dir, devel_dir, true);
				const test_suite_pkg_a = pkg_a.package_test_suite;

				assert.strictEqual(test_suite_pkg_a.children.length, 1);
				const test_exec = test_suite_pkg_a.children[0];
				assert.strictEqual(test_exec.children.length, 1);
				const test_fixture = test_exec.children[0];

				assert.strictEqual(test_fixture.type, "gtest");
				assert.strictEqual(test_fixture.build_target.cmake_target, "package_a-test");
				assert.strictEqual(test_fixture.children.length, 2);

				assert.strictEqual(test_fixture.children[0].id.fixture, "TestSuite");
				assert.strictEqual(test_fixture.children[0].id.test, "succeeds");
				assert.strictEqual(test_fixture.children[1].id.fixture, "TestSuite");
				assert.strictEqual(test_fixture.children[1].id.test, "fails");
			}).timeout(50000);

			it("#package_a tests test result is detected", async () => {
				const pkg_a = workspace.packages.get("package_a");
				await pkg_a.loadTests(build_dir, devel_dir, true);

				const pkg = workspace.packages.get("package_a");
				await workspace.loadPackageTests(pkg, false);

				const test_exec = pkg_a.package_test_suite.children[0];
				const test_fixture = test_exec.children[0];

				let succeeding_test_run = new NoninteractiveTestRun();
				const should_succeed = await workspace.runTest(test_fixture.children[0].id.evaluate({}), succeeding_test_run);

				assert(should_succeed.success, `Running the test ${test_fixture.children[0].id.evaluate({})} failed`);
				expect(succeeding_test_run.items_errored.length).to.equal(0);
				expect(succeeding_test_run.items_failed.length).to.equal(0);
				expect(succeeding_test_run.items_passed.length).greaterThan(0);
				expect(succeeding_test_run.items_started.length).greaterThan(0);
				expect(succeeding_test_run.items_passed[0].id).equals(test_fixture.children[0].id.evaluate({}));
				expect(succeeding_test_run.items_started[0].id).equals(test_fixture.children[0].id.evaluate({}));
				assert.strictEqual(succeeding_test_run.items_failed.length, 0);
				assert.strictEqual(succeeding_test_run.items_errored.length, 0);

				expect(test_fixture.children.length).to.be.above(1);
				assert.notStrictEqual(test_fixture.children[1], undefined);
				assert.notStrictEqual(test_fixture.children[1].id, undefined);

				let failing_test_run = new NoninteractiveTestRun();
				const should_fail = await workspace.runTest(test_fixture.children[1].id.evaluate({}), failing_test_run);
				assert(!should_fail.success, `Running the test ${test_fixture.children[1].id} should have failed`);
			}).timeout(50000);


			it("#TEST macro is detected", async () => {
				const pkg_a = workspace.packages.get("package_a");
				await pkg_a.loadTests(build_dir, devel_dir, true);

				const test_exec = pkg_a.package_test_suite.children[0];
				const test_fixture = test_exec.children[0];

				const pkg = workspace.packages.get("package_a");
				await workspace.loadPackageTests(pkg, false);

				assert.strictEqual(test_fixture.id.fixture, "TestSuite");

			}).timeout(50000);


			it("#TEST location is correct", async () => {
				const pkg: IPackage = workspace.packages.get("package_a");

				const build_dir = await workspace.getBuildDir();
				assert(pkg.isBuilt(build_dir.toString()), `package ${pkg.package_xml_path} is not build`);

				const root = (await workspace.getRootPath()).toString();

				await workspace.loadPackageTests(pkg, false);

				const test_suite = pkg.package_test_suite;
				// expect(test_suite.label).to.equal("package_a");
				expect(test_suite.file).to.equal(`${root}/src/package_a/CMakeLists.txt`);

				const test_exec = test_suite.children[0];
				// expect(test_exec.label).to.equal("package_a-test");
				expect(test_exec.file).to.equal(`${root}/src/package_a/CMakeLists.txt`);
				expect(test_exec.line).to.equal(11 - 1, "text exec file line is incorrect"); // 0 index

				const test_fixture = test_exec.children[0];
				expect(test_fixture.id.fixture).to.equal("TestSuite");
				expect(test_fixture.children[0].id.test).to.equal("succeeds");
				expect(test_fixture.children[1].id.test).to.equal("fails");
				expect(test_fixture.children[0].line).to.equal(3 - 1); // 0 index
				expect(test_fixture.children[1].line).to.equal(8 - 1); // 0 index
				expect(test_fixture.children[0].file).to.equal(`${root}/src/package_a/test/test_package_a.cpp`);
				expect(test_fixture.children[0].file).to.equal(`${root}/src/package_a/test/test_package_a.cpp`);

			}).timeout(50000);


			it("#TEST macros are detected", async () => {
				const pkg = workspace.packages.get("package_with_gtests");
				// await workspace.loadPackageTests(pkg, false);
				await pkg.loadTests(build_dir, devel_dir, true);

				await workspace.loadPackageTests(pkg, false);

				let test_suite = pkg.package_test_suite;
				assert(test_suite !== undefined, "suite is not defined");
				assert.strictEqual(test_suite.children.length, 1);
				const test_exec = test_suite.children[0];

				const prefix = "package_with_gtests-test";

				assert.strictEqual(test_exec.children.length, 6);

				expectIntegrationTestSuiteCorrect(test_exec, prefix, true);

			}).timeout(50000);

		});
	});
	run();
});
