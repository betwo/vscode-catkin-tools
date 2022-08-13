import * as glob from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonfile from 'jsonfile';

import { ITestParser, WorkspaceTestInterface, WorkspaceTestIdentifierTemplate, IPackage } from 'vscode-catkin-tools-api';

import { Package } from "../package";
import { runShellCommand } from '../shell_command';
import { getExtensionConfiguration } from '../configuration';
import { TestParserGTest } from './gtest/test_source_parser';
import { logger } from '../logging';

export let test_parsers: ITestParser[] = [new TestParserGTest()];

export async function skimCmakeListsForTests(workspace_package: Package): Promise<boolean> {
    let test_regexes: RegExp[] = [];
    for (let expr of getExtensionConfiguration('gtestMacroRegex')) {
        test_regexes.push(new RegExp(`.*(${expr})`));
    }

    const cmake_lists_pattern = `${workspace_package.getAbsolutePath()}/**/CMakeLists.txt`;
    const cmake_files = await glob(
        [cmake_lists_pattern]
    );
    for (let cmake_file of cmake_files) {
        let target_iterator = iterateTestTargets(cmake_file.toString());
        let target = await target_iterator.next();
        while (!target.done) {
            target_iterator.return();
            return true;
        }
    }
    return false;
}

export async function parsePackageForTests(workspace_package: IPackage): Promise<WorkspaceTestInterface[]> {
    return queryCMakeFileApiCodeModel(workspace_package);
}

async function* iterateTestTargets(cmake_file: fs.PathLike) {
    let test_regexes: RegExp[] = [];
    for (let expr of getExtensionConfiguration('gtestMacroRegex')) {
        test_regexes.push(new RegExp(`.*(${expr})`));
    }

    let data = await fs.promises.readFile(cmake_file.toString());
    let cmake = data.toString();
    for (let test_regex of test_regexes) {
        for (let row of cmake.split('\n')) {
            let tests = row.match(test_regex);
            if (tests) {
                yield row;
            }
        }
    }
}

async function queryCMakeFileApiCodeModel(workspace_package: IPackage): Promise<WorkspaceTestInterface[]> {
    const package_space = workspace_package.getAbsolutePath();
    const build_space = workspace_package.current_build_space.toString();
    const api_dir = path.join(build_space, ".cmake", "api", "v1");
    const query_dir = path.join(api_dir, "query", "client-workspace-vscode");
    try {
        await fs.promises.mkdir(query_dir, { recursive: true });

        const query_txt = `{ "requests": [{"kind": "codemodel", "version": 2 }] }`;
        const query_file = path.join(query_dir, "query.json");
        await fs.promises.writeFile(query_file, query_txt);
        const source_command = workspace_package.workspace.workspace_provider.makeRosSourcecommand();
        const output = await runShellCommand(source_command + " && cmake .", [], build_space);
        logger.debug("CMake Query result:");
        logger.debug(output.stdout);
    } catch (error) {
        logger.error(error);
        return undefined;
    }

    const reply_dir = path.join(api_dir, "reply");
    const files = await fs.promises.readdir(reply_dir);

    let test_regexes: RegExp[] = [];
    for (let expr of getExtensionConfiguration('gtestMacroRegex')) {
        test_regexes.push(new RegExp(`.*(${expr})`));
    }

    let test_executables = new Map<string, WorkspaceTestInterface>();
    for (const file_name of files) {
        if (file_name.startsWith("target")) {
            const file_path = path.join(reply_dir, file_name);
            const target = await jsonfile.readFile(file_path);

            for (let test_type of test_parsers) {
                if (test_type.matches(target)) {
                    for (const source of target.sources) {
                        try {
                            const fixtures = await test_type.analyzeSourceFile(target.name, path.join(package_space.toString(), source.path));
                            let test_executable: WorkspaceTestInterface = test_executables.get(target.name);
                            if (test_executable !== undefined) {
                                for (const fixture of fixtures) {
                                    test_executable.children.push(fixture);
                                }
                            } else {
                                const line_number = traceLineNumber(target);
                                test_executable = {
                                    type: 'suite',
                                    id: new WorkspaceTestIdentifierTemplate(`exec_${target.name}`),
                                    is_parameterized: false,
                                    file: path.join(workspace_package.absolute_path.toString(), target.paths.source, "CMakeLists.txt"),
                                    line: line_number,
                                    children: fixtures,
                                };
                                test_executables.set(target.name, test_executable);
                            }
                        } catch (error) {
                            logger.error(`Cannot analyze ${source.path}'s test details: ${error}`);
                        }
                    }
                }

            }
        }
    }

    return Array.from(test_executables.values());
}

function traceLineNumber(target: any) {
    let bottom_most_cmake_lists_index: number;
    for (const i in target.backtraceGraph.files) {
        const file = target.backtraceGraph.files[i];
        if (file.endsWith("CMakeLists.txt")) {
            bottom_most_cmake_lists_index = parseInt(i);
            break;
        }
    }
    const graph = target.backtraceGraph;
    for (const node of graph.nodes) {
        if (node.command !== undefined && parseInt(node.file) === bottom_most_cmake_lists_index) {
            return node.line - 1;
        }

    }
    return undefined;
}