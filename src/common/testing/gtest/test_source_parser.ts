import * as fs from 'fs';
import { WorkspaceTestInterface, ITestParser, WorkspaceTestIdentifierTemplate } from 'vscode-catkin-tools-api';
import { logger } from '../../logging';

import { findFirstLine } from '../utils';

export class TestParserGTest implements ITestParser {

    public matches(json_object: any) {
        if (json_object.dependencies !== undefined && json_object.type === "EXECUTABLE") {
            for (const dependency of json_object.dependencies) {
                if (dependency.id.indexOf('gtest') >= 0 || dependency.id.indexOf('gmock') >= 0) {
                    return true;
                }
            }
        }
        if (json_object.link !== undefined && json_object.type === "EXECUTABLE") {
            for (const fragment of json_object.link.commandFragments) {
                if (fragment.fragment.indexOf('libgtest') >= 0) {
                    return true;
                }
            }
        }
        return false;
    }

    public async analyzeSourceFile(suite_name: string, source_file: fs.PathLike): Promise<WorkspaceTestInterface[]> {
        logger.debug(`Analyzing ${source_file} for gtest names`);
        let data = await fs.promises.readFile(source_file);
        return this.analyzeSource(suite_name, source_file, data.toString());
    }

    public analyzeSource(suite_name: string, source_file: fs.PathLike, source: String): WorkspaceTestInterface[] {
        const gtest_regex_start = new RegExp(/^\s*(TYPED_)?TEST(_[PF])?\(/);
        const gtest_regex = new RegExp(/^\s*(TYPED_)?TEST(_[PF])?\(([^,]+)\s*,\s*([^,]+)\)\s*/);

        let test_fixtures = new Map<string, WorkspaceTestInterface>();

        let line_number = 0;
        const source_code = source.split("\n");
        let current_line = "";
        for (let raw_line_index = 0; raw_line_index < source_code.length; ++raw_line_index) {
            const raw_line = source_code[raw_line_index];
            const line = raw_line.trimStart();
            let line_length = 1;
            if (line.match(gtest_regex_start) !== null) {
                current_line = line;
                while (current_line.indexOf('{') < 0 && raw_line_index < source_code.length) {
                    raw_line_index += 1;
                    line_length += 1;
                    const raw_line = source_code[raw_line_index];
                    current_line += raw_line.trimStart();
                }
                const gtest = current_line.match(gtest_regex);
                if (gtest !== null) {
                    const test_fixture_name = gtest[3];
                    const test_case_name = gtest[4];

                    const is_fixture_parameterized = gtest[1] === "TYPED_" ||  gtest[2] === "_P";
                    const is_test_parameterized = gtest[1] !== "TYPED_" && gtest[2] === "_P";

                    let fixture = test_fixtures.get(test_fixture_name);
                    if (fixture === undefined) {
                        const fixture_line_number = findFirstLine(source_code, test_fixture_name);
                        fixture = {
                            id: new WorkspaceTestIdentifierTemplate(`fixture_${suite_name}`, test_fixture_name),
                            type: "gtest",
                            file: source_file.toString(),
                            line: fixture_line_number !== undefined ? fixture_line_number : line_number,
                            children: [],
                            is_parameterized: is_fixture_parameterized,
                            instances: is_fixture_parameterized ? [] : undefined
                        };
                        test_fixtures.set(test_fixture_name, fixture);
                    }

                    let test_case: WorkspaceTestInterface = {
                        id: new WorkspaceTestIdentifierTemplate(
                            `test_${suite_name}`,
                            test_fixture_name,
                            test_case_name
                        ),
                        type: "gtest",
                        children: [],
                        file: source_file.toString(),
                        line: line_number,
                        is_parameterized: is_test_parameterized,
                        instances: is_test_parameterized ? [] : undefined
                    };
                    fixture.children.push(test_case);
                }
            }
            line_number += line_length;
        }
        return Array.from(test_fixtures.values());
    }

}