import * as vscode from 'vscode';
import { Workspace } from './workspace';

export class PackageXmlCompleter implements
  vscode.CompletionItemProvider {
  private workspace: Workspace;
  constructor(workspace: Workspace) {
    this.workspace = workspace;
  }
  provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
    token: vscode.CancellationToken, context: vscode.CompletionContext) {
    let lines = document.getText().split('\n');
    let ctx = lines[position.line].slice(0, position.character).trim();
    let snippets = [];
    if (ctx.match('<[^/]*depend>')) {
      for (var [_, pkg] of this.workspace.packages) {
        let item = new vscode.CompletionItem(pkg.name);
        item.documentation = 'Add dependency: ' + pkg.name;
        snippets.push(item);
      }
    } else {
      for (var type of
        ['depend', 'build_depend', 'build_export_depend',
          'exec_depend']) {
        let item = new vscode.CompletionItem(`<${type}>`);
        item.range = document.getWordRangeAtPosition(position, /[^\s]+/);
        item.kind = vscode.CompletionItemKind.Keyword;
        item.command = {
          title: 'Suggest',
          command: 'editor.action.triggerSuggest'
        };
        snippets.push(item);
      }
    }
    return new vscode.CompletionList(snippets, true);
  }
}
