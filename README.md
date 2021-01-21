# catkin-tools support for VS Code

[![Licence](https://img.shields.io/github/license/betwo/vscode-catkin-tools.svg)](https://github.com/betwo/vscode-catkin-tools)
[![VS Code Marketplace](https://vsmarketplacebadge.apphb.com/version-short/betwo.b2-catkin-tools.svg) ![Rating](https://vsmarketplacebadge.apphb.com/rating-short/betwo.b2-catkin-tools.svg) ![Downloads](https://vsmarketplacebadge.apphb.com/downloads-short/betwo.b2-catkin-tools.svg) ![Installs](https://vsmarketplacebadge.apphb.com/installs-short/betwo.b2-catkin-tools.svg)](https://marketplace.visualstudio.com/items?itemName=betwo.b2-catkin-tools)

This extension makes it easier to work with [catkin-tools](https://github.com/catkin/catkin_tools).

## Features

* Watches the build directory of the current catkin-tools workspace for changes in `compile_commands.json` files.
  * Implements a C/C++ configuration provider using these compile commands, enabling auto completion
* Provides catkin build tasks for
  * Build all packages in the workspace
  * Build the package containing the currently open file
* Allows switching between different catkin profiles
* Provides Test Explorer client to handle GTest targets

## Setup / Configuration

This extension activates itself only if there is a top level `.catkin_tools` directory in your opened workspace.
In a standard catkin layout, this means that the opened workspace should look like the following:

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

You can register catkin build as the default task in the following way.
- Create a file `tasks.json` in the `.vscode` folder, if it does not already exist.
- Add the following to the `tasks` section of the file.

```json
	{
		"version":"2.0.0",
		"tasks":[
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
		]
	}
```

## Building the workspace
The workspace can be built by pressing CTRL + Shift + B. This will trigger `catkin build` in the workspace and build all the packages in the workspace.