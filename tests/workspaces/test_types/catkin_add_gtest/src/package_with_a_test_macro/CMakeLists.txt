cmake_minimum_required(VERSION 3.0.2)
project(package_with_a_test_macro)

find_package(catkin REQUIRED)

include(${CMAKE_CURRENT_LIST_DIR}/cmake/my_test_macro.cmake)

catkin_package()

include_directories()

add_custom_test(
    test/test.cpp
    test/main.cpp
)
