
import * as vscode from 'vscode';
import { CppToolsApi, getCppToolsApi, Version } from 'vscode-cpptools';
import * as vscode_test from 'vscode-test-adapter-api';

import { Workspace } from './common/workspace';
import { PackageXmlCompleter } from './common/package_xml_tools';
import { CppToolsConfigurationProvider } from './common/cpp_tools_configuration_provider';
import { setStatusText } from './common/status_bar';
import { CatkinWorkspaceProvider } from './catkin_tools/catkin_workspace_provider';
import * as catkin_tools_workspace from "./catkin_tools/catkin_tools_workspace";
import * as colcon_workspace from "./colcon/colcon_workspace";
import { ColconWorkspaceProvider } from './colcon/colcon_workspace_provider';
import { WorkspaceTestAdapter } from './common/workspace_test_adapter';

let cpp_tools_configuration_provider: CppToolsConfigurationProvider = undefined;
let test_explorer_api: vscode.Extension<vscode_test.TestHub>;
let cpp_tools_api: CppToolsApi;

export let workspaces = new Map<vscode.WorkspaceFolder, Workspace>();
export let onWorkspacesChanged = new vscode.EventEmitter<void>();

export async function initialize() {
  test_explorer_api = vscode.extensions.getExtension<vscode_test.TestHub>(vscode_test.testExplorerExtensionId);
  cpp_tools_api = await getCppToolsApi(Version.v2);
  if (cpp_tools_api) {
    if (!cpp_tools_api.notifyReady) {
      vscode.window.showInformationMessage(
        'Catkin tools only supports C/C++ API 2.0 or later.');
      return;
    }
  }
}

export function getWorkspace(workspace_folder: vscode.WorkspaceFolder) {
  return workspaces.get(workspace_folder);
}

export async function registerWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder, output_channel: vscode.OutputChannel) {
  const is_catkin_tools = await catkin_tools_workspace.isCatkinWorkspace(root);
  const is_colcon = await colcon_workspace.isColconWorkspace(root);
  if (is_catkin_tools || is_colcon) {
    if (cpp_tools_configuration_provider === undefined) {
      // Inform cpptools that a custom config provider will be able to service
      // the current workspace.
      cpp_tools_configuration_provider = new CppToolsConfigurationProvider(cpp_tools_api);
      cpp_tools_api.registerCustomConfigurationProvider(cpp_tools_configuration_provider);
    }

    let workspace: Workspace = getWorkspace(root);
    // first try to get a cached instance of the workspace.
    // this might be triggered if the same workspace is opened in different folders
    if (workspace === undefined) {
      setStatusText(`initializing workspace`);
      if (is_catkin_tools) {
        workspace = await initializeCatkinToolsWorkspace(context, root, output_channel);
      } else {
        workspace = await initializeColconWorkspace(context, root, output_channel);
      }
      output_channel.appendLine(`Adding new workspace ${root.uri.fsPath}`);

      if (workspace !== undefined) {
        workspace.onWorkspaceInitialized.event((initialized) => {
          if (cpp_tools_configuration_provider) {
            cpp_tools_configuration_provider.addWorkspace(root, workspace);
            cpp_tools_api.notifyReady(cpp_tools_configuration_provider);
          }
          if (test_explorer_api) {
            workspace.test_adapter = new WorkspaceTestAdapter(
              root.uri.fsPath,
              workspace,
              output_channel
            );
            test_explorer_api.exports.registerTestAdapter(workspace.test_adapter);
          }

          onWorkspacesChanged.fire();
        });
        workspace.onTestsSetChanged.event((changed) => {
          onWorkspacesChanged.fire();
        });
        await workspace.reload();
        setStatusText(`workspace ${await workspace.getName()} initialized`);
      }

    } else {
      output_channel.appendLine(`Reusing workspace ${await workspace.getRootPath()} for folder ${root.uri.fsPath}`);
    }
  } else {
    output_channel.appendLine(`Folder ${root.uri.fsPath} is not a catkin workspace.`);
  }
}

export async function unregisterWorkspace(context: vscode.ExtensionContext, root: vscode.WorkspaceFolder) {

  let workspace = getWorkspace(root);
  if (workspace !== undefined) {
    if (test_explorer_api) {
      test_explorer_api.exports.unregisterTestAdapter(workspace.test_adapter);
    }
    if (cpp_tools_configuration_provider) {
      cpp_tools_configuration_provider.removeWorkspace(root);
    }

    workspace.dispose();
  }
}

export async function initializeCatkinToolsWorkspace(
  context: vscode.ExtensionContext, root: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel): Promise<Workspace> {
  let config = vscode.workspace.getConfiguration('clang');
  if (config['completion'] !== undefined && config['completion']['enable']) {
    let ack: string = 'Ok';
    let msg =
      'You seem to have clang.autocomplete enabled. This interferes with catkin-tools auto completion.\n' +
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

export async function initializeColconWorkspace(
  context: vscode.ExtensionContext, root: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel): Promise<Workspace> {
  let config = vscode.workspace.getConfiguration('clang');
  if (config['completion'] !== undefined && config['completion']['enable']) {
    let ack: string = 'Ok';
    let msg =
      'You seem to have clang.autocomplete enabled. This interferes with catkin-tools auto completion.\n' +
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

export async function reloadCompileCommands() {
  setStatusText('merging compile commands');
  const config = vscode.workspace.getConfiguration('catkin_tools');
  const merged_compile_commands_json_path = config.get('mergedCompileCommandsJsonPath', "");

  if (merged_compile_commands_json_path.length > 0) {
    await cpp_tools_configuration_provider.mergeCompileCommandsFiles();
    setStatusText(`written to ${merged_compile_commands_json_path}`);
  } else {
    setStatusText('(mergedCompileCommandsJsonPath not set)');
  }
}

export async function reloadAllWorkspaces() {
  setStatusText('reloading');

  let workers = [];
  for (const [_, workspace] of workspaces) {
    workers.push(workspace.reload());
  }
  let reloaded_spaces: Workspace[] = await Promise.all(workers);

  if (reloaded_spaces.every(entry => entry !== undefined)) {
    setStatusText('reload complete');
  } else {
    setStatusText('reload failed');
  }
}

export async function selectWorkspace(): Promise<Workspace> {
  const workspace_list = [];

  if (workspaces.size === 0) {
    vscode.window.showErrorMessage(`Could not find a catkin workspace, is your workspace still being indexed?`);
    return undefined;
  }

  for (const [_, workspace] of workspaces) {
    workspace_list.push(<vscode.QuickPickItem>{
      label: await workspace.getName(),
      description: await workspace.getRootPath()
    });
  }
  return await vscode.window.showQuickPick(workspace_list);
}

export async function switchProfile() {
  let workspace: Workspace;
  if (vscode.window.activeTextEditor) {
    let vscode_workspace = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    workspace = getWorkspace(vscode_workspace);
  }

  if (workspace === undefined) {
    workspace = await selectWorkspace();
    if (workspace === undefined) {
      return;
    }
  }
  const active_profile = await workspace.workspace_provider.getActiveProfile();
  const profiles = await workspace.workspace_provider.getProfiles();
  console.log(`catkin profiles: ${profiles.length}`)

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
