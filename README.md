# catkin-tools support for VS Code

This extension makes it easier to work with [catkin-tools](https://github.com/catkin/catkin_tools).

# Features

* Watches the build directory of the current catkin-tools workspace for changes in `compile_commands.json` files.
  * Implements a C/C++ configuration provider using these compile commands, enabling auto completion
* Provides catkin build tasks for
  * Build all packages in the workspace
  * Build the package containing the currently open file


# Setup

This extension activates itself only if there is a top level `.catkin_tools` directory in your opened workspace.
In a standard catkin layout, this means that the opened workspace should look like the following:

```
<workspace>/.catkin_tools
<workspace>/src
<workspace>/devel
<workspace>/build
<workspace>/install
<workspace>/logs
```

If you do not want to list `build`, `devel`, etc., we suggest you add them to
your workspace's exclude list in your `settings.json` file:
```
...
    "files.exclude": {
        ".catkin_tools/": true,
        "build*/": true,
        "install*/": true,
        "devel*/": true,
        "logs*/": true,
    },
...
```

## IntelliSense

Make sure that your catkin_tools workspace is set up to generate `compile_commands.json` files.

Make sure to
* use this extension as the __configurationProvider__ for `ms-vscode.cpptools`,
* use the default intellisense mode.

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

Using this extension with _C/C++ Clang Command Adapter_ auto completion causes too many symbols to show up in IntelliSense auto completion.
If you are using the extension, we suggest you set the option

    "clang.completion.enable": false

in your workspace settings.


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
