import * as vscode from 'vscode';

import { API, IWorkspaceManager, IWorkspace, ITestParser } from 'vscode-catkin-tools-api';
import * as catkin_build from './catkin_tools/tasks/catkin_build';
import * as colcon from './colcon/tasks/colcon_build';
import { WorkspaceManager } from './workspace_manager';
import { Workspace } from './common/workspace';
import { Package } from './common/package';
import { test_parsers } from "./common/testing/cmake_test_parser";


let catkin_task_provider: vscode.Disposable | undefined;
let colcon_task_provider: vscode.Disposable | undefined;
let outputChannel: vscode.OutputChannel = null;

export let api = new class implements API {
  workspace_manager: WorkspaceManager;

  constructor() {
    this.workspace_manager = new WorkspaceManager();
  }

  async reload(): Promise<void> {
    return api.getWorkspaceManager().reloadAllWorkspaces();
  }

  async registerWorkspace(context: vscode.ExtensionContext,
    root: vscode.WorkspaceFolder,
    output_channel: vscode.OutputChannel): Promise<void> {
    return await this.workspace_manager.registerWorkspace(context, root, output_channel);
  }

  async unregisterWorkspace(context: vscode.ExtensionContext,
    root: vscode.WorkspaceFolder): Promise<void> {
    return await this.workspace_manager.unregisterWorkspace(context, root);
  }

  getWorkspaceManager(): IWorkspaceManager {
    return this.workspace_manager;
  }

  getWorkspaces(): Map<vscode.WorkspaceFolder, IWorkspace> {
    return this.workspace_manager.workspaces;
  }

  getWorkspace(workspace_folder: vscode.WorkspaceFolder) {
    return this.workspace_manager.getWorkspace(workspace_folder);
  }

  registerTestParser(parser: ITestParser): vscode.Disposable {
    test_parsers.push(parser);

    let scope = this;
    return {
      dispose: function () {
        const before = test_parsers.length;
        scope.unregisterTestParser(parser);

      }
    };
  }
  unregisterTestParser(parser: ITestParser) {
    for (let index = 0; index < test_parsers.length; ++index) {
      if (test_parsers[index] === parser) {
        test_parsers.splice(index, 1);
        return;
      }
    }
  }
};


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

  catkin_task_provider = vscode.tasks.registerTaskProvider('catkin_build', {
    provideTasks: async () => {
      let tasks = [];
      if (vscode.workspace.workspaceFolders !== undefined) {
        for (let root of vscode.workspace.workspaceFolders) {
          tasks = tasks.concat(await catkin_build.getCatkinBuildTask(root));
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
        await workspace.test_adapter.reloadPackageIfChanged(workspace_package);
        packageScansPending.delete(workspace_package.getName());
      } else {
        console.log(`already scanning package ${workspace_package.getName()}`);
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
