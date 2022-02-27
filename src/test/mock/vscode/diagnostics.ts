import * as vscode from 'vscode';

export class MockDiagnosticCollection implements vscode.DiagnosticCollection {
	name: string;
	diagnostics = new Map<String, [vscode.Uri, vscode.Diagnostic[]]>();

	set(uri: any, diagnostics?: any): void {
		if (uri !== undefined && diagnostics !== undefined) {
			const existing = this.diagnostics.get(uri);
			if (existing !== undefined) {
				this.diagnostics.set(uri.toString(), [existing[0], existing[1].concat(diagnostics)]);
			} else {
				this.diagnostics.set(uri.toString(), [uri, diagnostics]);
			}
		}
	}
	delete(uri: vscode.Uri): void {
		this.diagnostics.delete(uri.toString());
	}
	clear(): void {
		this.diagnostics.clear();
	}
	forEach(callback: (uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[], collection: vscode.DiagnosticCollection) => any, thisArg?: any): void {
		this.diagnostics.forEach((uri_and_diagnostic, path, map) => {
			callback(uri_and_diagnostic[0], uri_and_diagnostic[1], this);
		});
	}
	get(uri: vscode.Uri): readonly vscode.Diagnostic[] {
		const entry = this.diagnostics.get(uri.toString());
		if(entry === undefined) {
			return undefined;
		}
		return entry[1];
	}
	has(uri: vscode.Uri): boolean {
		return this.diagnostics.has(uri.toString());
	}
	dispose(): void {
		this.diagnostics.clear();
	}
	entries(): number {
		return this.diagnostics.size;
	}
}