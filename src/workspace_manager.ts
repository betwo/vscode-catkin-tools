import * as vscode from 'vscode';
import { IWorkspaceManager } from 'vscode-catkin-tools-api';
import { CppToolsApi, getCppToolsApi, Version } from 'vscode-cpptools';

import { Workspace } from './common/workspace';
import { PackageXmlCompleter } from './common/package_xml_tools';
import { CppToolsConfigurationProvider } from './common/cpp_tools_configuration_provider';
import { setStatusText } from './common/status_bar';
import { CatkinWorkspaceProvider } from './catkin_tools/catkin_workspace_provider';
import * as catkin_tools_workspace from "./catkin_tools/catkin_tools_workspace";
import * as colcon_workspace from "./colcon/colcon_workspace";
import { ColconWorkspaceProvider } from './colcon/colcon_workspace_provider';
import { WorkspaceTestAdapter } from './common/testing/workspace_test_adapter';
import { api } from './extension';
import { logger } from './common/logging';


export class WorkspaceManager implements IWorkspaceManager {

  cpp_tools_configuration_provider: CppToolsConfigurationProvider = undefined;
  test_controller: vscode.TestController;
  cpp_tools_api: CppToolsApi;

  workspaces = new Map<vscode.WorkspaceFolder, Workspace>();
  onWorkspacesChanged = new vscode.EventEmitter<void>();

  async initialize(): Promise<void> {
    this.cpp_tools_api = await getCppToolsApi(Version.v2);
    if (this.cpp_tools_api) {
      if (!this.cpp_tools_api.notifyReady) {
        vscode.window.showInformationMessage(
          'Catkin tools only supports C/C++ API 2.0 or later.');
        return;
      }
    }
    this.test_controller = vscode.tests.createTestController('catkin-tools', 'catkin tools test controller');
  }

  public getWorkspace(workspace_folder: vscode.WorkspaceFolder): Workspace {
    return this.workspaces.get(workspace_folder);
  }

