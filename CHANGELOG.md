# Change Log
All notable changes to the "b2-catkin-tools" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Automatically watch all `compile_commands.json` files and merge them into one

## [0.2.0] - 2019-02-09
### Fixed
- Added a dependency to glob 
- Added a dependency to C/C++ tools 

## [0.3.0] - 2019-02-09
### Added
- Added run tasks to start a `catkin build` process

## [0.4.0] - 2019-02-10
### Change
- Only reload the merged `compile_commands.json` file when it has changed (detected via MD5 hash)

## [0.5.0] - 2019-02-16
### Fixed
- Fix recursive call to directory crawling causing heavy load
### Change
- Replace popup messages with custom status bar message

## [1.0.0] - 2019-03-01
### Added
- Implement the C/C++ tools API for custom configuration providers

### Removed
- Merging of `compile_commands.json` files is no longer done in favor of the C/C++ tools API

## [1.0.1] - 2019-03-01
### Fixed
- Fixed wrong spelling of the reload command

## [1.0.2] - 2019-03-01
### Fixed
- Fixed crash when Clang command adapter is not installed

## [1.1.0] - 2019-03-01
### Added
- Added support for system file browsing and tagging

## [1.1.1] - 2019-03-01
### Fixed
- Fixed outdated README.md

## [1.2.0] - 2019-03-04
### Added
- Added auto completion for package dependencies in package.xml files
- Added CMake problem matcher for catkin output
### Fixed
- Fixed `build current package` always being invoked in the intially working director

## [1.3.0] - 2019-03-06
### Added
- Added support for -isystem parsing in `compile_commands.json` files

## [1.3.1] - 2019-05-03
### Fixed
- Minor patches

## [1.3.2] - 2019-05-05
### Added
- Added a section in README.md that explains the setup
### Fixed
- Made `catkin build` task work without requiring an opened editor

## [1.3.3] - 2019-05-27
### Fixed
- Add support for compile options containing escaped characters

## [1.4.0] - 2019-06-08
### Added
- Add support GTest targets in Test Explorer (support for catkin_add_gtest)

## [1.5.0] - 2019-06-09
### Added
- Add support for general CTest targets in Test Explorer

## [1.5.1] - 2019-06-10
### Added
- Add progress indicator for workspace indexing

## [1.5.2] - 2019-08-29
### Changed
- Reimplemented the "build current package" task to manually find the catkin workspace

## [1.5.3] - 2019-08-30
### Changed
- Replaced `vscode.workspace.findFiles` with `fast-glob.async` to search for unit tests
- Forcing unit test execution in a `bash` shell instead of defaulting

## [1.6.0] - 2019-09-08
### Added
- Added support for canceling and debugging unit tests
### Change
- Refactored a large part of the code base to be more asynchronous in order to improve responsiveness

## [1.6.1] - 2019-09-08
### Fixed
- Fixed test output message not being shown

## [1.6.2] - 2019-09-11
### Fixed
- Fixed uncaught exception when a `compile_commands.json` file is deleted in parallel

## [1.7.0] - 2019-09-12
### Added
- Added two problem matchers for GTest, those can be unified when multi-line matchers are fixed

## [1.8.0] - 2019-09-12
### Added
- Added a webpack config

## [1.9.0] - 2019-09-16
### Changed
- Made unit test discovery and execution more robust

## [1.9.1] - 2019-10-05
### Fixed
- Fixed exception on malformed package.xml causing packages not to be listed