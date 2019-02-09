import * as vscode from 'vscode';
import * as catkin_tools from './catkin_tools';

let catkin_extension_active = false;

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
      'extension.b2.catkin_tools.reload_compile_commands', () => {
        catkin_tools.reload_compile_commands();
      });
  context.subscriptions.push(disposable);

  catkin_extension_active = true;

  watch();
}

async function watch() {
  return new Promise(resolve => {
    (async () => {
      catkin_tools.watch_compile_commands();
      await delay(10000);
      watch();
    })();
  });
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function deactivate() {
  catkin_extension_active = false;
}
