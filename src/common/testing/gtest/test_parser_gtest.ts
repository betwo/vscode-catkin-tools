import * as fs from 'fs';
import { TestCase, TestFixture, ITestParser } from 'vscode-catkin-tools-api';

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
        return false;
    }

    public async analyzeSourceFile(source_file: fs.PathLike): Promise<TestFixture[]> {
        console.log(`Analyzing ${source_file} for gtest names`);
        let test_fixtures = new Map<string, TestFixture>();
        let data = await fs.promises.readFile(source_file);

        const gtest_regex_start = new RegExp(/\s*(TYPED_)?TEST(_[PF])?\(/);
        const gtest_regex = new RegExp(/\s*(TYPED_)?TEST(_[PF])?\(([^,]+)\s*,\s*([^,]+)\)\s*/);

        let line_number = 0;
        const source_code = data.toString().split("\n");
        let current_line = "";
        for (let raw_line_index = 0; raw_line_index < source_code.length; ++raw_line_index) {
            const raw_line = source_code[raw_line_index];
            const line = raw_line.trimLeft();
            let line_length = 1;
            if (line.match(gtest_regex_start) !== null) {
                current_line = line;
                while (current_line.indexOf('{') < 0 && raw_line_index < source_code.length) {
                    raw_line_index += 1;
                    line_length += 1;
                    const raw_line = source_code[raw_line_index];
                    current_line += raw_line.trimLeft();
                }
                const gtest = current_line.match(gtest_regex);
                if (gtest !== null) {
                    const test_fixture_name = gtest[3];
                    const test_case_name = gtest[4];

                    let fixture = test_fixtures.get(test_fixture_name);
                    if (fixture === undefined) {
                        const fixture_line_number = findFirstLine(source_code, test_fixture_name);
                        fixture = new TestFixture(test_fixture_name, fixture_line_number !== undefined ? fixture_line_number : line_number);
                        test_fixtures.set(test_fixture_name, fixture);
                    }

                    fixture.test_cases.push(new TestCase(test_case_name, line_number));
                }
            }
            line_number += line_length;
        }
        return Array.from(test_fixtures.values());
    }

}