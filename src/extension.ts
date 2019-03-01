import * as vscode from 'vscode';

import * as catkin_build from './catkin_build';
import * as catkin_tools from './catkin_tools';

let taskProvider: vscode.Disposable|undefined;
let catkinPromise: Thenable<vscode.Task[]>|undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
      'extension.b2.catkin_tools.reload_compile_commands', () => {
        catkin_tools.reloadCompileCommand();
      });
  context.subscriptions.push(disposable);

  taskProvider = vscode.tasks.registerTaskProvider('catkin_build', {
    provideTasks: () => {
      if (!catkinPromise) {
        catkinPromise = catkin_build.getCatkinBuildTask();
      }
      return catkinPromise;
    },
    resolveTask(_task: vscode.Task): vscode.Task |
        undefined {
          return undefined;
        }
  });

  catkin_tools.initialize(context);
}

export function deactivate() {
  if (taskProvider) {
    taskProvider.dispose();
  }
}
