# Change Log
All notable changes to the "b2-catkin-tools" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Automatically watch all `compile_commands.json` files and merge them into one

## [0.2.0] - 2018-02-09
### Fixed
- Added a dependency to glob 
- Added a dependency to C/C++ tools 

## [0.3.0] - 2018-02-09
### Added
- Added run tasks to start a `catkin build` process

## [0.4.0] - 2018-02-10
### Change
- Only reload the merged `compile_commands.json` file when it has changed (detected via MD5 hash)

## [0.5.0] - 2018-02-16
### Fixed
- Fix recursive call to directory crawling causing heavy load
### Change
- Replace popup messages with custom status bar message

## [1.0.0] - 2018-03-01
### Added
- Implement the C/C++ tools API for custom configuration providers

### Removed
- Merging of `compile_commands.json` files is no longer done in favor of the C/C++ tools API

## [1.0.1] - 2018-03-01
### Fixed
- Fixed wrong spelling of the reload command

## [1.0.2] - 2018-03-01
### Fixed
- Fixed crash when Clang command adapter is not installed

## [1.1.0] - 2018-03-01
### Added
- Added support for system file browsing and tagging

## [1.1.1] - 2018-03-01
### Fixed
- Fixed outdated README.md
