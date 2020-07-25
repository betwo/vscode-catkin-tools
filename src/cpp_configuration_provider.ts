import * as vscode from 'vscode';
import { CppToolsApi, CustomConfigurationProvider, SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { status_bar_status, status_bar_prefix } from './catkin_tools';
import { CatkinWorkspace } from './catkin_workspace';

// Worker class that implements a C++ configuration provider
export class CatkinToolsProvider implements CustomConfigurationProvider {
  name: string = 'catkin_tools';
  extensionId: string = 'b2.catkin_tools';
  public workspace: CatkinWorkspace;
  private disposables: vscode.Disposable[] = [];
  private cppToolsApi: CppToolsApi;
  constructor(workspace: CatkinWorkspace, cppToolsApi: CppToolsApi) {
    this.workspace = workspace;
    this.cppToolsApi = cppToolsApi;
  }
  dispose() { }
  public async loadDataBases() {
    await this.workspace.reload();
  }
  public startListening() {
    this.workspace.build_commands_changed.add(() => {
      this.cppToolsApi.didChangeCustomConfiguration(this);
    });
    this.workspace.system_paths_changed.add(() => {
      this.cppToolsApi.didChangeCustomBrowseConfiguration(this);
    });
  }
  public async canProvideConfiguration(
    uri: vscode.Uri,
    token?: vscode.CancellationToken | undefined): Promise<boolean> {
    const fileWp = vscode.workspace.getWorkspaceFolder(uri);
    if (fileWp === undefined) {
      console.log('Cannot provide compile flags for', uri.fsPath);
      return false;
    }
    console.log('Can provide compile flags for', uri.fsPath);
    return true;
  }
  public async provideConfigurations(
    uris: vscode.Uri[], token?: vscode.CancellationToken | undefined):
    Promise<SourceFileConfigurationItem[]> {
    const ret: SourceFileConfigurationItem[] = [];
    for (var file of uris) {
      console.log('Providing compile flags for', file.fsPath);
      let commands = this.workspace.file_to_command.get(file.fsPath);
      if (commands !== undefined) {
        ret.push({
          uri: file,
          configuration: this.workspace.getSourceFileConfiguration(commands)
        });
        status_bar_status.text = status_bar_prefix + ' (' +
          this.workspace.file_to_compile_commands.get(file.fsPath) + ')';
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
    for (var f of vscode.workspace.workspaceFolders) {
      paths.push(f.uri.fsPath);
    }
    for (var sp of this.workspace.system_include_browse_paths) {
      paths.push(sp);
    }
    for (var dp of this.workspace.default_system_include_paths) {
      paths.push(dp);
    }
    return { browsePath: paths };
  }
}
