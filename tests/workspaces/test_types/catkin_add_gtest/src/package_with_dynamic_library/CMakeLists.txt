cmake_minimum_required(VERSION 3.0.2)
project(package_with_dynamic_library)

find_package(catkin REQUIRED)


catkin_package()

include_directories()

# find_package()

add_library(${PROJECT_NAME}-lib SHARED
    src/library.cpp
)
target_include_directories(${PROJECT_NAME}-lib
    PUBLIC
        include
)

catkin_add_gtest(${PROJECT_NAME}-test
    test/test.cpp
    test/main.cpp
)
target_link_libraries(
    ${PROJECT_NAME}-test
    ${PROJECT_NAME}-lib
)
target_compile_options(
    ${PROJECT_NAME}-test
    PUBLIC
        -fno-lto
)