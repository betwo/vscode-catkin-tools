import * as vscode from 'vscode';

import * as catkin_build from './catkin_tools/tasks/catkin_build';
import * as colcon from './colcon/tasks/colcon_build';
import * as workspace_manager from './workspace_manager';
import { Workspace } from './common/workspace';
import { Package } from './common/package';


let catkin_task_provider: vscode.Disposable | undefined;
let colcon_task_provider: vscode.Disposable | undefined;
let outputChannel: vscode.OutputChannel = null;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("catkin_tools");

  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.reload_compile_commands', async () => {
      return workspace_manager.reloadCompileCommands();
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.reload_workspaces', async () => {
      return workspace_manager.reloadAllWorkspaces();
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.switch_profile', async () => {
      return workspace_manager.switchProfile();
    }));

  catkin_task_provider = vscode.tasks.registerTaskProvider('catkin_build', {
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

  colcon_task_provider = vscode.tasks.registerTaskProvider('colcon', {
    provideTasks: async () => {
      let tasks = [];
      for (let root of vscode.workspace.workspaceFolders) {
        tasks = tasks.concat(await colcon.getColconBuildTask(root));
      }
      return tasks;
    },
    resolveTask(_task: vscode.Task): vscode.Task |
      undefined {
      return undefined;
    }
  });

  workspace_manager.onWorkspacesChanged.event(() => {
    checkActiveEditor(vscode.window.activeTextEditor);
  });

  await workspace_manager.initialize();

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

  for (const editor of vscode.window.visibleTextEditors) {
    await checkActiveEditor(editor);
  }
  vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor) => {
    checkActiveEditor(editor);
  });

  vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
    scanUri(document.uri);
  });
}

async function checkActiveEditor(editor: vscode.TextEditor) {
  if (editor !== undefined) {
    if (editor.document !== undefined) {
      scanUri(editor.document.uri);
    }
  }
}


async function scanUri(uri: vscode.Uri) {
  const workspace_folder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspace_folder !== undefined) {
    const workspace = workspace_manager.getWorkspace(workspace_folder);
    if (workspace !== undefined) {
      scanPackageContaining(workspace, uri);
    }
  }
}

let packageScansPending = new Map<string, Package>();
async function scanPackageContaining(workspace: Workspace, uri: vscode.Uri) {
  const workspace_package = workspace.getPackageContaining(uri);
  if (workspace_package !== undefined) {
    if (workspace_package.has_tests) {
      if (packageScansPending.get(workspace_package.getName()) === undefined) {
        packageScansPending.set(workspace_package.getName(), workspace_package);
        await workspace.test_adapter.reloadPackageIfChanged(workspace_package);
        packageScansPending.delete(workspace_package.getName());
      } else {
        console.log(`already scanning package ${workspace_package.getName()}`);
      }
    }
  }
}

async function registerWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder) {
  workspace_manager.registerWorkspace(context, root, outputChannel);

}

async function unregisterWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder) {
  workspace_manager.unregisterWorkspace(context, root);
}

export function deactivate() {
  if (catkin_task_provider) {
    catkin_task_provider.dispose();
  }
  if (colcon_task_provider) {
    colcon_task_provider.dispose();
  }
}
