# catkin-tools support for VS Code

This extension makes it easier to work with [catkin-tools](https://github.com/catkin/catkin_tools).

# Setup

Make sure that your catkin_tools workspace is set up to generate `compile_commands.json` files.

## CMAKE_EXPORT_COMPILE_COMMANDS

Make sure that `CMAKE_EXPORT_COMPILE_COMMANDS` is set in your catkin projects, e.g. by configuring catkin with

    catkin config --cmake-args -DCMAKE_BUILD_TYPE=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON