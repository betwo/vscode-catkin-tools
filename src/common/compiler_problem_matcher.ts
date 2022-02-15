import * as vscode from 'vscode';
import { IWorkspace } from 'vscode-catkin-tools-api';

export function analyze(
    workspace: IWorkspace,
    error_output,
    diagnostics_collection: vscode.DiagnosticCollection
) {
    let diags = new Map<string, vscode.Diagnostic[]>();

    analyzeLines(workspace, error_output.split('\n'), diags);

    for (let it of diags.entries()) {
        let uri = vscode.Uri.file(it[0]);
        diagnostics_collection.set(uri, it[1]);
    }
}


function analyzeLines(
    workspace: IWorkspace,
    log: string[],
    diagnostics_collection: Map<string, vscode.Diagnostic[]>
) {
    let related_information: vscode.DiagnosticRelatedInformation[] = [];
    for (let line in log) {
        let gcc_failure_message = /^(.*):(\d+):(\d+):\s+(warning|error|.*):\s+(.*)$/.exec(log[line]);
        if (gcc_failure_message !== null) {
            console.log(gcc_failure_message);
            let start = new vscode.Position(parseInt(gcc_failure_message[2]) - 1, 0);
            let end = new vscode.Position(parseInt(gcc_failure_message[2]) - 1, 1000);
            let message = gcc_failure_message[5];
            let severity: vscode.DiagnosticSeverity;
            let severity_str = gcc_failure_message[4];
            switch (severity_str) {
                case "warning":
                    severity = vscode.DiagnosticSeverity.Warning;
                    break;
                case "error":
                    severity = vscode.DiagnosticSeverity.Error;
                    break;
                default:
                    severity = vscode.DiagnosticSeverity.Information;
                    break;
            }

            const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end),
                message, severity);
            if (related_information.length > 0) {
                diagnostic.relatedInformation = related_information;
            }

            updateDiagnosticDatabase(diagnostics_collection, diagnostic, gcc_failure_message[1]);
            related_information = [];
        } else {
            // not the error message
            let requirement = /^(.*):(\d+):(\d+):\s+(required\s+.*)$/.exec(log[line]);
            if (requirement !== null) {
                let start = new vscode.Position(parseInt(requirement[2]) - 1, 0);
                let end = new vscode.Position(parseInt(requirement[2]) - 1, 1000);
                related_information.push({
                    message: requirement[4],
                    location: {
                        uri: vscode.Uri.file(requirement[1]),
                        range: new vscode.Range(start, end),
                    }
                });
            } else {
                let file_reference = /^(.*from) (.*):(\d+)[,:]$/.exec(log[line]);
                if (file_reference !== null) {
                    let start = new vscode.Position(parseInt(file_reference[3]) - 1, 0);
                    let end = new vscode.Position(parseInt(file_reference[3]) - 1, 1000);
                    related_information.push({
                        message: file_reference[0],
                        location: {
                            uri: vscode.Uri.file(file_reference[2]),
                            range: new vscode.Range(start, end),
                        }
                    });
                } else {
                    console.debug("Unhandled line: ", log[line]);
                }
            }
        }

        let cmake_failure_message = /^CMake\s+(Warning|Error)\s+at\s+(\S+):(\d+)\s*(.*):\s*$/.exec(log[line]);
        if (cmake_failure_message !== null) {
            console.log(cmake_failure_message);
            let start = new vscode.Position(parseInt(cmake_failure_message[3]) - 1, 0);
            let end = new vscode.Position(parseInt(cmake_failure_message[3]) - 1, 1000);
            let message = log[parseInt(line) + 1].trim();
            let severity = cmake_failure_message[1] === "Warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
            const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end),
                message, severity);

            updateDiagnosticDatabase(diagnostics_collection, diagnostic, cmake_failure_message[2]);
        }
    }
}

function updateDiagnosticDatabase(diagnostics_collection: Map<string, vscode.Diagnostic[]>,
    diagnostic: vscode.Diagnostic,
    file: string) {

    let key = file;
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