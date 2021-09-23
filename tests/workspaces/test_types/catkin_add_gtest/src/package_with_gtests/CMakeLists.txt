cmake_minimum_required(VERSION 3.0.2)
project(package_with_gtests)

find_package(catkin REQUIRED)


catkin_package()

include_directories()

catkin_add_gtest(${PROJECT_NAME}-test 
    test/test_package_a.cpp
    test/main.cpp
)
