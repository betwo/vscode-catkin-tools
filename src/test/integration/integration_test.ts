import * as path from 'path';

import { runTests } from '@vscode/test-electron';

export async function run_integration_tests() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './index');

        const workspace_catkin_add_gtest = path.resolve(__dirname, '../../../tests/workspaces/test_types/catkin_add_gtest');

        // Download VS Code, unzip it and run the integration test
        await runTests({
            version: '1.64.0', // pinned because 1.65.0 crashes randomly. TODO: bump in the future
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                workspace_catkin_add_gtest,
                "--disable-gpu", "--disable-gpu-compositing",
                "--no-sandbox"
                // This disables all extensions except the one being tested
                // '--disable-extensions'
            ],
        });
    } catch (err) {
        console.error('Failed to run integration tests');
        process.exit(1);
    }
}