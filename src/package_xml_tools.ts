import * as vscode from 'vscode';
import {CatkinWorkspace} from './catkin_workspace';

export class CatkinPackageCompleterXml implements
    vscode.CompletionItemProvider {
  private workspace: CatkinWorkspace;
  constructor(workspace: CatkinWorkspace) {
    this.workspace = workspace;
  }
  provideCompletionItems(
      document: vscode.TextDocument, position: vscode.Position,
      token: vscode.CancellationToken, context: vscode.CompletionContext) {
    let lines = document.getText().split('\n');
    let ctx = lines[position.line].slice(0, position.character).trim();
    let snippets = [];
    if (ctx.match('<[^/]*depend>')) {
      for (var pkg of this.workspace.packages) {
        let item = new vscode.CompletionItem(pkg.name);
        item.documentation = 'Add dependency: ' + pkg.name;
        item.command = {title: 'Close Tag', command: 'closeTag.closeHTMLTag'};
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
