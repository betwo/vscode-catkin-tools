# catkin-tools support for VS Code

This extension makes it easier to work with [catkin-tools](https://github.com/catkin/catkin_tools).

# Features

* Watches the build directory of the current catkin-tools workspace for changes in `compile_commands.json` files.
  * Implements a C/C++ configuration provider using these compile commands, enabling auto completion
* Provides catkin build tasks for
  * Build all packages in the workspace
  * Build the package containing the currently open file


# Setup

## IntelliSense

Make sure that your catkin_tools workspace is set up to generate `compile_commands.json` files.

Make sure to
* add the workspace root to the browse path,
* use the default intellisense mode,

For example:

```json
{
    "configurations": [
        {
            "configurationProvider": "b2.catkin_tools",
            "intelliSenseMode": "${default}"
        }
    ],
    "version": 4
}
```

## C/C++ Clang Command Adapter compatibility

Using this extension with _C/C++ Clang Command Adapter_ auto completion causes too many symbols to show up in IntelliSense auto completion..
If you are using the extension, we suggest you set the option

    "clang.completion.enable": false

in your workspeace settings.


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