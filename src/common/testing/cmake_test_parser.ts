import * as glob from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonfile from 'jsonfile';

import { TestSuite, TestBuildTarget, TestSource, ITestParser } from 'vscode-catkin-tools-api';

import { Package } from "../package";
import { runShellCommand } from '../shell_command';
import { getExtensionConfiguration } from '../configuration';
import { TestParserGTest } from './gtest/test_parser_gtest';

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

export async function parsePackageForTests(workspace_package: Package): Promise<TestSuite> {
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

async function queryCMakeFileApiCodeModel(workspace_package: Package): Promise<TestSuite> {
    const package_space = workspace_package.getAbsolutePath();
    const build_space = workspace_package.build_space.toString();
    const api_dir = path.join(build_space, ".cmake", "api", "v1");
    const query_dir = path.join(api_dir, "query", "client-workspace-vscode");
    try {
        await fs.promises.mkdir(query_dir, { recursive: true });

        const query_txt = `{ "requests": [{"kind": "codemodel", "version": 2 }] }`;
        const query_file = path.join(query_dir, "query.json");
        await fs.promises.writeFile(query_file, query_txt);
        const source_command = workspace_package.workspace.workspace_provider.makeRosSourcecommand();
        const output = await runShellCommand(source_command + " && cmake .", build_space);
        console.debug("CMake Query result:");
        console.debug(output.stdout);
    } catch (error) {
        console.error(error);
        return undefined;
    }

    const reply_dir = path.join(api_dir, "reply");
    const files = await fs.promises.readdir(reply_dir);

    let test_regexes: RegExp[] = [];
    for (let expr of getExtensionConfiguration('gtestMacroRegex')) {
        test_regexes.push(new RegExp(`.*(${expr})`));
    }

    let build_targets = new Map<string, TestBuildTarget>();
    for (const file_name of files) {
        if (file_name.startsWith("target")) {
            const file_path = path.join(reply_dir, file_name);
            const target = await jsonfile.readFile(file_path);

            for(let test_type of test_parsers) {
                if (test_type.matches(target)) {
                    for (const source of target.sources) {
                        try {
                            let build_target = build_targets.get(target.name);
                            if (build_target === undefined) {
                                const line_number = traceLineNumber(target, test_regexes);
                                build_target = new TestBuildTarget(target.name, path.join(target.paths.source, "CMakeLists.txt"), line_number);
                                build_targets.set(target.name, build_target);
                            }
                            build_target.test_sources.push(new TestSource(
                                source.path,
                                await test_type.analyzeSourceFile(path.join(package_space.toString(), source.path))
                            ));
                        } catch (error) {
                            console.error(`Cannot analyze ${source.path}'s test details: ${error}`);
                        }
                    }
                }

            }
        }
    }

    return new TestSuite(Array.from(build_targets.values()));
}

function traceLineNumber(target, test_regexes: RegExp[]) {
    const graph = target.backtraceGraph;
    for (const node of graph.nodes) {
        if (node.command !== undefined) {
            const command = graph.commands[node.command];
            for (let test_regex of test_regexes) {
                if (command.match(test_regex) !== null) {
                    return node.line - 1;
                }
            }
        }

    }
    return undefined;
}