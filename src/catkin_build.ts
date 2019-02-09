import * as vscode from 'vscode';

interface CatkinTaskDefinition extends vscode.TaskDefinition {
  /**
   * The task name
   */
  task: string;

  /**
   * The rake file containing the task
   */
  file?: string;
}


export async function getCatkinBuildTask(): Promise<vscode.Task[]> {
  let workspaceRoot = vscode.workspace.rootPath;
  let emptyTasks: vscode.Task[] = [];
  if (!workspaceRoot) {
    return emptyTasks;
  }

  let result: vscode.Task[] = [];
  {
    let taskName = 'build';
    let kind: CatkinTaskDefinition = {type: 'catkin_build', task: taskName};
    let current_file = vscode.window.activeTextEditor.document.uri.fsPath;
    let current_dir = current_file.substr(0, current_file.lastIndexOf('/'));
    let task = new vscode.Task(
        kind, taskName, 'catkin_build',
        new vscode.ShellExecution(
            `cd ${current_dir} && source $(catkin locate -d)/setup.bash && catkin build`),
        '$catkin-gcc');
    result.push(task);
  }
  {
    let taskName = 'build current package';
    let kind: CatkinTaskDefinition = {type: 'catkin_build', task: taskName};
    let current_file = vscode.window.activeTextEditor.document.uri.fsPath;
    let current_dir = current_file.substr(0, current_file.lastIndexOf('/'));
    let task = new vscode.Task(
        kind, taskName, 'catkin_build',
        new vscode.ShellExecution(
            `cd ${current_dir} && source $(catkin locate -d)/setup.bash && catkin build --this -v --no-deps`),
        '$catkin-gcc');
    result.push(task);
  }
  {
    let taskName = 'run current package tests';
    let kind: CatkinTaskDefinition = {type: 'catkin_build', task: taskName};
    let current_file = vscode.window.activeTextEditor.document.uri.fsPath;
    let current_dir = current_file.substr(0, current_file.lastIndexOf('/'));
    let task = new vscode.Task(
        kind, taskName, 'catkin_build',
        new vscode.ShellExecution(
            `cd ${current_dir} && source $(catkin locate -d)/setup.bash && env CTEST_OUTPUT_ON_FAILURE=1 catkin build --this -v --no-deps --make-args test`),
        '$catkin-gcc');
    result.push(task);
  }
  return result;
}