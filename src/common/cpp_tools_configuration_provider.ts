import * as vscode from 'vscode';
import * as jsonfile from 'jsonfile';
import { CppToolsApi, CustomConfigurationProvider, SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { setStatusText } from "./status_bar";
import { Workspace } from './workspace';
import { getExtensionConfiguration } from './configuration';
import { api } from '../extension';

// Worker class that implements a C++ configuration provider
export class CppToolsConfigurationProvider implements CustomConfigurationProvider {
  name: string = 'catkin_tools';
  extensionId: string = 'b2.catkin_tools';

  constructor(public cppToolsApi: CppToolsApi) {
  }
  dispose() { }
  public async reloadAllWorkspaces(): Promise<boolean> {
    let workers = [];
    for (let [_, workspace] of api.getWorkspaces()) {
      workers.push(workspace.reload());
    }
    await Promise.all(workers);
    return true;
  }

  private getWorkspace(workspace_folder: vscode.WorkspaceFolder) {
    return api.getWorkspace(workspace_folder);
  }

  public addWorkspace(workspace_folder: vscode.WorkspaceFolder, workspace: Workspace) {
    api.getWorkspaces().set(workspace_folder, workspace);

    workspace.build_commands_changed.add(() => {
      this.cppToolsApi.didChangeCustomConfiguration(this);
      this.mergeCompileCommandsFiles();
    });
    workspace.system_paths_changed.add(() => {
      this.cppToolsApi.didChangeCustomBrowseConfiguration(this);
    });

  }
  public removeWorkspace(workspace_folder: vscode.WorkspaceFolder) {
    api.getWorkspaces().delete(workspace_folder);
  }

  public async mergeCompileCommandsFiles() {
    const merged_compile_commands_json_path = getExtensionConfiguration('mergedCompileCommandsJsonPath', "");
    if (merged_compile_commands_json_path.length > 0) {
      const opts = { spaces: 2, EOL: '\r\n' };
      if (merged_compile_commands_json_path.indexOf('${workspaceFolder}') >= 0) {
        // save per workspace
        if (vscode.workspace.workspaceFolders !== undefined) {
          for (const folder of vscode.workspace.workspaceFolders) {
            const output_path = merged_compile_commands_json_path.replace("${workspaceFolder}", folder.uri.fsPath);
            const wsfolder = this.getWorkspace(folder);
            if (wsfolder !== undefined) {
              const commands = this.getWorkspace(folder).collectCompileCommands();
              console.log(`Writing merged database in workspace ${output_path}`);
              await jsonfile.writeFile(output_path, commands, opts);
            } else {
              vscode.window.showWarningMessage(`Cannot get catkin workspace for folder ${folder}`);
            }
          }
        }
      } else {
        // merge into one
        let commands = [];
        if (vscode.workspace.workspaceFolders !== undefined) {
          for (const folder of vscode.workspace.workspaceFolders) {
            const wsfolder = this.getWorkspace(folder);
            if (wsfolder !== undefined) {
              commands = commands.concat(wsfolder.collectCompileCommands());
            } else {
              vscode.window.showWarningMessage(`Cannot get catkin workspace for folder ${folder}`);
            }
          }
        }
        console.log(`Writing merged database in ${merged_compile_commands_json_path}`);
        await jsonfile.writeFile(merged_compile_commands_json_path, commands, opts);
      }
    }
  }

  public async canProvideConfiguration(
    uri: vscode.Uri,
    token?: vscode.CancellationToken | undefined): Promise<boolean> {
    const vscode_workspace = vscode.workspace.getWorkspaceFolder(uri);
    if (vscode_workspace === undefined) {
      console.log(`Cannot provide compile flags for ${uri.fsPath}, not contained in vscode folder`);
      return false;
    }
    let workspace = api.getWorkspace(vscode_workspace);
    if (!workspace) {
      console.log(`Cannot provide compile flags for ${uri.fsPath}, not contained in any workspace`);
      return false;
    }

    let workspace_package = workspace.getPackageContaining(uri);
    if (!workspace_package) {
      console.log(`Cannot provide compile flags for ${uri.fsPath}, not contained in any package`);
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
      let workspace = api.getWorkspace(vscode_workspace);
      if (!workspace) {
        vscode.window.showErrorMessage(`Tried to provide C++ configuration for a file '${file.fsPath}' not contained in any workspace`);
        continue;
      }
      console.log('Providing compile flags for', file.fsPath);
      let commands = workspace.file_to_command.get(file.fsPath);
      if (commands !== undefined) {
        ret.push({
          uri: file,
          configuration: workspace.getSourceFileConfiguration(commands)
        });
        setStatusText('(' + workspace.file_to_compile_commands.get(file.fsPath) + ')')

      } else {
        let workspace_package = workspace.getPackageContaining(file);
        if (!workspace_package) {
          console.log(`Cannot provide compile flags for ${file.fsPath}, not contained in any package`);
          return ret;
        }
        if (!workspace_package.isBuilt(await workspace.workspace_provider.getBuildDir())) {
          console.log(`Cannot provide compile flags for ${file.fsPath}, package ${workspace_package.getName()} is not built`);
          return ret;
        }

        setStatusText('(resolving header file...)');
        try {
          const found = await workspace.iteratePossibleSourceFiles(file, async (possible_source_file) => {
            if (token.isCancellationRequested) {
              return true;
            }
            let commands = workspace.file_to_command.get(possible_source_file.fsPath.toString());
            if (commands !== undefined) {
              ret.push({
                uri: file,
                configuration: workspace.getSourceFileConfiguration(commands)
              });
              setStatusText('(header resolution via ' + workspace.file_to_compile_commands.get(possible_source_file.fsPath) + ')');
              return true;
            } else {
              return false;
            }
          });
          if (!found) {
            setStatusText('(no usage of header file  found.');
          }
        } catch (error) {
          console.log(error);
          setStatusText('(error during configuration search...)');
        }
      }
    }
    return ret;
  }
  public async canProvideBrowseConfiguration(token?: vscode.CancellationToken):
    Promise<boolean> {
    return true;
  }
  public async provideBrowseConfiguration(token?: vscode.CancellationToken):
    Promise<WorkspaceBrowseConfiguration> {
    let paths = [];
    if (vscode.workspace.workspaceFolders !== undefined) {
      for (var vscode_workspace of vscode.workspace.workspaceFolders) {
        let workspace = api.getWorkspace(vscode_workspace);
        if (workspace) {
          for (var sp of workspace.system_include_browse_paths) {
            paths.push(sp);
          }
          for (var dp of workspace.default_system_include_paths) {
            paths.push(dp);
          }
        }
      }
    }
    return { browsePath: paths };
  }
}
