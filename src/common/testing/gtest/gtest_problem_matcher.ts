import * as vscode from 'vscode';

function readXmlAttrAsArray(dom: any, name: string) {
    let node = dom[name];
    if (node === undefined) {
        return Array.from([]);
    } else if (!Array.isArray(node)) {
        return Array.from([node]);
    } else {
        return node;
    }
}

export function analyze(dom,
    diagnostics_collection: vscode.DiagnosticCollection) {

    let diags = new Map<string, vscode.Diagnostic[]>();

    if (dom['testsuites'] !== undefined) {
        let suites = readXmlAttrAsArray(dom['testsuites'], 'testsuite');
        for (let suite of suites) {
            let cases = readXmlAttrAsArray(suite, 'testcase');
            for (let testcase of cases) {
                let failures = readXmlAttrAsArray(testcase, 'failure');
                for (let failure of failures) {
                    try {
                        analyzeMessage(failure['#text'].split('\n'), diags);
                    } catch (e) {
                        console.error(`Failed to analyze: ${e}`);
                    }

                }
            }
        }
    }

    for (let it of diags.entries()) {
        let uri = vscode.Uri.file(it[0]);
        diagnostics_collection.set(uri, it[1]);
    }
}

export function analyzeMessage(log: string[],
    diagnostics_collection: Map<string, vscode.Diagnostic[]>) {

    let failure_message = /^(\S+):(\d+).*$/.exec(log[0]);
    console.log(failure_message);
    if (failure_message !== null) {
        let start = new vscode.Position(parseInt(failure_message[2]) - 1, 0);
        let end = new vscode.Position(parseInt(failure_message[2]) - 1, 1000);
        let message = parseContinuedDiagnostic(log, 0);
        const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end),
            message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = failure_message[1];

        updateDiagnosticDatabase(diagnostics_collection, diagnostic);
    }
}

function updateDiagnosticDatabase(diagnostics_collection: Map<string, vscode.Diagnostic[]>,
    diagnostic: vscode.Diagnostic) {

    let key = diagnostic.source;
    if (!diagnostics_collection.has(key)) {
        diagnostics_collection.set(key, [diagnostic]);

    } else {
        const diagnostics: vscode.Diagnostic[] = diagnostics_collection.get(key);
        diagnostics.push(diagnostic);
    }
}

function parseContinuedDiagnostic(log: string[], line: number) {
    let message = '';
    while (line < log.length) {
        message += log[line] + '\n';
        line++;
    }

    return message;
}