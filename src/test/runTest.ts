import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        const workspace_catkin_add_gtest = path.resolve(__dirname, '../../tests/workspaces/test_types/catkin_add_gtest');

        console.log(extensionDevelopmentPath);

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath, 
            extensionTestsPath,
            launchArgs: [
                workspace_catkin_add_gtest,
                // This disables all extensions except the one being tested
                // '--disable-extensions'
            ],
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();