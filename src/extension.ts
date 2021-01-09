import * as vscode from 'vscode';
import * as vscode_test from 'vscode-test-adapter-api';
import { CppToolsApi, getCppToolsApi, Version } from 'vscode-cpptools';

import * as catkin_build from './catkin_build';
import * as catkin_tools from './catkin_tools';
import { CatkinToolsProvider } from './catkin_tools_provider';
import { CatkinTestAdapter } from './catkin_test_adapter';
import { CatkinWorkspace } from './catkin_workspace';


let taskProvider: vscode.Disposable | undefined;
let outputChannel: vscode.OutputChannel = null;

let test_explorer_api: vscode.Extension<vscode_test.TestHub>;
let cpp_tools_api: CppToolsApi;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("catkin_tools");

  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.reload_compile_commands', async () => {
      return catkin_tools.reloadAllWorkspaces();
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.reload_workspaces', async () => {
      return catkin_tools.reloadAllWorkspaces();
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.switch_profile', async () => {
      return catkin_tools.switchProfile();
    }));

  taskProvider = vscode.tasks.registerTaskProvider('catkin_build', {
    provideTasks: async () => {
      let tasks = [];
      for (let root of vscode.workspace.workspaceFolders) {
        tasks = tasks.concat(await catkin_build.getCatkinBuildTask(root));
      }
      return tasks;
    },
    resolveTask(_task: vscode.Task): vscode.Task |
      undefined {
      return undefined;
    }
  });

  test_explorer_api = vscode.extensions.getExtension<vscode_test.TestHub>(vscode_test.testExplorerExtensionId);
  cpp_tools_api = await getCppToolsApi(Version.v2);
  if (cpp_tools_api) {
    if (!cpp_tools_api.notifyReady) {
      vscode.window.showInformationMessage(
        'Catkin tools only supports C/C++ API 2.0 or later.');
      return;
    }
  }

  vscode.workspace.onDidChangeWorkspaceFolders(workspaces => {
    for (const workspace of workspaces.removed) {
      unregisterWorkspace(context, workspace);
    }
    for (const workspace of workspaces.added) {
      registerWorkspace(context, workspace);
    }
  });


  let workers = [];
  for (let root of vscode.workspace.workspaceFolders) {
    workers.push(registerWorkspace(context, root));
  }
  await Promise.all(workers);

  checkActiveEditor(vscode.window.activeTextEditor);
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    checkActiveEditor(editor);
  });
}

async function checkActiveEditor(editor: vscode.TextEditor) {
  if (editor !== undefined) {
    if (editor.document !== undefined) {
      const workspace_folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (workspace_folder !== undefined) {
        const catkin_workspace = catkin_tools.getProvider().getWorkspace(workspace_folder);
        if (catkin_workspace !== undefined) {
          const catkin_package = catkin_workspace.getPackageContaining(editor.document.uri);
          if (catkin_package !== undefined) {
            if (catkin_package.has_tests && !catkin_package.tests_loaded) {
              await catkin_workspace.test_adapter.reloadPackageIfChanged(catkin_package);
            }
          }
        }
      }
    }
  }
}

async function registerWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder) {
  if (await catkin_tools.isCatkinWorkspace(root)) {
    if (catkin_tools.getProvider() === undefined) {
      // Inform cpptools that a custom config provider will be able to service
      // the current workspace.
      catkin_tools.setProvider(new CatkinToolsProvider(cpp_tools_api));
      cpp_tools_api.registerCustomConfigurationProvider(catkin_tools.getProvider());
    }

    let workspace: CatkinWorkspace = catkin_tools.getProvider().getWorkspace(root);
    // first try to get a cached instance of the workspace.
    // this might be triggered if the same workspace is opened in different folders
    if (workspace === undefined) {
      workspace = await catkin_tools.initialize(context, root, outputChannel);
      outputChannel.appendLine(`Adding new workspace ${root.uri.fsPath}`);

      workspace.onWorkspaceInitialized.event((initialized) => {
        if (catkin_tools.getProvider()) {
          catkin_tools.getProvider().addWorkspace(root, workspace);
          cpp_tools_api.notifyReady(catkin_tools.getProvider());
        }
        if (test_explorer_api) {
          workspace.test_adapter = new CatkinTestAdapter(
            root.uri.fsPath,
            workspace,
            outputChannel
          );
          test_explorer_api.exports.registerTestAdapter(workspace.test_adapter);
        }

        checkActiveEditor(vscode.window.activeTextEditor);
      });
      await workspace.checkProfile();

    } else {
      outputChannel.appendLine(`Reusing workspace ${await workspace.getRootPath()} for folder ${root.uri.fsPath}`);
    }
  } else {
    outputChannel.appendLine(`Folder ${root.uri.fsPath} is not a catkin workspace.`);
  }
}

async function unregisterWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder) {
  let workspace = catkin_tools.getProvider().getWorkspace(root);
  if (workspace !== undefined) {
    if (test_explorer_api) {
      test_explorer_api.exports.unregisterTestAdapter(workspace.test_adapter);
    }
    if (catkin_tools.getProvider()) {
      catkin_tools.getProvider().removeWorkspace(root);
    }

    workspace.dispose();
  }
}

export function deactivate() {
  if (taskProvider) {
    taskProvider.dispose();
  }
}
