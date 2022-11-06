import * as vscode from 'vscode';

import { API } from 'vscode-catkin-tools-api';
import * as catkin_build from './catkin_tools/tasks/catkin_build';
import * as colcon from './colcon/tasks/colcon_build';
import { Workspace } from './common/workspace';
import { Package } from './common/package';
import { InternalAPI } from './internal_api';


let catkin_task_provider: vscode.Disposable | undefined;
let colcon_task_provider: vscode.Disposable | undefined;
let outputChannel: vscode.OutputChannel = null;

export let api = new InternalAPI();


export async function runTask(task: vscode.Task): Promise<boolean> {
  return new Promise<boolean>(async resolve => {
    let disposable = vscode.tasks.onDidEndTaskProcess(e => {
      if (e.execution.task === task) {
        disposable.dispose();
        resolve(e.exitCode === 0);
      }
    });
    vscode.tasks.executeTask(task);
  });
}


export async function activate(context: vscode.ExtensionContext): Promise<API> {
  outputChannel = vscode.window.createOutputChannel("catkin_tools");

  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.reload_compile_commands', async () => {
      return api.getWorkspaceManager().reloadCompileCommands();
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.reload_workspaces', async () => {
      return api.getWorkspaceManager().reloadAllWorkspaces();
    }));
  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.b2.catkin_tools.switch_profile', async () => {
      return api.getWorkspaceManager().switchProfile();
    }));

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'extension.b2.catkin_tools.reload_tests', async (item: vscode.TestItem) => {
        if (!item) {
          await vscode.window.showErrorMessage('No test selected');
          return;
        }
        return api.getWorkspaceManager().reloadTestItem(item);
      })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'extension.b2.catkin_tools.build_tests', async (item: vscode.TestItem) => {
        if (!item) {
          await vscode.window.showErrorMessage('No test selected');
          return;
        }
        return api.getWorkspaceManager().buildTestItem(item);
      })
  );


  catkin_task_provider = vscode.tasks.registerTaskProvider('catkin_build', {
    provideTasks: async () => {
      let tasks = [];
      if (vscode.workspace.workspaceFolders !== undefined) {
        for (let root of vscode.workspace.workspaceFolders) {
          let workspace = workspace_manager.getWorkspace(root);
          if (workspace !== undefined) {
            tasks = tasks.concat(await catkin_build.getCatkinBuildTask(workspace));
          }
        }
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
      if (vscode.workspace.workspaceFolders !== undefined) {
        for (let root of vscode.workspace.workspaceFolders) {
          tasks = tasks.concat(await colcon.getColconBuildTask(root));
        }
      }
      return tasks;
    },
    resolveTask(_task: vscode.Task): vscode.Task |
      undefined {
      return undefined;
    }
  });

  let workspace_manager = api.getWorkspaceManager();
  workspace_manager.onWorkspacesChanged.event(() => {
    checkActiveEditor(vscode.window.activeTextEditor);
  });
  vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor) => {
    checkActiveEditor(editor);
  });

  vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
    scanUri(document.uri);
  });

  await workspace_manager.initialize();

  setTimeout(loadWorkspaces, 1000, context);

  return api;
}

async function loadWorkspaces(context: vscode.ExtensionContext) {
  vscode.workspace.onDidChangeWorkspaceFolders(workspaces => {
    for (const workspace of workspaces.removed) {
      unregisterWorkspace(context, workspace);
    }
    for (const workspace of workspaces.added) {
      registerWorkspace(context, workspace);
    }
  });


  let workers = [];
  if (vscode.workspace.workspaceFolders !== undefined) {
    for (let root of vscode.workspace.workspaceFolders) {
      workers.push(registerWorkspace(context, root));
    }
  }
  await Promise.all(workers);

  for (const editor of vscode.window.visibleTextEditors) {
    await checkActiveEditor(editor);
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    const workspace = api.getWorkspace(workspace_folder);
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
        await workspace.test_adapter.refreshPackage(workspace_package, true);
        packageScansPending.delete(workspace_package.getName());
      }
    }
  }
}

async function registerWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder) {
  api.registerWorkspace(context, root, outputChannel);

}

async function unregisterWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder) {
  api.unregisterWorkspace(context, root);
}

export function deactivate() {
  if (catkin_task_provider) {
    catkin_task_provider.dispose();
  }
  if (colcon_task_provider) {
    colcon_task_provider.dispose();
  }
}