  public async registerWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder, output_channel: vscode.OutputChannel) {
    logger.info(`Checking if workspace ${root.uri.fsPath} should be registered`);
    const is_catkin_tools = await catkin_tools_workspace.isCatkinWorkspace(root);
    const is_colcon = await colcon_workspace.isColconWorkspace(root);
    logger.info(`${root.uri.fsPath}: catkin: ${is_catkin_tools}, colcon: ${is_colcon}`);
    if (is_catkin_tools || is_colcon) {
      if (this.cpp_tools_configuration_provider === undefined) {
        // Inform cpptools that a custom config provider will be able to service
        // the current workspace.
        this.cpp_tools_configuration_provider = new CppToolsConfigurationProvider(this.cpp_tools_api);

        let config = vscode.workspace.getConfiguration('C_Cpp');
        if (config['intelliSenseEngine'] !== undefined && config['intelliSenseEngine'] !== 'Disabled') {
          this.cpp_tools_api.registerCustomConfigurationProvider(this.cpp_tools_configuration_provider);
        }
      }

      let workspace: Workspace = this.getWorkspace(root);
      // first try to get a cached instance of the workspace.
      // this might be triggered if the same workspace is opened in different folders
      if (workspace === undefined) {
        setStatusText(`initializing workspace`);
        if (is_catkin_tools) {
          workspace = await this.initializeCatkinToolsWorkspace(context, root, output_channel);
        } else {
          workspace = await this.initializeColconWorkspace(context, root, output_channel);
        }

        if (workspace !== undefined) {
          output_channel.appendLine(`Adding new workspace ${root.uri.fsPath}`);
          logger.info(`Adding new workspace ${root.uri.fsPath}`);

          workspace.onWorkspaceInitialized.event((initialized) => {
            logger.info(`workspace ${root.uri.fsPath} triggered onWorkspaceInitialized`);
            if (this.cpp_tools_configuration_provider) {
              this.cpp_tools_configuration_provider.addWorkspace(root, workspace);
              this.cpp_tools_api.notifyReady(this.cpp_tools_configuration_provider);
            }
            if (this.test_controller) {
              if (workspace.test_adapter !== null) {
                workspace.test_adapter.dispose();
              }
              workspace.test_adapter = new WorkspaceTestAdapter(
                root.uri.fsPath,
                this.test_controller,
                workspace,
                output_channel,
                api
              );

              workspace.test_adapter.load();
            }

            this.onWorkspacesChanged.fire();
          });
          workspace.onTestsSetChanged.event((changed) => {
            this.onWorkspacesChanged.fire();
          });
          setStatusText(`reloading workspace ${await workspace.getName()}`);
          await workspace.reload();
          setStatusText(`workspace ${await workspace.getName()} initialized`);
        }

      } else {
        output_channel.appendLine(`Reusing workspace ${await workspace.getRootPath()} for folder ${root.uri.fsPath}`);
        logger.info(`Reusing workspace ${await workspace.getRootPath()} for folder ${root.uri.fsPath}`);
      }
    } else {
      output_channel.appendLine(`Folder ${root.uri.fsPath} is not a catkin workspace.`);
      logger.info(`Folder ${root.uri.fsPath} is not a catkin workspace.`);
    }
  }

  public async unregisterWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder) {

    let workspace = this.getWorkspace(root);
    if (workspace !== undefined) {
      if (this.cpp_tools_configuration_provider) {
        this.cpp_tools_configuration_provider.removeWorkspace(root);
      }

      workspace.dispose();
    }
  }

  public async initializeCatkinToolsWorkspace(
    context: vscode.ExtensionContext, root: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel): Promise<Workspace> {
    let config = vscode.workspace.getConfiguration('clang');
    if (config['completion'] !== undefined && config['completion']['enable']) {
      let ack: string = 'Ok';
      let msg =
        'You seem to have clang.completion enabled. This interferes with catkin-tools auto completion.\n' +
        'To disable it, change the setting "clang.completion.enable" to false.';
      vscode.window.showInformationMessage(msg, ack);
    }

    let catkin_workspace_provider = new CatkinWorkspaceProvider(root);
    let catkin_workspace = new Workspace(catkin_workspace_provider, outputChannel);
    const package_xml_provider = vscode.languages.registerCompletionItemProvider(
      { pattern: '**/package.xml' },
      new PackageXmlCompleter(catkin_workspace));
    context.subscriptions.push(package_xml_provider);
    return catkin_workspace;
  }

  public async initializeColconWorkspace(
    context: vscode.ExtensionContext, root: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel): Promise<Workspace> {
    let config = vscode.workspace.getConfiguration('clang');
    if (config['completion'] !== undefined && config['completion']['enable']) {
      let ack: string = 'Ok';
      let msg =
        'You seem to have clang.completion enabled. This interferes with catkin-tools auto completion.\n' +
        'To disable it, change the setting "clang.completion.enable" to false.';
      vscode.window.showInformationMessage(msg, ack);
    }

    let ack: string = 'Ok';
    let msg =
      'Colcon support is not fully implemented yet. Please be warned.';
    vscode.window.showWarningMessage(msg, ack);

    let colcon_workspace_provider = new ColconWorkspaceProvider(root);
    let colcon_workspace = new Workspace(colcon_workspace_provider, outputChannel);
    const package_xml_provider = vscode.languages.registerCompletionItemProvider(
      { pattern: '**/package.xml' },
      new PackageXmlCompleter(colcon_workspace));
    context.subscriptions.push(package_xml_provider);
    return colcon_workspace;
  }

  public async reloadCompileCommands() {
    setStatusText('merging compile commands');
    const config = vscode.workspace.getConfiguration('catkin_tools');
    const merged_compile_commands_json_path = config.get('mergedCompileCommandsJsonPath', "");

    if (merged_compile_commands_json_path.length > 0) {
      await this.cpp_tools_configuration_provider.mergeCompileCommandsFiles();
      setStatusText(`written to ${merged_compile_commands_json_path}`);
    } else {
      setStatusText('(mergedCompileCommandsJsonPath not set)');
    }
  }

  public async reloadAllWorkspaces() {
    setStatusText('reloading');

    let workers = [];
    for (const [_, workspace] of this.workspaces) {
      workers.push(workspace.reload());
    }
    let reloaded_spaces: Workspace[] = await Promise.all(workers);

    if (reloaded_spaces.every(entry => entry !== undefined)) {
      setStatusText('reload complete');
    } else {
      setStatusText('reload failed');
    }
  }

  public async selectWorkspace(): Promise<Workspace> {
    const workspace_list = [];

    if (this.workspaces.size === 0) {
      vscode.window.showErrorMessage(`Could not find a catkin workspace, is your workspace still being indexed?`);
      return undefined;
    }

    for (const [_, workspace] of this.workspaces) {
      workspace_list.push(<vscode.QuickPickItem>{
        label: await workspace.getName(),
        description: await workspace.getRootPath()
      });
    }
    return await vscode.window.showQuickPick(workspace_list);
  }

  public async switchProfile() {
    let workspace: Workspace;
    if (vscode.window.activeTextEditor) {
      let vscode_workspace = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
      workspace = this.getWorkspace(vscode_workspace);
    }

    if (workspace === undefined) {
      workspace = await this.selectWorkspace();
      if (workspace === undefined) {
        return;
      }
    }
    const active_profile = await workspace.workspace_provider.getActiveProfile();
    const profiles = await workspace.workspace_provider.getProfiles();

    const profile_list = [];
    for (const profile of profiles) {
      profile_list.push(<vscode.QuickPickItem>{
        label: profile,
        description: profile === active_profile ? "(active)" : "",
        picked: profile === active_profile
      });
    }

    if (profile_list.length > 0) {
      const selection = await vscode.window.showQuickPick(profile_list);
      if (selection !== undefined) {
        workspace.workspace_provider.switchProfile(selection.label);
      }
    } else {
      vscode.window.showErrorMessage(`Failed to list profiles`);
    }
  }

  public async buildTestItem(query_test_item: vscode.TestItem): Promise<boolean> {
    for (let [_, workspace] of this.workspaces) {
      if (workspace.test_adapter.hasTestItem(query_test_item)) {
        const test_item = workspace.test_adapter.getEquivalentTestItem(query_test_item);
        return await workspace.test_adapter.buildTestItem(test_item);
      }
    }
    return false;
  }

  public async reloadTestItem(test_item: vscode.TestItem): Promise<boolean> {
    for (let [_, workspace] of this.workspaces) {
      if (workspace.test_adapter.hasTestItem(test_item)) {
        return await workspace.test_adapter.reloadTestItem(test_item);
      }
    }
    return false;
  }
}