import * as vscode from 'vscode';

interface ColconTaskDefinition extends vscode.TaskDefinition {
  /**
   * The task name
   */
  task: string;
}


export async function getColconBuildTask(workspace_root: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
  // command to find the directory containing '.catkin_tools'
  let find_basedir = 'basedir=$(pwd) && while ! [[ -f "${basedir}/src/colcon.meta" ]] && [[ "${basedir}" != "/" ]]; do basedir=$(dirname $basedir); done';

  let find_package_root = 'package_root=$(pwd) && while ! [[ -f "${package_root}/package.xml" ]] && [[ "${package_root}" != "/" ]]; do package_root=$(dirname $package_root); done';

  // command to push the current directory without printing
  let push_current_dir = 'pushd . > /dev/null';
  // command to pop a directory without printing
  let pop_dir = 'popd > /dev/null';

  // determine latest ros2 version
  let find_ros2_version = 'for ROS2_VERSION in $(ls /opt/ros/|sort -r); do AMENT_LINES=$(cat /opt/ros/$VERSION/setup.sh | grep ament | wc -l); if [ $AMENT_LINES != "0" ]; then echo $ROS2_VERSION; break; fi; done';

  let find_source_script = 'export SOURCE_SCRIPT="${INSTALL_PREFIX}/setup.$(echo ${SHELL} | xargs basename)"'
    + ' && '
    + 'if [[ ! -f "${SOURCE_SCRIPT}" ]]; then ' + find_ros2_version + '; export SOURCE_SCRIPT=/opt/ros/${ROS2_VERSION}/setup.bash; fi';

  // command to source the setup shell file for the enveloping workspace of the current directory
  //  1. find the base dir. If it can be found, change into it
  //  2.1 call `catkin locate -d` to find the current devel space, which is not guaranteed to be "devel"
  //  2.2. source the setup shell file ending with the current shell's name
  //  3. reset the working directory to the original
  let source_colcon = find_basedir + ' && ' + push_current_dir + ' && '
    + 'if [[ "${basedir}" != "/" ]]; then cd ${basedir}; fi' + ' && '
    + 'export INSTALL_PREFIX=install && '
    + find_source_script + ' && '
    + 'source "${SOURCE_SCRIPT}"' + ' && '
    + pop_dir;

  // command to source the setup shell file for the enveloping workspace of the workspace folder
  let source_workspace = 'cd "${workspaceFolder}" && ' + source_colcon;
  // command to source the setup shell file for the enveloping workspace of the folder ${fileDirname}
  let source_current_package = 'cd "${fileDirname}" && ' + find_package_root + ';' + source_colcon + '; cd ${basedir}';

  let colcon_args = '--cmake-args "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"';

  let result: vscode.Task[] = [];
  {
    let taskName = 'build';
    let kind: ColconTaskDefinition = { type: 'colcon', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName, 'colcon',
      new vscode.ShellExecution(source_workspace + ` && colcon build ${colcon_args}`),
      ['$catkin-gcc', '$catkin-cmake']);
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'build current package';
    let kind: ColconTaskDefinition = { type: 'colcon', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName, 'colcon',
      new vscode.ShellExecution(source_current_package + ' && set -x && colcon build --paths ${package_root} ' + colcon_args),
      ['$catkin-gcc', '$catkin-cmake']);
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'run current package tests';
    let kind: ColconTaskDefinition = { type: 'colcon', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName, 'colcon',
      new vscode.ShellExecution(source_current_package + ' && ' +
        'set -x && env CTEST_OUTPUT_ON_FAILURE=1 colcon test --paths ${package_root} ' + colcon_args),
      ['$catkin-gcc', '$catkin-cmake', '$catkin-gtest', '$catkin-gtest-failed']);
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  return result;
}