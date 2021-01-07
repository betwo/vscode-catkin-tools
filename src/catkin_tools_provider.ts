import * as vscode from 'vscode';
import { CppToolsApi, CustomConfigurationProvider, SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { status_bar_status, status_bar_prefix } from './catkin_tools';
import { CatkinWorkspace } from './catkin_workspace';

// Worker class that implements a C++ configuration provider
export class CatkinToolsProvider implements CustomConfigurationProvider {
  name: string = 'catkin_tools';
  extensionId: string = 'b2.catkin_tools';
  private disposables: vscode.Disposable[] = [];
  private workspaces = new Map<vscode.WorkspaceFolder, CatkinWorkspace>();

  constructor(public cppToolsApi: CppToolsApi) {
  }
  dispose() { }
  public async reloadAllWorkspaces(): Promise<boolean> {
    let workers = [];
    for (let [_, workspace] of this.workspaces) {
      workers.push(workspace.reload());
    }
    await Promise.all(workers);
    return true;
  }

  public getWorkspace(workspace_folder: vscode.WorkspaceFolder) {
    return this.workspaces.get(workspace_folder);
  }

  public addWorkspace(workspace_folder: vscode.WorkspaceFolder, catkin_workspace: CatkinWorkspace) {
    this.workspaces.set(workspace_folder, catkin_workspace);

    catkin_workspace.build_commands_changed.add(() => {
      this.cppToolsApi.didChangeCustomConfiguration(this);
    });
    catkin_workspace.system_paths_changed.add(() => {
      this.cppToolsApi.didChangeCustomBrowseConfiguration(this);
    });

  }
  public removeWorkspace(workspace_folder: vscode.WorkspaceFolder) {
    this.workspaces.delete(workspace_folder);
  }

  public async canProvideConfiguration(
    uri: vscode.Uri,
    token?: vscode.CancellationToken | undefined): Promise<boolean> {
    const vscode_workspace = vscode.workspace.getWorkspaceFolder(uri);
    if (vscode_workspace === undefined) {
      console.log(`Cannot provide compile flags for ${uri.fsPath}, not contained in vscode folder`);
      return false;
    }
    let catkin_workspace = this.workspaces.get(vscode_workspace);
    if (!catkin_workspace) {
      console.log(`Cannot provide compile flags for ${uri.fsPath}, not contained in any catkin workspace`);
      return false;
    }
    console.log('Can provide compile flags for', uri.fsPath);
    return true;
  }
  public async provideConfigurations(
    uris: vscode.Uri[], token?: vscode.CancellationToken | undefined):
    Promise<SourceFileConfigurationItem[]> {
    const ret: SourceFileConfigurationItem[] = [];
    for (let file of uris) {
      let vscode_workspace = vscode.workspace.getWorkspaceFolder(file);
      if (!vscode_workspace) {
        vscode.window.showErrorMessage(`Tried to provide C++ configuration for a file '${file.fsPath}' not contained in any code workspace`);
        continue;
      }
      let catkin_workspace = this.workspaces.get(vscode_workspace);
      if (!catkin_workspace) {
        vscode.window.showErrorMessage(`Tried to provide C++ configuration for a file '${file.fsPath}' not contained in any catkin workspace`);
        continue;
      }
      console.log('Providing compile flags for', file.fsPath);
      let commands = catkin_workspace.file_to_command.get(file.fsPath);
      if (commands !== undefined) {
        ret.push({
          uri: file,
          configuration: catkin_workspace.getSourceFileConfiguration(commands)
        });
        status_bar_status.text = status_bar_prefix + ' (' +
          catkin_workspace.file_to_compile_commands.get(file.fsPath) + ')';
      }
    }
    console.log(ret);
    return ret;
  }
  public async canProvideBrowseConfiguration(token?: vscode.CancellationToken):
    Promise<boolean> {
    return true;
  }
  public async provideBrowseConfiguration(token?: vscode.CancellationToken):
    Promise<WorkspaceBrowseConfiguration> {
    let paths = [];
    for (var vscode_workspace of vscode.workspace.workspaceFolders) {
      // paths.push(vscode_workspace.uri.fsPath);

      let catkin_workspace = this.workspaces.get(vscode_workspace);
      if (catkin_workspace) {
        for (var sp of catkin_workspace.system_include_browse_paths) {
          paths.push(sp);
        }
        for (var dp of catkin_workspace.default_system_include_paths) {
          paths.push(dp);
        }
      }
    }
    return { browsePath: paths };
  }
}
