import * as assert from 'assert';
import { expect } from 'chai';
import { analyze } from './gtest_problem_matcher';
import * as vscode from 'vscode';
import * as xml from 'fast-xml-parser';

import { MockDiagnosticCollection } from '../../../test/mock/vscode/diagnostics';

function makeDom(text: string) {
	const options = {
		ignoreAttributes: false,
		attrNodeName: "attr"
	};
	return xml.parse(text, options);
}

describe('GTest Problem Matcher', () => {
	before(async function () {
	});

	it("Successful test results in empty diagnostics", () => {
		let diagnostics = new MockDiagnosticCollection();
		const test_message =
			`<?xml version="1.0" encoding="UTF-8"?>
			<testsuites tests="6" failures="0" disabled="0" errors="0" time="1.352" timestamp="2022-01-29T19:23:29" name="AllTests">
			  <testsuite name="SuccessfulTest" tests="6" failures="0" disabled="0" errors="0" time="0.019" timestamp="2022-01-29T19:23:29">
				<testcase name="Test1" status="run" result="completed" time="0.1" timestamp="2022-01-29T19:23:29" classname="SuccessfulTest" />
				<testcase name="Test2" status="run" result="completed" time="0.1" timestamp="2022-01-29T19:23:29" classname="SuccessfulTest" />
				<testcase name="Test3" status="run" result="completed" time="0.1" timestamp="2022-01-29T19:23:29" classname="SuccessfulTest" />
				<testcase name="Test4" status="run" result="completed" time="0.1" timestamp="2022-01-29T19:23:29" classname="SuccessfulTest" />
				<testcase name="Test5" status="run" result="completed" time="0.1" timestamp="2022-01-29T19:23:29" classname="SuccessfulTest" />
				<testcase name="Test6" status="run" result="completed" time="0.1" timestamp="2022-01-29T19:23:29" classname="SuccessfulTest" />
			  </testsuite>
			</testsuites>`;

		analyze(makeDom(test_message), diagnostics);
		expect(diagnostics.entries()).to.equal(0);
	});

	it("Failing test results in diagnostics", () => {
		let diagnostics = new MockDiagnosticCollection();
		const test_message =
			`<?xml version="1.0" encoding="UTF-8"?>
			<testsuites tests="6" failures="0" disabled="0" errors="0" time="1.352" timestamp="2022-01-29T19:23:29" name="AllTests">
			  <testsuite name="PartiallyFailingTest" tests="3" failures="1" disabled="0" errors="0" time="0.02" timestamp="2022-01-29T19:23:29">
				<testcase name="FailingTest" status="run" result="completed" time="0.003" timestamp="2022-01-29T19:23:29" classname="PartiallyFailingTest">
				  <failure message="/path/to/failing/test/suite.cpp:256&#x0A;ERROR_MESSAGE" type=""><![CDATA[/path/to/failing/test/suite.cpp:256
			"ERROR_MESSAGE"]]></failure>
				</testcase>
			    <testcase name="SuccessfulTest1" status="run" result="completed" time="0.006" timestamp="2022-01-29T19:23:29" classname="PartiallyFailingTest" />
			    <testcase name="SuccessfulTest2" status="run" result="completed" time="0.011" timestamp="2022-01-29T19:23:29" classname="PartiallyFailingTest" />
			  </testsuite>
			</testsuites>`;

		analyze(makeDom(test_message), diagnostics);
		expect(diagnostics.entries()).to.equal(1);

		const uri = vscode.Uri.parse("file:///path/to/failing/test/suite.cpp");
		assert(diagnostics.has(uri));
		const diag = diagnostics.get(uri);
		assert(diag);
		expect(diag[0].message).to.equal(`/path/to/failing/test/suite.cpp:256\n\t\t\t"ERROR_MESSAGE"\n`);
	});
});