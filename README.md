# catkin-tools support for VS Code

This extension makes it easier to work with [catkin-tools](https://github.com/catkin/catkin_tools).

# Features

* Watches the build directory of the current catkin-tools workspace for changes in `compile_commands.json` files.
 * Merges all `compile_commands.json` files into a common `"${workspaceFolder}/compile_commands.json`.
 * Reloads the intellisense database when the compile commands change.
* Provides catkin build tasks for
 * Build all packages in the workspace
 * Build the package containing the currently open file

# Setup

## Intellisense

Make sure that your catkin_tools workspace is set up to generate `compile_commands.json` files.

Make sure to use the default intellisense mode and set your C++ configuration to use `"${workspaceFolder}/compile_commands.json`, for examples:
```json
    {
    "configurations": [
        {
            "browse": {
                "databaseFilename": "",
                "limitSymbolsToIncludedHeaders": true
            },
            "name": "Linux",
            "intelliSenseMode": "${default}",
            "compileCommands": "${workspaceFolder}/compile_commands.json",
            "cStandard": "c11",
            "cppStandard": "c++17"
        }
    ],
    "version": 4
}
```

## CMAKE_EXPORT_COMPILE_COMMANDS

Make sure that `CMAKE_EXPORT_COMPILE_COMMANDS` is set in your catkin projects, e.g. by configuring catkin with

    catkin config --cmake-args -DCMAKE_BUILD_TYPE=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

## Tasks

You can register catkin build as the default task like this:
```json
    {
        "type": "catkin_build",
        "task": "build",
        "problemMatcher": [
            "$catkin-gcc"
        ],
        "group": {
            "kind": "build",
            "isDefault": true
        }
    }
```