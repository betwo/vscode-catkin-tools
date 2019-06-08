import * as vscode from 'vscode';

interface CatkinTaskDefinition extends vscode.TaskDefinition {
  /**
   * The task name
   */
  task: string;
}


export async function getCatkinBuildTask(): Promise<vscode.Task[]> {
  let workspaceRoot = vscode.workspace.rootPath;
  let emptyTasks: vscode.Task[] = [];
  if (!workspaceRoot) {
    return emptyTasks;
  }

  let source_catkin = 'catkin locate > /dev/null && source "$(catkin locate -d)/setup.bash"';
  let source_workspace = 'cd "${workspaceFolder}" && ' + source_catkin;
  let source_current_package = 'cd "${fileDirname}" && ' + source_catkin;

  let result: vscode.Task[] = [];
  {
    let taskName = 'build';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, taskName, 'catkin_build',
      new vscode.ShellExecution(source_workspace + ' && catkin build'),
      ['$catkin-gcc', '$catkin-cmake']);
    result.push(task);
  }
  {
    let taskName = 'build current package';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, taskName, 'catkin_build',
      new vscode.ShellExecution(source_current_package + ' && catkin build --this -v --no-deps'),
      ['$catkin-gcc', '$catkin-cmake']);
    result.push(task);
  }
  {
    let taskName = 'run current package tests';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, taskName, 'catkin_build',
      new vscode.ShellExecution(source_current_package + ' && ' +
      'env CTEST_OUTPUT_ON_FAILURE=1 catkin build --this -v --no-deps --catkin-make-args run_tests'),
      ['$catkin-gcc', '$catkin-cmake']);
    result.push(task);
  }
  return result;
}