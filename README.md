# catkin-tools support for VS Code

[![Licence](https://img.shields.io/github/license/betwo/vscode-catkin-tools.png)](https://github.com/betwo/vscode-catkin-tools)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/betwo.b2-catkin-tools.png) ![Rating](https://vsmarketplacebadges.dev/rating-short/betwo.b2-catkin-tools.png) ![Downloads](https://vsmarketplacebadges.dev/downloads-short/betwo.b2-catkin-tools.png) ![Installs](https://vsmarketplacebadges.dev/installs-short/betwo.b2-catkin-tools.png)](https://marketplace.visualstudio.com/items?itemName=betwo.b2-catkin-tools)

This extension makes it easier to work with [catkin-tools](https://github.com/catkin/catkin_tools).
To some extent, it also allows the usage of [colcon](https://github.com/colcon) as the build tool to use.

## Features

* Watches the build directory of the current catkin-tools workspace for changes in `compile_commands.json` files.
  * Implements a C/C++ configuration provider using these compile commands, enabling auto completion
* Provides catkin build tasks for
  * Build all packages in the workspace
  * Build the package containing the currently open file
* Allows switching between different catkin profiles
* Provides Test Explorer client to handle GTest targets

## Setup / Configuration (catkin_tools)

This extension activates itself only if there is a top level `.catkin_tools` directory in any of your opened workspaces.
In a standard catkin layout, this means that an opened workspace should look like the following:

```txt
<workspace>/.catkin_tools
<workspace>/src
[<workspace>/devel]
[<workspace>/build]
[<workspace>/install]
[<workspace>/logs]
```

If you do not want to list `build`, `devel`, etc., we suggest you add them to
your workspace's exclude list in your `settings.json` file:

```json
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

The folders for `devel`, `build` and `log` spaces can also be called differently, only the `src` space is required.
This way, arbitrary catkin profiles are supported.

## Setup / Configuration (colcon)

Note: colcon support is rudimentary and needs some setup:
For a colcon workspace, we expected a `colcon.meta` file to exist in the workspace `src` directory.
Then, set the option `colconSupportEnabled` to `true` to enable colcon support.
(Colcon can also build pure catkin workspaces, which is why for now we have this feature toggle.)

### CMAKE_EXPORT_COMPILE_COMMANDS

Make sure that your catkin_tools workspace is set up to generate `compile_commands.json` files.
This can be done by setting the `CMAKE_EXPORT_COMPILE_COMMANDS` flag to ON or 1 and re-building the workspace.  
The `compile_commands.json` files are created for each package that is built inside the build folder.
```sh
catkin config --cmake-args -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
catkin build
```

If you have any other cmake arguments, please pass them along in the above command, for e.g. `-DCMAKE_BUILD_TYPE=Debug`.

An alternate option is to directly modify the `cmake_args` section of the `.catkin_tools/profiles/<profile_name>/config.yaml` file.

```yaml
cmake_args:
- -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
- -DCMAKE_BUILD_TYPE=Debug
```

### IntelliSense

Make sure to

* use this extension as the __configurationProvider__ for `ms-vscode.cpptools`,
* use the default intellisense mode.

This can be done by adding the following lines to the `c_cpp_properties.json` file in the `.vscode` folder.
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

### GTest targets

This extensions registers itself as [TestExplorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) adapter.
For this, all `CMakeLists.txt` are scanned for keywords hinting at the existence of `CTest` based unit tests, e.g. `catkin_add_gtest`.
This is done with a list of regular expressions.
If you have a custom macro for registering tests, you can customize this behavior via the `catkin_tools.gtestMacroRegex` property.

For example:

```json
...
    "catkin_tools.gtestMacroRegex": [
        "catkin_add_gtest",
        "my_.*test"
    ]
...
```

in your workspace settings will list all `catkin_add_gtest` tests and all tests matching `my_.*test`, e.g. `my_test` and `my_google_test`.

## C/C++ Clang Command Adapter compatibility

Using this extension with _C/C++ Clang Command Adapter_ auto completion causes too many symbols to show up in IntelliSense auto completion.
If you are using the extension, we suggest you set the option

```json
...
"clang.completion.enable": false
...
```

in your workspace settings.

## Tasks

You can register catkin build as a build task in the following way.  
- Press `ctrl+shift+p` > `Tasks: Configure Task` > `catkin_build: build` or `catkin_build: build current package` or `catkin_build: run current package tests`  
- If a `tasks.json` file does not exist, it will be created and a snippet similar to the following will be added. If `tasks.json` already exists, configuration settings are added only to the `"tasks"` section.

```json
{
	"version":"2.0.0",
	"tasks":[
		{
			"type": "catkin_build",
			"task": "build",
			"problemMatcher": [
				"$catkin-gcc",
				"$catkin-cmake"
			],
			"label": "catkin_build: build",
			"group": "build"
		}
	]
}
```
- Note: You can add multiple build tasks into a single `tasks.json` file by repeating the above steps.  
- Note: Make sure that `"group": "build"` is present. If not add it. The task will then be available as a build task, i.e it will appear in the drop down menu when you press `ctrl+shift+b`.  
- Note: To set a particular task as the default task, modify the `"group": "build"` to the following. If this is done, you can no longer choose the build tasks and only the default one will be executed when you press `ctrl+shift+b`.  
```json
	"group": {
           	"kind": "build",
           	"isDefault": true
       	}
```

## Building packages

Press `ctrl+shift+b`. If a default build task is not set, you can can choose between the different build tasks available.  
- `catkin_build: build` will build all the packages in the workspace.  
- `catkin_build: build current package` will only build the package that the currently open file belongs to.  
- `catkin_build: run current package tests` will only build the package that the currently open file belongs to and runs tests.  
